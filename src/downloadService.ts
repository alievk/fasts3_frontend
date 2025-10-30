import EventEmitter from 'node:events';
import { ApiClient, JobDetail, JobStatus, SearchResult, SearchResultPipeline, StoredJob } from './types.js';
import { JobStore } from './jobStore.js';

type DownloadServiceEvents = {
  jobUpdated: (job: StoredJob) => void;
  jobRemoved: (btih: string) => void;
  error: (error: Error) => void;
  ready: (jobs: StoredJob[]) => void;
};

const PRESIGNED_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

const mapDetailToStored = (detail: JobDetail, existing?: StoredJob): StoredJob => ({
  btih: detail.btih,
  label: detail.label ?? existing?.label ?? null,
  createdAt: existing?.createdAt ?? new Date().toISOString(),
  lastKnownStatus: detail.status,
  lastSyncedAt: detail.updatedAt,
  progress: detail.progress ?? existing?.progress ?? null,
  s3Bucket: detail.s3Bucket ?? existing?.s3Bucket ?? null,
  s3ObjectKey: detail.s3ObjectKey ?? existing?.s3ObjectKey ?? null,
  manifest: detail.manifest ?? existing?.manifest ?? null,
  s3Url: existing?.s3Url ?? null,
  presignExpiresAt: existing?.presignExpiresAt ?? null,
  redirectUrl: existing?.redirectUrl ?? null,
  redirectExpiresAt: existing?.redirectExpiresAt ?? null,
  error: detail.error ?? null,
  sizeBytes: detail.sizeBytes ?? existing?.sizeBytes ?? null
});

const newStoredJob = (
  btih: string,
  label: string | undefined,
  status: JobStatus,
  createdAt: string,
  sizeBytes: number | undefined,
  s3Bucket: string | null,
  s3ObjectKey: string | null,
  manifest: string | null
): StoredJob => ({
  btih,
  label: label ?? null,
  createdAt,
  lastKnownStatus: status,
  lastSyncedAt: createdAt,
  progress: status === 'completed' ? 1 : 0,
  s3Bucket,
  s3ObjectKey,
  manifest,
  s3Url: null,
  presignExpiresAt: null,
  redirectUrl: null,
  redirectExpiresAt: null,
  error: null,
  sizeBytes: sizeBytes ?? null
});

