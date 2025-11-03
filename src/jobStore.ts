import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StoredJob, JobStoreData, JobStatus } from './types.js';

const defaultData = (): JobStoreData => ({ jobs: {} });

const ensureParentDir = async (filePath: string): Promise<void> => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
};

const writeAtomic = async (filePath: string, contents: string): Promise<void> => {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `${path.basename(filePath)}.${randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, contents, 'utf8');
  await fs.rename(tmpPath, filePath);
};

const isJobStatus = (value: unknown): value is JobStatus =>
  value === 'queued' || value === 'downloading' || value === 'uploading' || value === 'completed' || value === 'error';

const normalizeJobStoreData = (input: unknown): JobStoreData => {
  if (!input || typeof input !== 'object') {
    return defaultData();
  }

  const entries = (input as { jobs?: unknown }).jobs;
  if (!entries || typeof entries !== 'object') {
    return defaultData();
  }

  const jobs: Record<string, StoredJob> = {};
  for (const [key, rawJob] of Object.entries(entries as Record<string, unknown>)) {
    if (!rawJob || typeof rawJob !== 'object') {
      continue;
    }

    const entity = rawJob as Record<string, unknown>;
    const rawJobId = entity.jobId ?? entity.job_id ?? key;
    const jobId = typeof rawJobId === 'string' && rawJobId.trim() ? rawJobId.trim() : null;
    if (!jobId) {
      continue;
    }

    const rawBtih = entity.btih;
    const btih = typeof rawBtih === 'string' && rawBtih.trim() ? rawBtih.trim() : null;
    if (!btih) {
      continue;
    }

    const label = typeof entity.label === 'string' || entity.label === null ? (entity.label as string | null) : null;
    const createdAt = typeof entity.createdAt === 'string' ? entity.createdAt : new Date().toISOString();
    const lastKnownStatus = isJobStatus(entity.lastKnownStatus) ? (entity.lastKnownStatus as JobStatus) : 'queued';
    const lastSyncedAt = typeof entity.lastSyncedAt === 'string' ? entity.lastSyncedAt : createdAt;
    const statusUpdatedAt =
      typeof entity.statusUpdatedAt === 'string' ? (entity.statusUpdatedAt as string) : null;
    const progress =
      typeof entity.progress === 'number' && Number.isFinite(entity.progress) ? (entity.progress as number) : null;
    const s3Bucket = typeof entity.s3Bucket === 'string' ? (entity.s3Bucket as string) : null;
    const s3ObjectKey = typeof entity.s3ObjectKey === 'string' ? (entity.s3ObjectKey as string) : null;
    const manifest = typeof entity.manifest === 'string' ? (entity.manifest as string) : null;
    const s3Url = typeof entity.s3Url === 'string' ? (entity.s3Url as string) : null;
    const s3UrlExpiresAt =
      typeof entity.s3UrlExpiresAt === 'string' ? (entity.s3UrlExpiresAt as string) : null;
    const shortUrl = typeof entity.shortUrl === 'string' ? (entity.shortUrl as string) : null;
    const error = typeof entity.error === 'string' ? (entity.error as string) : null;
    const sizeBytes =
      typeof entity.sizeBytes === 'number' && Number.isFinite(entity.sizeBytes) ? (entity.sizeBytes as number) : null;

    jobs[jobId] = {
      jobId,
      btih,
      label,
      createdAt,
      lastKnownStatus,
      lastSyncedAt,
      statusUpdatedAt,
      progress,
      s3Bucket,
      s3ObjectKey,
      manifest,
      s3Url,
      s3UrlExpiresAt,
      shortUrl,
      error,
      sizeBytes
    };
  }

  return { jobs };
};

export class JobStore {
  private cache: JobStoreData | null = null;

  constructor(private readonly statePath: string) {}

  async load(): Promise<JobStoreData> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      this.cache = normalizeJobStoreData(JSON.parse(raw));
      return this.cache;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = defaultData();
        return this.cache;
      }
      throw error;
    }
  }

  async save(data: JobStoreData): Promise<void> {
    await ensureParentDir(this.statePath);
    await writeAtomic(this.statePath, JSON.stringify(data, null, 2));
    this.cache = data;
  }

  async upsert(job: StoredJob): Promise<void> {
    const data = await this.load();
    data.jobs[job.jobId] = job;
    await this.save(data);
  }

  async remove(jobId: string): Promise<void> {
    const data = await this.load();
    delete data.jobs[jobId];
    await this.save(data);
  }
}
