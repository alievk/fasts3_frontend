import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MemoryClientRegistry } from '../memoryClientRegistry.js';
import { SQLiteClientRegistry } from '../sqliteClientRegistry.js';
import { StoredJob } from '../types.js';

const baseJob = (): StoredJob => ({
  jobId: 'job-1',
  btih: 'btih-1',
  createdAt: new Date().toISOString(),
  lastKnownStatus: 'queued',
  lastSyncedAt: new Date().toISOString(),
  progress: 0,
  label: 'Sample job',
  statusUpdatedAt: new Date().toISOString(),
  s3Bucket: null,
  s3ObjectKey: null,
  manifest: null,
  s3Url: null,
  s3UrlExpiresAt: null,
  shortUrl: null,
  error: null,
  sizeBytes: null
});

const runCommonAssertions = async (registry: MemoryClientRegistry | SQLiteClientRegistry) => {
  const clientId = 'client-1';
  await registry.registerClient(clientId, { type: 'cli', profile: 'test' });
  await registry.bindJobToClient(baseJob(), clientId);
  const jobs = await registry.listJobs(clientId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.clientId, clientId);

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
  assert.equal(targets[0]?.transport.type, 'cli');

  await registry.deleteJob(owned.jobId);
  const afterDelete = await registry.listJobs(clientId);
  assert.equal(afterDelete.length, 0);
};

test('memory client registry stores and retrieves jobs', async () => {
  const registry = new MemoryClientRegistry();
  await runCommonAssertions(registry);
});

test('sqlite client registry persists data on disk', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'client-registry-'));
  const dbPath = path.join(tmpDir, 'clients.sqlite');
  const registry = new SQLiteClientRegistry(dbPath);
  await registry.registerClient('client-1', { type: 'cli' });
  await registry.bindJobToClient(baseJob(), 'client-1');
  const reopened = new SQLiteClientRegistry(dbPath);
  const jobs = await reopened.listAllJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.clientId, 'client-1');
  await runCommonAssertions(reopened);
  await fs.rm(tmpDir, { recursive: true, force: true });
});
