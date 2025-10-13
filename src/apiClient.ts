import { randomUUID } from 'node:crypto';
import { ApiClient, CreateJobResponse, JobDetail, JobStatus, SearchResult } from './types.js';

interface MockJob {
  jobId: string;
  status: JobStatus;
  progress: number;
  updatedAt: string;
  label?: string;
  magnet: string;
  error?: string | null;
  s3Url?: string | null;
}

const MOCK_RESULTS: SearchResult[] = [
  {
    id: 'rutracker-111',
    title: 'Ubuntu Noble 24.04 Desktop (64-bit)',
    sizeBytes: 3700000000,
    seeders: 1500,
    leechers: 120,
    magnet: 'magnet:?xt=urn:btih:ubuntu-noble-desktop'
  },
  {
    id: 'rutracker-222',
    title: 'Ubuntu Noble Server ISO',
    sizeBytes: 1400000000,
    seeders: 980,
    leechers: 45,
    magnet: 'magnet:?xt=urn:btih:ubuntu-noble-server'
  },
  {
    id: 'rutracker-333',
    title: 'Ubuntu Mate 24.04 x86_64',
    sizeBytes: 3600000000,
    seeders: 870,
    leechers: 60,
    magnet: 'magnet:?xt=urn:btih:ubuntu-mate'
  },
  {
    id: 'rutracker-444',
    title: 'Kubuntu Noble LTS (Official)',
    sizeBytes: 4100000000,
    seeders: 650,
    leechers: 55,
    magnet: 'magnet:?xt=urn:btih:kubuntu-noble'
  },
  {
    id: 'rutracker-555',
    title: 'Ubuntu Studio Noble LTS',
    sizeBytes: 4800000000,
    seeders: 320,
    leechers: 20,
    magnet: 'magnet:?xt=urn:btih:ubuntu-studio'
  }
];

export class MockApiClient implements ApiClient {
  private jobs = new Map<string, MockJob>();

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const sanitized = query.trim().toLowerCase();
    if (!sanitized) {
      return [];
    }

    return MOCK_RESULTS.filter((result) => result.title.toLowerCase().includes(sanitized)).slice(0, limit);
  }

  async createJob(magnet: string, label?: string): Promise<CreateJobResponse> {
    const jobId = `job-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    this.jobs.set(jobId, {
      jobId,
      status: 'queued',
      progress: 0,
      updatedAt: createdAt,
      label,
      magnet,
      s3Url: null,
      error: null
    });

    return { jobId, status: 'queued', createdAt };
  }

  async getJob(jobId: string): Promise<JobDetail | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    this.advanceJob(job);

    return {
      jobId: job.jobId,
      status: job.status,
      progress: job.status === 'completed' ? 1 : job.progress,
      updatedAt: job.updatedAt,
      s3Url: job.s3Url ?? null,
      label: job.label ?? null,
      error: job.error ?? null
    };
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  private advanceJob(job: MockJob): void {
    if (job.status === 'completed' || job.status === 'error') {
      return;
    }

    const increment = Math.random() * 0.35;
    job.progress = Math.min(1, job.progress + increment);

    if (job.progress >= 1) {
      job.status = 'completed';
      job.s3Url = `https://s3.mock/${job.jobId}/`;
    } else if (job.progress >= 0.01) {
      job.status = 'downloading';
    }

    job.updatedAt = new Date().toISOString();
  }
}

export const createApiClient = (): ApiClient => new MockApiClient();
