export type JobStatus = 'queued' | 'downloading' | 'completed' | 'error';

export interface SearchResult {
  id: string;
  title: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  magnet: string;
}

export type SearchResultStage = (results: SearchResult[]) => SearchResult[] | Promise<SearchResult[]>;

export type SearchResultPipeline = SearchResultStage[];

export interface JobDetail {
  jobId: string;
  status: JobStatus;
  progress: number | null;
  sizeBytes?: number | null;
  updatedAt: string;
  label?: string | null;
  error?: string | null;
}

export interface HealthResponse {
  status: string;
  version?: string;
}

export interface StoredJob {
  jobId: string;
  label?: string | null;
  createdAt: string;
  lastKnownStatus: JobStatus;
  lastSyncedAt: string;
  progress: number | null;
  s3Url?: string | null;
  error?: string | null;
  sizeBytes?: number | null;
}

export interface JobPresignResponse {
  jobId: string;
  bucket: string;
  key: string;
  s3Url: string;
  expiresIn: number;
}

export interface JobStoreData {
  jobs: Record<string, StoredJob>;
}

export interface CreateJobResponse {
  jobId: string;
  status: JobStatus;
  createdAt: string;
}

export interface Config {
  apiBaseUrl: string;
  apiToken?: string;
  pollingIntervalMs: number;
  statePath: string;
  searchLimit: number;
  searchPageSize: number;
  searchMinSizeBytes?: number;
  searchMaxSizeBytes?: number;
}

export interface ApiClient {
  search(query: string, limit?: number): Promise<SearchResult[]>;
  createJob(magnet: string, label?: string): Promise<CreateJobResponse>;
  getJob(jobId: string): Promise<JobDetail | undefined>;
  deleteJob(jobId: string): Promise<void>;
  health(): Promise<HealthResponse>;
  getJobPresignedLink(jobId: string): Promise<JobPresignResponse | undefined>;
}
