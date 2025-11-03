import EventEmitter from 'node:events';
import { ApiClient, JobDetail, JobStatus, SearchResult, SearchResultPipeline, StoredJob } from './types.js';
import { JobStore } from './jobStore.js';

type DownloadServiceEvents = {
  jobUpdated: (job: StoredJob) => void;
  jobRemoved: (jobId: string) => void;
  error: (error: Error) => void;
  ready: (jobs: StoredJob[]) => void;
};

const PRESIGNED_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

const mapDetailToStored = (detail: JobDetail, existing?: StoredJob): StoredJob => ({
  jobId: detail.jobId,
  btih: detail.btih,
  label: detail.label ?? existing?.label ?? null,
  createdAt: existing?.createdAt ?? detail.statusUpdatedAt ?? new Date().toISOString(),
  lastKnownStatus: detail.status,
  lastSyncedAt: new Date().toISOString(),
  statusUpdatedAt: detail.statusUpdatedAt ?? existing?.statusUpdatedAt ?? null,
  progress: detail.progress ?? existing?.progress ?? null,
  s3Bucket: detail.s3Bucket ?? existing?.s3Bucket ?? null,
  s3ObjectKey: detail.s3ObjectKey ?? existing?.s3ObjectKey ?? null,
  manifest: detail.manifest ?? existing?.manifest ?? null,
  s3Url: detail.s3Url ?? existing?.s3Url ?? null,
  s3UrlExpiresAt: detail.s3UrlExpiresAt ?? existing?.s3UrlExpiresAt ?? null,
  shortUrl: detail.shortUrl ?? existing?.shortUrl ?? null,
  error: detail.error ?? null,
  sizeBytes: detail.sizeBytes ?? existing?.sizeBytes ?? null
});

const newStoredJob = (
  jobId: string,
  btih: string,
  label: string | undefined,
  status: JobStatus,
  createdAt: string,
  statusUpdatedAt: string,
  progress: number | null,
  sizeBytes: number | undefined,
  s3Bucket: string | null,
  s3ObjectKey: string | null,
  manifest: string | null,
  error: string | null,
  s3Url: string | null,
  s3UrlExpiresAt: string | null,
  shortUrl: string | null
): StoredJob => ({
  jobId,
  btih,
  label: label ?? null,
  createdAt,
  lastKnownStatus: status,
  lastSyncedAt: new Date().toISOString(),
  statusUpdatedAt,
  progress: progress ?? (status === 'completed' ? 1 : 0),
  s3Bucket,
  s3ObjectKey,
  manifest,
  s3Url,
  s3UrlExpiresAt,
  shortUrl,
  error: error ?? null,
  sizeBytes: sizeBytes ?? null
});

export class DownloadService extends EventEmitter {
  private jobs = new Map<string, StoredJob>();
  private initialized = false;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly jobStore: JobStore,
    private readonly searchLimit: number,
    private readonly searchPipeline: SearchResultPipeline = []
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
      this.jobs.set(job.jobId, job);
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
        response.jobId,
        response.btih,
        result.title,
        response.status,
        response.createdAt,
        response.statusUpdatedAt,
        response.progress,
        result.sizeBytes,
        response.s3Bucket,
        response.s3ObjectKey,
        response.manifest,
        response.error,
        response.s3Url,
        response.s3UrlExpiresAt,
        response.shortUrl
      );
      this.jobs.set(stored.jobId, stored);
      await this.jobStore.upsert(stored);
      this.emit('jobUpdated', stored);
      if (response.status === 'completed' || response.status === 'error') {
        await this.syncJob(response.jobId);
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

  async syncJob(jobId: string): Promise<void> {
    try {
      const detail = await this.apiClient.getJob(jobId);
      if (!detail) {
        await this.removeLocal(jobId);
        return;
      }

      const existing = this.jobs.get(jobId);
      let updated = mapDetailToStored(detail, existing ?? undefined);

      if (detail.status === 'completed') {
        const needsLinkRefresh = this.shouldRefreshDownloadLink(existing);
        if (needsLinkRefresh) {
          try {
            const link = await this.apiClient.getJobPresignedLink(jobId);
            if (link?.s3Url) {
              updated = {
                ...updated,
                s3Url: link.s3Url,
                s3Bucket: updated.s3Bucket ?? link.bucket,
                s3ObjectKey: updated.s3ObjectKey ?? link.key,
                s3UrlExpiresAt: link.expiresAt,
                shortUrl: link.shortUrl ?? updated.shortUrl ?? null
              };
            }
          } catch (error) {
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
          }
        }
      }

      this.jobs.set(jobId, updated);
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
        return this.shouldRefreshDownloadLink(job);
      }
      return false;
    });
    if (jobsToSync.length === 0) {
      return;
    }
    await Promise.all(jobsToSync.map((job) => this.syncJob(job.jobId)));
  }

  async remove(jobId: string): Promise<void> {
    try {
      await this.apiClient.deleteJob(jobId);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    } finally {
      await this.removeLocal(jobId);
    }
  }

  private async removeLocal(jobId: string): Promise<void> {
    if (!this.jobs.has(jobId)) {
      return;
    }
    this.jobs.delete(jobId);
    await this.jobStore.remove(jobId);
    this.emit('jobRemoved', jobId);
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

  private shouldRefreshDownloadLink(job: StoredJob | undefined): boolean {
    if (!job) {
      return true;
    }
    if (!job.s3Url) {
      return true;
    }

    if (!job.s3UrlExpiresAt) {
      return true;
    }

    const expiresAt = Date.parse(job.s3UrlExpiresAt);
    if (Number.isNaN(expiresAt)) {
      return true;
    }

    return expiresAt - Date.now() <= PRESIGNED_REFRESH_THRESHOLD_MS;
  }
}
