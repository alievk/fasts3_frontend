import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatRegistry } from '../chatRegistry.js';
import { MemoryChatRegistry } from '../memoryChatRegistry.js';
import { D1ChatRegistry } from '../d1ChatRegistry.js';
import { ChatRegistry, Config, StoredJob } from '../types.js';

const baseJob = (): StoredJob => ({
  jobId: 'job-1',
  hash: 'hash-1',
  createdAt: new Date().toISOString(),
  lastKnownStatus: 'queued',
  lastSyncedAt: new Date().toISOString(),
  progress: 0,
  label: 'Sample job',
  statusUpdatedAt: new Date().toISOString(),
  shortUrl: null,
  error: null,
  sizeBytes: null,
  s3ObjectKey: null
});

const buildConfig = (provider: 'd1'): Config => ({
  apiBaseUrl: 'http://localhost:8000/api',
  apiToken: 'token',
  timezone: 'UTC',
  pollingIntervalMs: 1000,
  searchLimit: 5,
  searchPageSize: 5,
  searchRequestTimeoutMs: 1000,
  searchMinSizeBytes: undefined,
  searchMaxSizeBytes: undefined,
  playerBaseUrl: 'http://localhost/player',
  userDbProvider: provider,
  d1AccountId: provider === 'd1' ? 'acc' : undefined,
  d1DatabaseId: provider === 'd1' ? 'db' : undefined,
  d1ApiToken: provider === 'd1' ? 'token' : undefined,
  paymentProvider: 'yookassa',
  yookassaShopId: 'shop',
  yookassaSecretKey: 'secret',
  botLocale: 'ru',
  botTranslationsBundle: 'bot'
});

const runCommonAssertions = async (registry: ChatRegistry) => {
  const telegramId = 'telegram-1';
  const firstRecord = await registry.registerChat(telegramId);
  assert.equal(firstRecord.locale ?? null, null);
  await registry.setChatLocale(telegramId, 'en');
  assert.equal(await registry.getChatLocale(telegramId), 'en');
  const secondRecord = await registry.registerChat(telegramId);
  assert.equal(secondRecord.locale, 'en');
  await registry.bindJobToChat(baseJob(), telegramId);
  const jobs = await registry.listJobs(telegramId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.telegramId, telegramId);

  const owned = jobs[0];
  if (!owned) {
    throw new Error('missing job');
  }
  owned.lastKnownStatus = 'completed';
  owned.progress = 1;
  await registry.updateJob(owned);

  const refreshed = await registry.getJob(owned.jobId);
  assert.equal(refreshed?.lastKnownStatus, 'completed');
  const targets = await registry.getNotificationTargets(owned.jobId);
  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.telegramId, telegramId);

  await registry.deleteJob(owned.jobId);
  const afterDelete = await registry.listJobs(telegramId);
  assert.equal(afterDelete.length, 0);
};

type FakeUserRow = {
  telegram_id: string;
  locale: string | null;
  created_at: string;
  updated_at: string;
};

type FakeJobRow = {
  job_id: string;
  telegram_id: string;
  payload: string;
  created_at: string;
  updated_at: string;
};

const createD1FetchStub = () => {
  const users = new Map<string, FakeUserRow>();
  const jobs = new Map<string, FakeJobRow>();

  const response = (results: unknown[]) =>
    new Response(
      JSON.stringify({
        success: true,
        errors: [],
        result: [{ success: true, results }]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const toJobList = (): FakeJobRow[] =>
    Array.from(jobs.values()).sort((a, b) => (a.created_at > b.created_at ? -1 : 1));

  const handler = async (_url: string, init?: RequestInit) => {
    const rawBody = init?.body ?? '{}';
    const bodyText = typeof rawBody === 'string' ? rawBody : rawBody?.toString() ?? '{}';
    const payload = JSON.parse(bodyText);
    const sql: string = payload.sql ?? '';
    const params: unknown[] = Array.isArray(payload.params) ? payload.params : [];
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith('create table') || normalized.startsWith('create index')) {
      return response([]);
    }

    if (normalized.startsWith('alter table users add column subscription_expires_at')) {
      return response([]);
    }

    if (normalized.startsWith('alter table users add column demo_used')) {
      return response([]);
    }

    if (normalized.startsWith('insert into users')) {
      const [telegramId, locale, createdAt, updatedAt] = params as [string, string | null, string, string];
      const existing = users.get(telegramId);
      const next: FakeUserRow = {
        telegram_id: telegramId,
        locale: existing?.locale ?? locale ?? null,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt
      };
      users.set(telegramId, next);
      return response([]);
    }

    if (normalized.startsWith('select * from users')) {
      const [telegramId] = params as [string];
      const row = users.get(telegramId);
      return response(row ? [row] : []);
    }

    if (normalized.startsWith('select locale from users')) {
      const [telegramId] = params as [string];
      const row = users.get(telegramId);
      return response(row ? [{ locale: row.locale }] : []);
    }

    if (normalized.startsWith('update users')) {
      const [locale, updatedAt, telegramId] = params as [string | null, string, string];
      const existing = users.get(telegramId);
      if (existing) {
        users.set(telegramId, { ...existing, locale, updated_at: updatedAt });
      }
      return response([]);
    }

    if (normalized.startsWith('insert into jobs')) {
      const [jobId, telegramId, payloadText, createdAt, updatedAt] = params as [string, string, string, string, string];
      const existing = jobs.get(jobId);
      const next: FakeJobRow = {
        job_id: jobId,
        telegram_id: telegramId,
        payload: payloadText,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt
      };
      jobs.set(jobId, next);
      return response([]);
    }

    if (normalized.startsWith('select * from jobs where job_id')) {
      const [jobId] = params as [string];
      const row = jobs.get(jobId);
      return response(row ? [row] : []);
    }

    if (normalized.startsWith('select * from jobs where telegram_id')) {
      const [telegramId] = params as [string];
      const rows = toJobList().filter((row) => row.telegram_id === telegramId);
      return response(rows);
    }

    if (normalized.startsWith('select * from jobs order by')) {
      return response(toJobList());
    }

    if (normalized.startsWith('delete from jobs')) {
      const [jobId] = params as [string];
      jobs.delete(jobId);
      return response([]);
    }

    if (normalized.startsWith('select u.*')) {
      const [jobId] = params as [string];
      const job = jobs.get(jobId);
      if (!job) {
        return response([]);
      }
      const user = users.get(job.telegram_id);
      return response(user ? [user] : []);
    }

    throw new Error(`Unhandled SQL in stub: ${sql}`);
  };

  return handler;
};

test('memory chat registry stores and retrieves jobs', async () => {
  const registry = new MemoryChatRegistry();
  await runCommonAssertions(registry);
});

test('createChatRegistry returns d1 registry when requested', async () => {
  const fetchStub = createD1FetchStub();
  const originalFetch = global.fetch;
  (global as any).fetch = fetchStub;
  try {
    const registry = createChatRegistry(buildConfig('d1'));
    assert.ok(registry instanceof D1ChatRegistry);
    await runCommonAssertions(registry);
  } finally {
    (global as any).fetch = originalFetch;
  }
});
