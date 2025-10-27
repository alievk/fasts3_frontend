#!/usr/bin/env node
import process from 'node:process';
import { loadConfig } from './config.js';

const usage = () => {
  console.error('Usage: tsx src/registerPresignedLink.ts <jobId> <url> <expiresInSeconds|ISO8601>');
  process.exit(1);
};

const [, , jobId, url, expiresInput] = process.argv;

if (!jobId || !url || !expiresInput) {
  usage();
}

const parseExpiresAt = (input: string): Date => {
  const numeric = Number.parseFloat(input);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(Date.now() + numeric * 1000);
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    console.error(`Invalid expires input "${input}". Provide seconds (number) or ISO timestamp.`);
    process.exit(1);
  }
  return parsed;
};

const expiresAt = parseExpiresAt(expiresInput);
const config = loadConfig();

const main = async () => {
  const endpoint = new URL('/admin/presigned', config.redirectServerBaseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      url,
      expiresAt: expiresAt.toISOString()
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(
      `Failed to register ${jobId}: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`
    );
    process.exit(1);
  }

  console.log(
    `Registered ${jobId} with expiry ${expiresAt.toISOString()} (${Math.round(
      (expiresAt.getTime() - Date.now()) / 1000
    )}s remaining)`
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
