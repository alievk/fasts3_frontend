#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const playerDistDir = path.join(repoRoot, 'public', 'player');

dotenv.config({ path: path.join(repoRoot, '.env') });

const runtimeConfigPath = path.join(playerDistDir, 'runtime-config.js');
const timeZone = (process.env.TZ && process.env.TZ.trim()) || 'UTC';
process.env.TZ = timeZone;

const formatTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
  const offset = new Intl.DateTimeFormat('en', {
    timeZone,
    timeZoneName: 'shortOffset'
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  return offset ? `${formatted}.${ms} ${offset}` : `${formatted}.${ms}`;
};

const rewriteHttpServerLogLine = (line) => {
  const match = line.match(/^\[([^\]]+)\](.*)$/);
  if (!match) {
    return line;
  }
  const [, rawTimestamp, rest] = match;
  const parsed = new Date(rawTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return line;
  }
  return `[${formatTimestamp(parsed)}]${rest}`;
};

const normalizeUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const normalized = new URL(trimmed);
    return normalized.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
};

const config = {};

const apiBaseUrl = normalizeUrl(process.env.API_URL);
if (apiBaseUrl) {
  config.apiBaseUrl = apiBaseUrl;
}

const runtimeSource = `window.__TORRENT_PLAYER_CONFIG__ = Object.assign({}, window.__TORRENT_PLAYER_CONFIG__, ${JSON.stringify(
  config
)});\n`;

await fs.writeFile(runtimeConfigPath, runtimeSource, 'utf8');

const server = spawn('npx', ['http-server', playerDistDir, '-p', '8080', '--cors'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'inherit'],
  env: process.env
});

if (server.stdout) {
  const rl = readline.createInterface({ input: server.stdout });
  rl.on('line', (line) => {
    console.log(rewriteHttpServerLogLine(line));
  });
}

const shutdown = (code) => {
  if (!server.killed) {
    server.kill('SIGTERM');
  }
  process.exit(code);
};

server.on('exit', (code) => {
  shutdown(code ?? 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
