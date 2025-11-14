import { loadConfig } from './config.js';
import {
  ApiClient,
  CreateJobResponse,
  HealthResponse,
  JobDetail,
  SearchResult,
  SearchResultDetail,
  SearchResultFile
} from './types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_SEARCH_PAGE = '0';

type AggregatedSearchPayload = Record<string, unknown>;

type ProviderSearchEntry = {
  provider: string;
  providerLabel: string;
  items: SearchResult[];
};

const PROVIDER_LABEL_OVERRIDES: Record<string, string> = {
  rutracker: 'RuTracker',
  rutor: 'RuTor',
  kinozal: 'Kinozal',
  nonameclub: 'NoNameClub'
};

const normalizeProvider = (value: string): string => value.trim().toLowerCase();
const formatProviderLabel = (provider: string, explicit?: string): string => {
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }
  return PROVIDER_LABEL_OVERRIDES[provider] ?? provider;
};

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toTrimmedString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
};

const parseInteger = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/[^0-9-]+/g, '');
    if (normalized.length === 0) {
      return 0;
    }
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
  }
  return 0;
};

const parseSizeBytes = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const [amountRaw, unitRaw] = value.trim().split(/\s+/, 2);
  if (!amountRaw || !unitRaw) {
    return null;
  }
  const amount = Number.parseFloat(amountRaw.replace(/,/g, '.'));
  if (!Number.isFinite(amount)) {
    return null;
  }
  const multiplier = (() => {
    switch (unitRaw.toUpperCase()) {
      case 'GB':
        return GB;
      case 'MB':
        return MB;
      case 'KB':
        return KB;
      default:
        return null;
    }
  })();
  if (!multiplier) {
    return null;
  }
  return Math.round(amount * multiplier);
};

const parseFiles = (value: unknown): SearchResultFile[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return undefined;
      }
      const name = toTrimmedString(entry.Name ?? entry.name);
      if (!name) {
        return undefined;
      }
      const sizeBytes = parseSizeBytes(entry.Size ?? entry.size);
      return { name, sizeBytes };
    })
    .filter((file): file is SearchResultFile => Boolean(file));
};

const resolveTitle = (record: Record<string, unknown>, fallback: string): string => {
  const candidates = ['Name', 'Title', 'Original_Name'];
  for (const key of candidates) {
    const raw = toTrimmedString(record[key]);
    if (raw) {
      return raw;
    }
  }
  return fallback;
};

const normalizeResultId = (value: unknown, fallback: string): string => {
  const raw = toTrimmedString(value);
  return raw || fallback;
};

const mapToSearchResult = (record: Record<string, unknown>, provider: string, providerLabel: string): SearchResult | undefined => {
  const id = normalizeResultId(record.Id ?? record.id, '');
  if (!id) {
    return undefined;
  }
  const title = resolveTitle(record, id);
  return {
    id,
    provider,
    providerLabel,
    title,
    sizeBytes: parseSizeBytes(record.Size ?? record.size),
    seeders: parseInteger(record.Seeds ?? record.seeders),
    leechers: parseInteger(record.Peers ?? record.leechers)
  };
};

interface ServerCreateJobResponse {
  job_id: string;
  btih: string;
  status: string;
  status_updated_at: string;
  progress: number | null;
  error: string | null;
  short_url?: string | null;
  s3_object_key?: string | null;
}

interface ServerHealthResponse {
  status: string;
  version?: string;
}

interface ServerJobDetail {
  job_id: string;
  btih: string;
  status: string;
  progress: number | null;
  size_bytes?: number | null;
  status_updated_at: string;
  label?: string | null;
  error?: string | null;
  short_url?: string | null;
  s3_object_key?: string | null;
}

