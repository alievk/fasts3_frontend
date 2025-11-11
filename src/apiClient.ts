import { loadConfig } from './config.js';
import { ApiClient, CreateJobResponse, HealthResponse, JobDetail, SearchResult } from './types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

interface ServerSearchResult {
  id: string;
  title: string;
  size_bytes: number;
  seeders: number;
  leechers: number;
  magnet: string;
}

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

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    if (!query.trim()) {
      return [];
    }

    const params = new URLSearchParams({ query, limit: String(limit) });
    const payload = await this.fetchJson<ServerSearchResult[]>(`/search?${params.toString()}`, {}, { timeoutMs: this.searchRequestTimeoutMs });
    return payload.map((item) => ({
      id: item.id,
      title: item.title,
      sizeBytes: item.size_bytes,
      seeders: item.seeders,
      leechers: item.leechers,
      magnet: item.magnet
    }));
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
