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
  btih: string;
  status: JobStatus;
  progress: number | null;
  sizeBytes?: number | null;
  updatedAt: string;
  label?: string | null;
  s3Bucket?: string | null;
  s3ObjectKey?: string | null;
  manifest?: string | null;
  error?: string | null;
}

export interface HealthResponse {
  status: string;
  version?: string;
}

export interface StoredJob {
  btih: string;
  label?: string | null;
  createdAt: string;
  lastKnownStatus: JobStatus;
  lastSyncedAt: string;
  progress: number | null;
  s3Bucket?: string | null;
  s3ObjectKey?: string | null;
  manifest?: string | null;
  s3Url?: string | null;
  presignExpiresAt?: string | null;
  redirectUrl?: string | null;
  redirectExpiresAt?: string | null;
  error?: string | null;
  sizeBytes?: number | null;
}

export interface JobPresignResponse {
  btih: string;
  bucket: string;
  key: string;
  s3Url: string;
  expiresIn: number;
}

export interface JobStoreData {
  jobs: Record<string, StoredJob>;
}

export interface CreateJobResponse {
  btih: string;
  status: JobStatus;
  createdAt: string;
  s3Bucket: string | null;
  s3ObjectKey: string | null;
  manifest: string | null;
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
  redirectDbPath: string;
  redirectServerHost: string;
  redirectServerPort: number;
  redirectServerBaseUrl: string;
}

export interface ApiClient {
  search(query: string, limit?: number): Promise<SearchResult[]>;
  createJob(magnet: string, label?: string): Promise<CreateJobResponse>;
  getJob(btih: string): Promise<JobDetail | undefined>;
  deleteJob(btih: string): Promise<void>;
  health(): Promise<HealthResponse>;
  getJobPresignedLink(btih: string): Promise<JobPresignResponse | undefined>;
}