class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly searchRequestTimeoutMs: number;

  constructor(baseUrl: string, authToken: string, searchRequestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authToken = authToken;
    this.searchRequestTimeoutMs = searchRequestTimeoutMs;
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!query.trim()) {
      return [];
    }

    const params = new URLSearchParams({ query, page: DEFAULT_SEARCH_PAGE });
    const payload = await this.fetchJson<AggregatedSearchPayload>(
      `/search/title/all?${params.toString()}`,
      {},
      { timeoutMs: this.searchRequestTimeoutMs }
    );
    const entries = this.parseAggregatedResults(payload);
    if (entries.length === 0) {
      return [];
    }
    return this.interleaveResults(entries);
  }

  async getSearchResultDetail(provider: string, id: string): Promise<SearchResultDetail | undefined> {
    const normalizedProvider = normalizeProvider(provider);
    const trimmedId = id.trim();
    if (!normalizedProvider || !trimmedId) {
      return undefined;
    }
    const params = new URLSearchParams({ query: trimmedId });
    const payload = await this.fetchJson<unknown>(
      `/search/id/${encodeURIComponent(normalizedProvider)}?${params.toString()}`,
      {},
      { allowNotFound: true, timeoutMs: this.searchRequestTimeoutMs }
    );
    const records = Array.isArray(payload) ? payload : payload ? [payload] : [];
    for (const rawRecord of records) {
      if (!isRecord(rawRecord)) {
        continue;
      }
      const magnet = toTrimmedString(rawRecord.Magnet ?? rawRecord.magnet);
      if (!magnet) {
        continue;
      }
      const hash = toTrimmedString(rawRecord.Hash ?? rawRecord.hash);
      return {
        id: trimmedId,
        provider: normalizedProvider,
        providerLabel: formatProviderLabel(normalizedProvider),
        title: resolveTitle(rawRecord, trimmedId),
        sizeBytes: parseSizeBytes(rawRecord.Size ?? rawRecord.size),
        hash: hash || null,
        magnet,
        files: parseFiles(rawRecord.Files ?? rawRecord.files)
      };
    }
    return undefined;
  }

  async createJob(magnet: string, label?: string): Promise<CreateJobResponse> {
    const body = JSON.stringify({ magnet, label });
    const payload = await this.fetchJson<ServerCreateJobResponse>('/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    return {
      jobId: payload.job_id,
      btih: payload.btih,
      status: this.normalizeStatus(payload.status),
      createdAt: payload.status_updated_at ?? new Date().toISOString(),
      statusUpdatedAt: payload.status_updated_at,
      progress: payload.progress ?? null,
      error: payload.error ?? null,
      shortUrl: payload.short_url ?? null,
      s3ObjectKey: payload.s3_object_key ?? null
    };
  }

  async getJob(jobId: string): Promise<JobDetail | undefined> {
    const result = await this.fetchJson<ServerJobDetail>(
      `/jobs/${encodeURIComponent(jobId)}`,
      {},
      { allowNotFound: true }
    );

    if (!result) {
      return undefined;
    }

    return {
      jobId: result.job_id,
      btih: result.btih,
      status: this.normalizeStatus(result.status),
      progress: result.progress ?? null,
      sizeBytes: result.size_bytes ?? null,
      statusUpdatedAt: result.status_updated_at,
      label: result.label ?? null,
      error: result.error ?? null,
      shortUrl: result.short_url ?? null,
      s3ObjectKey: result.s3_object_key ?? null
    };
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.fetchJson(`/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }, { expectNoContent: true });
  }

  async health(): Promise<HealthResponse> {
    const payload = await this.fetchJson<ServerHealthResponse>('/health');
    return {
      status: payload.status,
      version: payload.version
    };
  }

  private parseAggregatedResults(payload: AggregatedSearchPayload | undefined): ProviderSearchEntry[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }
    const entries: ProviderSearchEntry[] = [];
    for (const [rawLabel, value] of Object.entries(payload)) {
      if (!Array.isArray(value) || value.length === 0) {
        continue;
      }
      const provider = normalizeProvider(rawLabel);
      const providerLabel = formatProviderLabel(provider, rawLabel);
      const items = value
        .map((item) => (isRecord(item) ? mapToSearchResult(item, provider, providerLabel) : undefined))
        .filter((result): result is SearchResult => Boolean(result));
      if (items.length > 0) {
        entries.push({ provider, providerLabel, items });
      }
    }
    return entries;
  }

  private interleaveResults(entries: ProviderSearchEntry[]): SearchResult[] {
    if (entries.length === 0) {
      return [];
    }
    const positions = new Map<string, number>();
    const results: SearchResult[] = [];
    let appended = true;
    while (appended) {
      appended = false;
      for (const entry of entries) {
        const index = positions.get(entry.provider) ?? 0;
        const item = entry.items[index];
        if (!item) {
          continue;
        }
        results.push(item);
        positions.set(entry.provider, index + 1);
        appended = true;
      }
    }
    return results;
  }

  private normalizeStatus(status: string): JobDetail['status'] {
    switch (status) {
      case 'queued':
      case 'downloading':
      case 'uploading':
      case 'completed':
      case 'error':
        return status;
      default:
        throw new Error(`Unexpected job status received from API: ${status}`);
    }
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit = {},
    options: { allowNotFound?: boolean; expectNoContent?: boolean; timeoutMs?: number } = {}
  ): Promise<T> {
    const { allowNotFound = false, expectNoContent = false, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = options;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: this.buildHeaders(init.headers)
      });

      if (allowNotFound && response.status === 404) {
        return undefined as T;
      }

      if (!response.ok) {
        const message = await this.extractErrorMessage(response);
        throw new Error(message ?? `Request failed with status ${response.status}`);
      }

      if (expectNoContent || response.status === 204) {
        return undefined as T;
      }

      const text = await response.text();
      if (!text) {
        return undefined as T;
      }

      return JSON.parse(text) as T;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(extra?: HeadersInit): HeadersInit {
    const headers = new Headers(extra);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${this.authToken}`);
    return headers;
  }

  private async extractErrorMessage(response: Response): Promise<string | undefined> {
    try {
      const data = await response.json();
      if (data && typeof data === 'object' && 'error' in data && typeof (data as Record<string, unknown>).error === 'string') {
        return (data as Record<string, string>).error;
      }
    } catch {
      // ignore JSON parse errors and fall back to status text
    }
    return response.statusText || undefined;
  }
}

export const createApiClient = (): ApiClient => {
  const config = loadConfig();
  const token = config.apiToken ?? 'change-me';
  return new HttpApiClient(config.apiBaseUrl, token, config.searchRequestTimeoutMs);
};
