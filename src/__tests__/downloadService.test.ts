import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DownloadService } from '../downloadService.js';
import { MemoryClientRegistry } from '../memoryClientRegistry.js';
import type {
  ApiClient,
  CreateJobResponse,
  HealthResponse,
  JobDetail,
  SearchResult,
  SearchResultDetail
} from '../types.js';

class StubApiClient implements ApiClient {
  constructor(private readonly detail: SearchResultDetail) {}

  async search(): Promise<SearchResult[]> {
    return [];
  }

  async getSearchResultDetail(): Promise<SearchResultDetail | undefined> {
    return this.detail;
  }

  // The following methods are unused in these tests.
  async createJob(): Promise<CreateJobResponse> {
    throw new Error('not implemented');
  }

  async getJob(): Promise<JobDetail | undefined> {
    return undefined;
  }

  async deleteJob(): Promise<void> {
    return;
  }

  async health(): Promise<HealthResponse> {
    return { status: 'ok' };
  }
}

const baseSearchResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  id: '123',
  provider: 'rutracker',
  providerLabel: 'RuTracker',
  title: 'Search Title',
  sizeBytes: null,
  seeders: 0,
  leechers: 0,
  ...overrides
});

const baseDetail = (overrides: Partial<SearchResultDetail> = {}): SearchResultDetail => ({
  id: '123',
  provider: 'rutracker',
  providerLabel: 'RuTracker',
  title: 'Detail Title',
  sizeBytes: null,
  hash: null,
  magnet: 'magnet:?xt=urn:btih:123',
  files: [],
  ...overrides
});

test('getSearchResultDetail prefers search result title when both have names', async () => {
  const searchResult = baseSearchResult({ title: 'From Search' });
  const detail = baseDetail({ title: 'From Detail' });
  const service = new DownloadService(new StubApiClient(detail), new MemoryClientRegistry(), 10);

  const resolved = await service.getSearchResultDetail(searchResult);
  assert.ok(resolved);
  assert.equal(resolved.title, 'From Search');
});

test('getSearchResultDetail falls back to detail title when search title is just ID', async () => {
  const searchResult = baseSearchResult({ id: 'id-1', title: 'id-1' });
  const detail = baseDetail({ id: 'id-1', title: 'From Detail' });
  const service = new DownloadService(new StubApiClient(detail), new MemoryClientRegistry(), 10);

  const resolved = await service.getSearchResultDetail(searchResult);
  assert.ok(resolved);
  assert.equal(resolved.title, 'From Detail');
});

test('getSearchResultDetail falls back to ID when both titles are IDs', async () => {
  const searchResult = baseSearchResult({ id: 'id-2', title: 'id-2' });
  const detail = baseDetail({ id: 'id-2', title: 'id-2' });
  const service = new DownloadService(new StubApiClient(detail), new MemoryClientRegistry(), 10);

  const resolved = await service.getSearchResultDetail(searchResult);
  assert.ok(resolved);
  assert.equal(resolved.title, 'id-2');
});

