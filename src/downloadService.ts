import EventEmitter from 'node:events';
import {
  ApiClient,
  ChatRegistry,
  JobDetail,
  JobStatus,
  OwnedJob,
  SearchResult,
  SearchResultDetail,
  SearchResultPipeline,
  StoredJob
} from './types.js';
import { extractHashFromMagnet, normalizeHash } from './hashUtils.js';

export class QuotaExceededError extends Error {
  constructor(
    public readonly maxGb: number,
    public readonly retryInDays: number
  ) {
    super(`Quota exceeded: ${maxGb} GB limit, retry in ${retryInDays} days`);
    this.name = 'QuotaExceededError';
  }
}

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

const resolveTorrentSizeBytes = (result: SearchResult): number | null =>
  hasKnownSize(result.sizeBytes) ? result.sizeBytes : null;

const mapDetailToStored = (detail: JobDetail, existing?: StoredJob): StoredJob => ({
  jobId: detail.jobId,
  hash: detail.hash,
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


interface NewStoredJobParams {
  jobId: string;
  hash: string;
  label?: string;
  status: JobStatus;
  createdAt: string;
  statusUpdatedAt: string;
  progress: number | null;
  sizeBytes?: number;
  error: string | null;
  shortUrl: string | null;
  s3ObjectKey: string | null;
}

const newStoredJob = (params: NewStoredJobParams): StoredJob => ({
  jobId: params.jobId,
  hash: params.hash,
  label: params.label ?? null,
  createdAt: params.createdAt,
  lastKnownStatus: params.status,
  lastSyncedAt: new Date().toISOString(),
  statusUpdatedAt: params.statusUpdatedAt,
  progress: params.progress ?? (params.status === 'completed' ? 1 : 0),
  shortUrl: params.shortUrl,
  error: params.error ?? null,
  sizeBytes: params.sizeBytes ?? null,
  s3ObjectKey: params.s3ObjectKey ?? null
});

export const QUOTA_WINDOW_DAYS = 7;

export class DownloadService extends EventEmitter {
  private jobs = new Map<string, OwnedJob>();
  private initialized = false;
  private recordedCompletions = new Set<string>();

  constructor(
    private readonly apiClient: ApiClient,
    private readonly chatRegistry: ChatRegistry,
    private readonly searchLimit: number,
    private readonly searchPipeline: SearchResultPipeline = [],
    private readonly defaultTelegramId?: string
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

    const storedJobs = await this.chatRegistry.listAllJobs();
    storedJobs.forEach((job) => {
      this.jobs.set(job.jobId, job);
    });
    this.initialized = true;
    this.emit('ready', this.getJobs());
  }

  getJobs(): OwnedJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJobsForChat(telegramId?: string): OwnedJob[] {
    const owner = this.resolveTelegramId(telegramId);
    return this.getJobs().filter((job) => job.telegramId === owner);
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
    const resolvedSizeBytes = resolveTorrentSizeBytes(result);
    const normalizedHash = normalizeHash(detail.hash ?? null);
    return {
      ...detail,
      providerLabel: result.providerLabel,
      title: resolvedTitle,
      sizeBytes: resolvedSizeBytes,
      hash: normalizedHash,
      seeders: result.seeders,
      leechers: result.leechers
    };
  }

  async startDownload(result: SearchResultDetail, telegramId?: string): Promise<OwnedJob> {
    const owner = this.resolveTelegramId(telegramId);
    try {
      const canonicalHash =
        normalizeHash(result.hash ?? null) ?? extractHashFromMagnet(result.magnet);

      if (canonicalHash) {
        const existingJobs = this.getJobsForChat(owner).filter((job) =>
          normalizeHash(job.hash) === canonicalHash
        );
        if (existingJobs.length > 0) {
          const completedJobs = existingJobs.filter((job) => job.lastKnownStatus === 'completed');
          const candidates = completedJobs.length > 0 ? completedJobs : existingJobs;
          const best = candidates.reduce((latest, job) =>
            job.createdAt.localeCompare(latest.createdAt) > 0 ? job : latest
          );
          await this.syncJob(best.jobId);
          const refreshed =
            this.jobs.get(best.jobId) ?? (await this.chatRegistry.getJob(best.jobId)) ?? best;
          return refreshed;
        }
      }

      const userQuotaGb = await this.chatRegistry.getUserQuota(owner);
      if (userQuotaGb !== null) {
        const usageBytes = await this.chatRegistry.getUsageBytes(owner, QUOTA_WINDOW_DAYS);
        const newSizeBytes = result.sizeBytes ?? 0;
        const projectedGb = (usageBytes + newSizeBytes) / (1024 ** 3);
        if (projectedGb > userQuotaGb) {
          const oldest = await this.chatRegistry.getOldestDownloadDate(owner, QUOTA_WINDOW_DAYS);
          const retryInDays = oldest
            ? Math.max(1, Math.ceil(QUOTA_WINDOW_DAYS - (Date.now() - oldest.getTime()) / (24 * 60 * 60 * 1000)))
            : 1;
          throw new QuotaExceededError(userQuotaGb, retryInDays);
        }
      }

      const response = await this.apiClient.createJob(result.magnet, result.title);
      const stored = newStoredJob({
        jobId: response.jobId,
        hash: response.hash,
        label: result.title,
        status: response.status,
        createdAt: response.createdAt,
        statusUpdatedAt: response.statusUpdatedAt,
        progress: response.progress,
        sizeBytes: result.sizeBytes ?? undefined,
        error: response.error,
        shortUrl: response.shortUrl,
        s3ObjectKey: response.s3ObjectKey
      });
      const owned = await this.chatRegistry.bindJobToChat(stored, owner);
      this.jobs.set(owned.jobId, owned);
      this.emit('jobUpdated', owned);
      if (response.status === 'completed' || response.status === 'error') {
        await this.syncJob(response.jobId);
      }
      return owned;
    } catch (error) {
      if (!(error instanceof QuotaExceededError)) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
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

      const existing = this.jobs.get(jobId) ?? (await this.chatRegistry.getJob(jobId));
      if (!existing) {
        return;
      }
      const updated = mapDetailToStored(detail, existing ?? undefined);
      const owned: OwnedJob = { ...updated, telegramId: existing.telegramId };
      this.jobs.set(jobId, owned);
      await this.chatRegistry.updateJob(owned);

      if (detail.status === 'completed' && !this.recordedCompletions.has(jobId)) {
        const sizeBytes = detail.sizeBytes ?? owned.sizeBytes;
        if (hasKnownSize(sizeBytes)) {
          await this.chatRegistry.recordDownload(owned.telegramId, jobId, owned.hash, sizeBytes);
          this.recordedCompletions.add(jobId);
        }
      }

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
    const existing = this.jobs.get(jobId) ?? (await this.chatRegistry.getJob(jobId));
    if (!existing) {
      return;
    }
    this.jobs.delete(jobId);
    await this.chatRegistry.deleteJob(jobId);
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

  private resolveTelegramId(telegramId?: string): string {
    const resolved = telegramId ?? this.defaultTelegramId;
    if (!resolved) {
      throw new Error('telegramId is required');
    }
    return resolved;
  }
}
