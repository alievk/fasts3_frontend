export type JobStatus = 'queued' | 'downloading' | 'uploading' | 'completed' | 'error';

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
  btih: string;
  status: JobStatus;
  progress: number | null;
  sizeBytes?: number | null;
  statusUpdatedAt: string;
  label?: string | null;
  s3Bucket?: string | null;
  s3ObjectKey?: string | null;
  manifest?: string | null;
  error?: string | null;
  s3Url?: string | null;
  s3UrlExpiresAt?: string | null;
  shortUrl?: string | null;
}

export interface HealthResponse {
  status: string;
  version?: string;
}

export interface StoredJob {
  jobId: string;
  btih: string;
  label?: string | null;
  createdAt: string;
  lastKnownStatus: JobStatus;
  lastSyncedAt: string;
  statusUpdatedAt?: string | null;
  progress: number | null;
  s3Bucket?: string | null;
  s3ObjectKey?: string | null;
  manifest?: string | null;
  s3Url?: string | null;
  s3UrlExpiresAt?: string | null;
  shortUrl?: string | null;
  error?: string | null;
  sizeBytes?: number | null;
}

export interface JobPresignResponse {
  jobId: string;
  btih: string;
  bucket: string;
  key: string;
  s3Url: string;
  expiresAt: string;
  shortUrl: string | null;
}

export interface JobStoreData {
  jobs: Record<string, StoredJob>;
}

export interface CreateJobResponse {
  jobId: string;
  btih: string;
  status: JobStatus;
  createdAt: string;
  statusUpdatedAt: string;
  progress: number | null;
  s3Bucket: string | null;
  s3ObjectKey: string | null;
  manifest: string | null;
  error: string | null;
  s3Url: string | null;
  s3UrlExpiresAt: string | null;
  shortUrl: string | null;
}

export interface Config {
  apiBaseUrl: string;
  apiToken?: string;
  pollingIntervalMs: number;
  statePath: string;
  searchLimit: number;
  searchPageSize: number;
  searchRequestTimeoutMs: number;
  searchMinSizeBytes?: number;
  searchMaxSizeBytes?: number;
  redirectDbPath: string;
  redirectServerHost: string;
  redirectServerPort: number;
  redirectServerBaseUrl: string;
}

export interface ApiClient {
  search(query: string, limit?: number): Promise<SearchResult[]>;
  createJob(magnet: string, label?: string): Promise<CreateJobResponse>;
  getJob(jobId: string): Promise<JobDetail | undefined>;
  deleteJob(jobId: string): Promise<void>;
  health(): Promise<HealthResponse>;
  getJobPresignedLink(jobId: string): Promise<JobPresignResponse | undefined>;
}
