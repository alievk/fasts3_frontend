#!/usr/bin/env node
import process from 'node:process';
import { loadConfig } from './config.js';
import { JobStore } from './jobStore.js';

const main = async () => {
  const config = loadConfig();
  const store = new JobStore(config.statePath);
  const data = await store.load();
  const jobs = Object.values(data.jobs);

  if (!jobs || jobs.length === 0) {
    console.log('No stored jobs with download links.');
    return;
  }

  const now = Date.now();
  console.table(
    jobs.map((job) => {
      const expiresAt = job.s3UrlExpiresAt ?? null;
      const expiresTime = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
      const ready = job.shortUrl ?? job.s3Url;
      return {
        jobId: job.jobId,
        btih: job.btih,
        status: ready ? (Number.isNaN(expiresTime) || expiresTime > now ? 'ready' : 'expired') : 'pending',
        expiresAt: expiresAt ?? '—',
        shortUrl: job.shortUrl ?? '—',
        s3Url: job.shortUrl ? '—' : job.s3Url ?? '—'
      };
    })
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
