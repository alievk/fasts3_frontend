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
  error?: string | null;
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
  shortUrl?: string | null;
  error?: string | null;
  sizeBytes?: number | null;
}

export interface CreateJobResponse {
  jobId: string;
  btih: string;
  status: JobStatus;
  createdAt: string;
  statusUpdatedAt: string;
  progress: number | null;
  error: string | null;
  shortUrl: string | null;
}

export interface Config {
  apiBaseUrl: string;
  apiToken?: string;
  pollingIntervalMs: number;
  searchLimit: number;
  searchPageSize: number;
  searchRequestTimeoutMs: number;
  searchMinSizeBytes?: number;
  searchMaxSizeBytes?: number;
  playerBaseUrl: string;
  clientDbPath: string;
  botLocale?: string;
}

export interface ApiClient {
  search(query: string, limit?: number): Promise<SearchResult[]>;
  createJob(magnet: string, label?: string): Promise<CreateJobResponse>;
  getJob(jobId: string): Promise<JobDetail | undefined>;
  deleteJob(jobId: string): Promise<void>;
  health(): Promise<HealthResponse>;
}

export type ClientTransport =
  | { type: 'telegram'; chatId: number }
  | { type: 'cli'; profile?: string }
  | { type: 'web'; profile?: string };

export interface ClientRecord {
  clientId: string;
  transport: ClientTransport;
  createdAt: string;
  updatedAt: string;
  locale?: string | null;
}

export interface OwnedJob extends StoredJob {
  clientId: string;
}

export interface ClientNotificationTarget {
  clientId: string;
  transport: ClientTransport;
  locale?: string | null;
}

export interface ClientRegistry {
  registerClient(clientId: string, transport: ClientTransport): Promise<ClientRecord>;
  listJobs(clientId: string): Promise<OwnedJob[]>;
  listAllJobs(): Promise<OwnedJob[]>;
  getJob(jobId: string): Promise<OwnedJob | undefined>;
  bindJobToClient(job: StoredJob, clientId: string): Promise<OwnedJob>;
  updateJob(job: OwnedJob): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
  getNotificationTargets(jobId: string): Promise<ClientNotificationTarget[]>;
  getClientLocale(clientId: string): Promise<string | null>;
  setClientLocale(clientId: string, locale: string | null): Promise<void>;
}
