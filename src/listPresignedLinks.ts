#!/usr/bin/env node
import process from 'node:process';
import { loadConfig } from './config.js';

const main = async () => {
  const config = loadConfig();
  const endpoint = new URL('/admin/presigned', config.redirectServerBaseUrl);
  const response = await fetch(endpoint);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(
      `Failed to list presigned entries: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`
    );
    process.exit(1);
  }

  const entries = (await response.json()) as Array<{
    btih: string;
    url: string;
    expiresAt: string;
  }>;

  if (!entries || entries.length === 0) {
    console.log('No active presigned entries.');
    return;
  }

  const now = Date.now();
  console.table(
    entries.map((entry) => ({
      btih: entry.btih,
      status: new Date(entry.expiresAt).getTime() <= now ? 'expired' : 'ready',
      expiresAt: entry.expiresAt,
      url: entry.url
    }))
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
