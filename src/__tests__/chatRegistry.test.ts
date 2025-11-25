import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createChatRegistry } from '../chatRegistry.js';
import { MemoryChatRegistry } from '../memoryChatRegistry.js';
import { SQLiteChatRegistry } from '../sqliteChatRegistry.js';
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

const buildConfig = (provider: 'sqlite' | 'd1'): Config => ({
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
  userDbPath: ':memory:',
  d1AccountId: provider === 'd1' ? 'acc' : undefined,
  d1DatabaseId: provider === 'd1' ? 'db' : undefined,
  d1ApiToken: provider === 'd1' ? 'token' : undefined,
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

const createSqliteBackedFetch = () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return async (_url: string, init?: RequestInit) => {
    const rawBody = init?.body ?? '{}';
    const bodyText = typeof rawBody === 'string' ? rawBody : rawBody?.toString() ?? '{}';
    const payload = JSON.parse(bodyText);
    const sql = (payload.sql as string | undefined) ?? '';
    const params = Array.isArray(payload.params) ? payload.params : [];
    const args = params as any[];
    const stmt = db.prepare(sql);
    const command = sql.trim().split(/\s+/)[0]?.toLowerCase();
    const results = command === 'select' ? stmt.all(...args) : (stmt.run(...args), []);
    const responsePayload = {
      success: true,
      errors: [],
      result: [{ success: true, results }]
    };
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
};

test('memory chat registry stores and retrieves jobs', async () => {
  const registry = new MemoryChatRegistry();
  await runCommonAssertions(registry);
});

test('sqlite chat registry persists data on disk', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-registry-'));
  const dbPath = path.join(tmpDir, 'users.sqlite');
  const registry = new SQLiteChatRegistry(dbPath);
  await registry.registerChat('telegram-1');
  await registry.bindJobToChat(baseJob(), 'telegram-1');
  const reopened = new SQLiteChatRegistry(dbPath);
  const jobs = await reopened.listAllJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.telegramId, 'telegram-1');
  await runCommonAssertions(reopened);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('createChatRegistry returns sqlite registry when requested', async () => {
  const registry = createChatRegistry(buildConfig('sqlite'));
  assert.ok(registry instanceof SQLiteChatRegistry);
  await runCommonAssertions(registry);
});

test('createChatRegistry returns d1 registry when requested', async () => {
  const fetchStub = createSqliteBackedFetch();
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
