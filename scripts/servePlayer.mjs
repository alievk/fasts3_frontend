#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(repoRoot, '.env') });

const runtimeConfigPath = path.join(repoRoot, 'public', 'player', 'runtime-config.js');

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

const apiBaseUrl = normalizeUrl(process.env.TORRENT_API_URL);
if (apiBaseUrl) {
  config.apiBaseUrl = apiBaseUrl;
}

const runtimeSource = `window.__TORRENT_PLAYER_CONFIG__ = Object.assign({}, window.__TORRENT_PLAYER_CONFIG__, ${JSON.stringify(
  config
)});\n`;

await fs.writeFile(runtimeConfigPath, runtimeSource, 'utf8');

const server = spawn('npx', ['http-server', '.', '-p', '8080', '--cors'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env
});

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
