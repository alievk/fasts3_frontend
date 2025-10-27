import EventEmitter from 'node:events';
import { ApiClient, JobDetail, JobStatus, SearchResult, SearchResultPipeline, StoredJob } from './types.js';
import { JobStore } from './jobStore.js';

type DownloadServiceEvents = {
  jobUpdated: (job: StoredJob) => void;
  jobRemoved: (jobId: string) => void;
  error: (error: Error) => void;
  ready: (jobs: StoredJob[]) => void;
};

const mapDetailToStored = (detail: JobDetail, existing?: StoredJob): StoredJob => ({
  jobId: detail.jobId,
  label: detail.label ?? existing?.label ?? null,
  createdAt: existing?.createdAt ?? new Date().toISOString(),
  lastKnownStatus: detail.status,
  lastSyncedAt: detail.updatedAt,
  progress: detail.progress ?? existing?.progress ?? null,
  s3Url: existing?.s3Url ?? null,
  error: detail.error ?? null,
  sizeBytes: detail.sizeBytes ?? existing?.sizeBytes ?? null
});

const newStoredJob = (
  jobId: string,
  label: string | undefined,
  status: JobStatus,
  createdAt: string,
  sizeBytes: number | undefined
): StoredJob => ({
  jobId,
  label: label ?? null,
  createdAt,
  lastKnownStatus: status,
  lastSyncedAt: createdAt,
  progress: status === 'completed' ? 1 : 0,
  s3Url: null,
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
      const stored = newStoredJob(response.jobId, result.title, response.status, response.createdAt, result.sizeBytes);
      this.jobs.set(stored.jobId, stored);
      await this.jobStore.upsert(stored);
      this.emit('jobUpdated', stored);
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

      if (detail.status === 'completed' && !updated.s3Url) {
        try {
          const link = await this.apiClient.getJobPresignedLink(jobId);
          if (link?.s3Url) {
            updated = { ...updated, s3Url: link.s3Url };
            await this.registerRedirect(jobId, link.s3Url, link.expiresIn);
          }
        } catch (error) {
          this.emit('error', error instanceof Error ? error : new Error(String(error)));
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
    const activeJobs = this.getJobs().filter((job) => job.lastKnownStatus === 'queued' || job.lastKnownStatus === 'downloading');
    if (activeJobs.length === 0) {
      return;
    }
    await Promise.all(activeJobs.map((job) => this.syncJob(job.jobId)));
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
    await this.deleteRedirect(jobId);
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

  private async registerRedirect(jobId: string, url: string, expiresInSeconds: number): Promise<void> {
    if (!this.redirectBaseUrl) {
      return;
    }

    try {
      const endpoint = new URL('/admin/presigned', this.redirectBaseUrl);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          url,
          expiresIn: expiresInSeconds
        })
      });

      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(
          `Failed to register redirect for ${jobId}: ${response.status} ${response.statusText}${
            message ? ` — ${message}` : ''
          }`
        );
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
    }
  }

  private async deleteRedirect(jobId: string): Promise<void> {
    if (!this.redirectBaseUrl) {
      return;
    }

    try {
      const endpoint = new URL(`/admin/presigned/${encodeURIComponent(jobId)}`, this.redirectBaseUrl);
      const response = await fetch(endpoint, {
        method: 'DELETE'
      });

      if (!response.ok && response.status !== 404) {
        const message = await response.text().catch(() => '');
        throw new Error(
          `Failed to delete redirect for ${jobId}: ${response.status} ${response.statusText}${
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
