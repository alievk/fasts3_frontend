export type JobStatus = 'queued' | 'downloading' | 'uploading' | 'completed' | 'error';

export interface SearchResult {
  id: string;
  provider: string;
  providerLabel: string;
  title: string;
  sizeBytes: number | null;
  seeders: number;
  leechers: number;
}

export interface SearchResultFile {
  name: string;
  sizeBytes: number | null;
}

export interface SearchResultDetail {
  id: string;
  provider: string;
  providerLabel: string;
  title: string;
  sizeBytes: number | null;
  hash?: string | null;
  magnet: string;
  files: SearchResultFile[];
}

export type SearchResultStage = (results: SearchResult[]) => SearchResult[] | Promise<SearchResult[]>;

export type SearchResultPipeline = SearchResultStage[];

export interface JobDetail {
  jobId: string;
  hash: string;
  status: JobStatus;
  progress: number | null;
  sizeBytes?: number | null;
  statusUpdatedAt: string;
  label?: string | null;
  error?: string | null;
  shortUrl?: string | null;
  s3ObjectKey?: string | null;
}

export interface HealthResponse {
  status: string;
  version?: string;
}

export interface StoredJob {
  jobId: string;
  hash: string;
  label?: string | null;
  createdAt: string;
  lastKnownStatus: JobStatus;
  lastSyncedAt: string;
  statusUpdatedAt?: string | null;
  progress: number | null;
  shortUrl?: string | null;
  error?: string | null;
  sizeBytes?: number | null;
  s3ObjectKey?: string | null;
}

export interface CreateJobResponse {
  jobId: string;
  hash: string;
  status: JobStatus;
  createdAt: string;
  statusUpdatedAt: string;
  progress: number | null;
  error: string | null;
  shortUrl: string | null;
  s3ObjectKey: string | null;
}

export interface Config {
  apiBaseUrl: string;
  apiToken?: string;
  timezone: string;
  pollingIntervalMs: number;
  searchLimit: number;
  searchPageSize: number;
  searchRequestTimeoutMs: number;
  searchMinSizeBytes?: number;
  searchMaxSizeBytes?: number;
  playerBaseUrl: string;
  userDbProvider: UserDbProvider;
  userDbPath: string;
  d1AccountId?: string;
  d1DatabaseId?: string;
  d1ApiToken?: string;
  botLocale: string;
  botTranslationsBundle: BotTranslationsBundle;
}

export type UserDbProvider = 'sqlite' | 'd1';

export type BotTranslations = Record<string, Record<string, string | string[]>>;

export type BotTranslationsBundle = 'bot' | 'bot_fake';

export interface ApiClient {
  search(query: string): Promise<SearchResult[]>;
  getSearchResultDetail(provider: string, id: string): Promise<SearchResultDetail | undefined>;
  createJob(magnet: string, label?: string): Promise<CreateJobResponse>;
  getJob(jobId: string): Promise<JobDetail | undefined>;
  deleteJob(jobId: string): Promise<void>;
  health(): Promise<HealthResponse>;
}

export interface ChatRecord {
  telegramId: string;
  createdAt: string;
  updatedAt: string;
  locale?: string | null;
}

export interface OwnedJob extends StoredJob {
  telegramId: string;
}

export interface ChatNotificationTarget {
  telegramId: string;
  locale?: string | null;
}

export interface ChatRegistry {
  registerChat(telegramId: string): Promise<ChatRecord>;
  listJobs(telegramId: string): Promise<OwnedJob[]>;
  listAllJobs(): Promise<OwnedJob[]>;
  getJob(jobId: string): Promise<OwnedJob | undefined>;
  bindJobToChat(job: StoredJob, telegramId: string): Promise<OwnedJob>;
  updateJob(job: OwnedJob): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
  getNotificationTargets(jobId: string): Promise<ChatNotificationTarget[]>;
  getChatLocale(telegramId: string): Promise<string | null>;
  setChatLocale(telegramId: string, locale: string | null): Promise<void>;
}