export class DownloadService extends EventEmitter {
  private jobs = new Map<string, StoredJob>();
  private initialized = false;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly jobStore: JobStore,
    private readonly searchLimit: number,
    private readonly searchPipeline: SearchResultPipeline = [],
    private readonly redirectBaseUrl?: string
  ) {
    super();
  }

  override on<EventKey extends keyof DownloadServiceEvents>(
    event: EventKey,
    listener: DownloadServiceEvents[EventKey]
  ): this {
    return super.on(event, listener);
  }

  override off<EventKey extends keyof DownloadServiceEvents>(
    event: EventKey,
    listener: DownloadServiceEvents[EventKey]
  ): this {
    return super.off(event, listener);
  }

  override emit<EventKey extends keyof DownloadServiceEvents>(
    event: EventKey,
    ...args: Parameters<DownloadServiceEvents[EventKey]>
  ): boolean {
    return super.emit(event, ...args);
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const data = await this.jobStore.load();
    Object.values(data.jobs).forEach((job) => {
      this.jobs.set(job.btih, job);
    });
    this.initialized = true;
    this.emit('ready', this.getJobs());
  }

  getJobs(): StoredJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async search(query: string): Promise<SearchResult[]> {
    const results = await this.apiClient.search(query, this.searchLimit);
    if (this.searchPipeline.length === 0) {
      return results;
    }
    return this.applySearchPipeline(results);
  }

  async startDownload(result: SearchResult): Promise<StoredJob> {
    try {
      const response = await this.apiClient.createJob(result.magnet, result.title);
      const stored = newStoredJob(
        response.btih,
        result.title,
        response.status,
        response.createdAt,
        result.sizeBytes,
        response.s3Bucket,
        response.s3ObjectKey,
        response.manifest
      );
      this.jobs.set(stored.btih, stored);
      await this.jobStore.upsert(stored);
      this.emit('jobUpdated', stored);
      if (response.status === 'completed' || response.status === 'error') {
        await this.syncJob(response.btih);
      }
      return stored;
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async checkHealth(): Promise<void> {
    try {
      await this.apiClient.health();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      throw err;
    }
  }

  async syncJob(btih: string): Promise<void> {
    try {
      const detail = await this.apiClient.getJob(btih);
      if (!detail) {
        await this.removeLocal(btih);
        return;
      }

      const existing = this.jobs.get(btih);
      let updated = mapDetailToStored(detail, existing ?? undefined);

      if (detail.status === 'completed') {
        const needsPresignRefresh = this.shouldRefreshPresignedLink(existing);
        if (needsPresignRefresh) {
          try {
            const link = await this.apiClient.getJobPresignedLink(btih);
            if (link?.s3Url) {
              const expiresAt = new Date(Date.now() + link.expiresIn * 1000);
              updated = {
                ...updated,
                s3Url: link.s3Url,
                s3Bucket: updated.s3Bucket ?? link.bucket,
                s3ObjectKey: updated.s3ObjectKey ?? link.key,
                presignExpiresAt: expiresAt.toISOString()
              };
              const redirectMetadata = await this.registerRedirect(btih, link.s3Url, expiresAt);
              if (redirectMetadata) {
                updated = {
                  ...updated,
                  redirectUrl: redirectMetadata.redirectUrl,
                  redirectExpiresAt: redirectMetadata.expiresAt
                };
              }
            }
          } catch (error) {
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
          }
        } else if (
          this.redirectBaseUrl &&
          this.shouldRenewRedirect(existing) &&
          updated.s3Url &&
          updated.presignExpiresAt
        ) {
          const expiresAt = new Date(updated.presignExpiresAt);
          if (!Number.isNaN(expiresAt.getTime())) {
            const redirectMetadata = await this.registerRedirect(btih, updated.s3Url, expiresAt);
            if (redirectMetadata) {
              updated = {
                ...updated,
                redirectUrl: redirectMetadata.redirectUrl,
                redirectExpiresAt: redirectMetadata.expiresAt
              };
            }
          }
        }
      }

      this.jobs.set(btih, updated);
      await this.jobStore.upsert(updated);
      this.emit('jobUpdated', updated);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  async syncAll(): Promise<void> {
    const jobsToSync = this.getJobs().filter((job) => {
      if (
        job.lastKnownStatus === 'queued' ||
        job.lastKnownStatus === 'downloading' ||
        job.lastKnownStatus === 'uploading'
      ) {
        return true;
      }
      if (job.lastKnownStatus === 'completed') {
        const needsPresign = this.shouldRefreshPresignedLink(job);
        const needsRedirect = this.redirectBaseUrl ? this.shouldRenewRedirect(job) : false;
        return needsPresign || needsRedirect;
      }
      return false;
    });
    if (jobsToSync.length === 0) {
      return;
    }
    await Promise.all(jobsToSync.map((job) => this.syncJob(job.btih)));
  }

  async remove(btih: string): Promise<void> {
    try {
      await this.apiClient.deleteJob(btih);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    } finally {
      await this.removeLocal(btih);
    }
  }

  private async removeLocal(btih: string): Promise<void> {
    if (!this.jobs.has(btih)) {
      return;
    }
    this.jobs.delete(btih);
    await this.jobStore.remove(btih);
    await this.deleteRedirect(btih);
    this.emit('jobRemoved', btih);
  }

  private async applySearchPipeline(results: SearchResult[]): Promise<SearchResult[]> {
    let current = results;
    for (const stage of this.searchPipeline) {
      const next = await stage(current);
      if (!Array.isArray(next)) {
        throw new Error('Search pipeline stage must return an array of results');
      }
      current = next;
    }
    return current;
  }

  private shouldRefreshPresignedLink(job: StoredJob | undefined): boolean {
    if (!job) {
      return true;
    }
    if (!job.s3Url) {
      return true;
    }

    if (!job.presignExpiresAt) {
      return true;
    }

    const expiresAt = Date.parse(job.presignExpiresAt);
    if (Number.isNaN(expiresAt)) {
      return true;
    }

    return expiresAt - Date.now() <= PRESIGNED_REFRESH_THRESHOLD_MS;
  }

  private shouldRenewRedirect(job: StoredJob | undefined): boolean {
    if (!job) {
      return true;
    }
    if (!job.redirectUrl) {
      return true;
    }

    if (!job.redirectExpiresAt) {
      return true;
    }

    const expiresAt = Date.parse(job.redirectExpiresAt);
    if (Number.isNaN(expiresAt)) {
      return true;
    }

    return expiresAt - Date.now() <= PRESIGNED_REFRESH_THRESHOLD_MS;
  }

  private async registerRedirect(
    btih: string,
    url: string,
    expiresAt: Date
  ): Promise<{ redirectUrl: string; expiresAt: string } | undefined> {
    if (!this.redirectBaseUrl) {
      return undefined;
    }

    try {
      const endpoint = new URL('/admin/presigned', this.redirectBaseUrl);
      const isoExpiry = expiresAt.toISOString();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          btih,
          url,
          expiresAt: isoExpiry
        })
      });

      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(
          `Failed to register redirect for ${btih}: ${response.status} ${response.statusText}${
            message ? ` — ${message}` : ''
          }`
        );
      }

      const redirectUrl = new URL(`/presigned/${encodeURIComponent(btih)}`, this.redirectBaseUrl).toString();
      return {
        redirectUrl,
        expiresAt: isoExpiry
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      return undefined;
    }
  }

  private async deleteRedirect(btih: string): Promise<void> {
    if (!this.redirectBaseUrl) {
      return;
    }

    try {
      const endpoint = new URL(`/admin/presigned/${encodeURIComponent(btih)}`, this.redirectBaseUrl);
      const response = await fetch(endpoint, {
        method: 'DELETE'
      });

      if (!response.ok && response.status !== 404) {
        const message = await response.text().catch(() => '');
        throw new Error(
          `Failed to delete redirect for ${btih}: ${response.status} ${response.statusText}${
            message ? ` — ${message}` : ''
          }`
        );
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
    }
  }
}
