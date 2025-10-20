import path from 'node:path';
import dotenv from 'dotenv';
import { Config } from './types.js';

dotenv.config();

const DEFAULT_API_BASE_URL = 'https://mock.torrent-service.local';
const DEFAULT_POLLING_MS = 3000;

const resolveStatePath = (): string => {
  if (process.env.TORRENT_CLI_STATE_PATH) {
    return path.resolve(process.env.TORRENT_CLI_STATE_PATH);
  }

  const projectCache = path.resolve('.cache', 'torrent-cli', 'jobs.json');
  return projectCache;
};

export const loadConfig = (): Config => {
  const pollingEnv = process.env.TORRENT_CLI_POLL_MS;
  const pollingIntervalMs =
    pollingEnv !== undefined ? Math.max(1000, Number.parseInt(pollingEnv, 10) || DEFAULT_POLLING_MS) : DEFAULT_POLLING_MS;

  return {
    apiBaseUrl: process.env.TORRENT_API_URL ?? DEFAULT_API_BASE_URL,
    apiToken: process.env.TORRENT_API_TOKEN,
    pollingIntervalMs,
    statePath: resolveStatePath()
  };
};
