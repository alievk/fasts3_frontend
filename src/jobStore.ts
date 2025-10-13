import fs from 'node:fs/promises';
import path from 'node:path';
import { StoredJob, JobStoreData } from './types.js';

const defaultData = (): JobStoreData => ({ jobs: {} });

const ensureParentDir = async (filePath: string): Promise<void> => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
};

const writeAtomic = async (filePath: string, contents: string): Promise<void> => {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, contents, 'utf8');
  await fs.rename(tmpPath, filePath);
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
      this.cache = JSON.parse(raw) as JobStoreData;
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
