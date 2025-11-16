import EventEmitter from 'node:events';
import {
  ApiClient,
  ClientRegistry,
  JobDetail,
  JobStatus,
  OwnedJob,
  SearchResult,
  SearchResultDetail,
  SearchResultPipeline,
  StoredJob
} from './types.js';

type DownloadServiceEvents = {
  jobUpdated: (job: OwnedJob) => void;
  jobRemoved: (job: OwnedJob) => void;
  error: (error: Error) => void;
  ready: (jobs: OwnedJob[]) => void;
};

const hasKnownSize = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const resolveTorrentTitle = (result: SearchResult, detail: SearchResultDetail): string => {
  const id = result.id;
  const searchTitle = result.title.trim();
  const detailTitle = detail.title.trim();
  if (searchTitle && searchTitle !== id) {
    return searchTitle;
  }
  if (detailTitle && detailTitle !== id) {
    return detailTitle;
  }
  return searchTitle || detailTitle || id;
};

const resolveTorrentSizeBytes = (result: SearchResult, detail: SearchResultDetail): number | null => {
  if (hasKnownSize(result.sizeBytes)) {
    return result.sizeBytes;
  }
  if (hasKnownSize(detail.sizeBytes)) {
    return detail.sizeBytes;
  }
  const largestFileSize = detail.files.reduce<number>(
    (max, file) => (hasKnownSize(file.sizeBytes) && file.sizeBytes > max ? file.sizeBytes : max),
    0
  );
  return largestFileSize > 0 ? largestFileSize : null;
};

const mapDetailToStored = (detail: JobDetail, existing?: StoredJob): StoredJob => ({
  jobId: detail.jobId,
  btih: detail.btih,
  label: detail.label ?? existing?.label ?? null,
  createdAt: existing?.createdAt ?? detail.statusUpdatedAt ?? new Date().toISOString(),
  lastKnownStatus: detail.status,
  lastSyncedAt: new Date().toISOString(),
  statusUpdatedAt: detail.statusUpdatedAt ?? existing?.statusUpdatedAt ?? null,
  progress: detail.progress ?? existing?.progress ?? null,
  shortUrl: detail.shortUrl ?? existing?.shortUrl ?? null,
  error: detail.error ?? null,
  sizeBytes: detail.sizeBytes ?? existing?.sizeBytes ?? null,
  s3ObjectKey: detail.s3ObjectKey ?? existing?.s3ObjectKey ?? null
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
  error: string | null,
  shortUrl: string | null,
  s3ObjectKey: string | null
): StoredJob => ({
  jobId,
  btih,
  label: label ?? null,
  createdAt,
  lastKnownStatus: status,
  lastSyncedAt: new Date().toISOString(),
  statusUpdatedAt,
  progress: progress ?? (status === 'completed' ? 1 : 0),
  shortUrl,
  error: error ?? null,
  sizeBytes: sizeBytes ?? null,
  s3ObjectKey: s3ObjectKey ?? null
});

export class DownloadService extends EventEmitter {
  private jobs = new Map<string, OwnedJob>();
  private initialized = false;

  constructor(
    private readonly apiClient: ApiClient,
    private readonly clientRegistry: ClientRegistry,
    private readonly searchLimit: number,
    private readonly searchPipeline: SearchResultPipeline = [],
    private readonly defaultClientId?: string
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

    const storedJobs = await this.clientRegistry.listAllJobs();
    storedJobs.forEach((job) => {
      this.jobs.set(job.jobId, job);
    });
    this.initialized = true;
    this.emit('ready', this.getJobs());
  }

  getJobs(): OwnedJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJobsForClient(clientId?: string): OwnedJob[] {
    const owner = this.resolveClientId(clientId);
    return this.getJobs().filter((job) => job.clientId === owner);
  }

  async search(query: string): Promise<SearchResult[]> {
    const initial = await this.apiClient.search(query);
    const filtered = this.searchPipeline.length === 0 ? initial : await this.applySearchPipeline(initial);
    return this.applyLimit(this.cycleProviders(filtered));
  }

  private applyLimit(results: SearchResult[]): SearchResult[] {
    if (this.searchLimit <= 0) {
      return results;
    }
    return results.slice(0, this.searchLimit);
  }

  async getSearchResultDetail(result: SearchResult): Promise<SearchResultDetail | undefined> {
    const detail = await this.apiClient.getSearchResultDetail(result.provider, result.id);
    if (!detail) {
      return undefined;
    }
    const resolvedTitle = resolveTorrentTitle(result, detail);
    const resolvedSizeBytes = resolveTorrentSizeBytes(result, detail);
    const normalizedHash = detail.hash && detail.hash.trim().length > 0 ? detail.hash : null;
    return {
      ...detail,
      providerLabel: result.providerLabel,
      title: resolvedTitle,
      sizeBytes: resolvedSizeBytes,
      hash: normalizedHash
    };
  }

  async startDownload(result: SearchResultDetail, clientId?: string): Promise<OwnedJob> {
    const owner = this.resolveClientId(clientId);
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
        result.sizeBytes ?? undefined,
        response.error,
        response.shortUrl,
        response.s3ObjectKey
      );
      const owned = await this.clientRegistry.bindJobToClient(stored, owner);
      this.jobs.set(owned.jobId, owned);
      this.emit('jobUpdated', owned);
      if (response.status === 'completed' || response.status === 'error') {
        await this.syncJob(response.jobId);
      }
      return owned;
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

      const existing = this.jobs.get(jobId) ?? (await this.clientRegistry.getJob(jobId));
      if (!existing) {
        return;
      }
      let updated = mapDetailToStored(detail, existing ?? undefined);

      const owned: OwnedJob = { ...updated, clientId: existing.clientId };
      this.jobs.set(jobId, owned);
      await this.clientRegistry.updateJob(owned);
      this.emit('jobUpdated', owned);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  async syncAll(): Promise<void> {
    const jobsToSync = this.getJobs().filter(
      (job) => job.lastKnownStatus !== 'completed' && job.lastKnownStatus !== 'error'
    );
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
    const existing = this.jobs.get(jobId) ?? (await this.clientRegistry.getJob(jobId));
    if (!existing) {
      return;
    }
    this.jobs.delete(jobId);
    await this.clientRegistry.deleteJob(jobId);
    this.emit('jobRemoved', existing);
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

  private cycleProviders(results: SearchResult[]): SearchResult[] {
    if (results.length === 0) {
      return results;
    }
    const buckets = new Map<string, SearchResult[]>();
    const order: string[] = [];
    results.forEach((item) => {
      const provider = item.provider.toLowerCase();
      let bucket = buckets.get(provider);
      if (!bucket) {
        bucket = [];
        buckets.set(provider, bucket);
        order.push(provider);
      }
      bucket.push(item);
    });
    const output: SearchResult[] = [];
    let remaining = results.length;
    while (remaining > 0) {
      for (const provider of order) {
        const bucket = buckets.get(provider);
        if (!bucket || bucket.length === 0) {
          continue;
        }
        const next = bucket.shift();
        if (!next) {
          continue;
        }
        output.push(next);
        remaining -= 1;
      }
    }
    return output;
  }

  private resolveClientId(clientId?: string): string {
    const resolved = clientId ?? this.defaultClientId;
    if (!resolved) {
      throw new Error('clientId is required');
    }
    return resolved;
  }
}
