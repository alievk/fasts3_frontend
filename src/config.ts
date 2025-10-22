import path from 'node:path';
import dotenv from 'dotenv';
import { Config } from './types.js';

dotenv.config();

const DEFAULT_API_BASE_URL = 'https://mock.torrent-service.local';
const DEFAULT_POLLING_MS = 3000;
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_PAGE_SIZE = 5;

const parsePositiveInt = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

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
  const parsedLimit = parsePositiveInt(process.env.TORRENT_TELEGRAM_BOT_SEARCH_LIMIT);
  const searchLimit = parsedLimit ?? DEFAULT_SEARCH_LIMIT;
  const parsedPageSize = parsePositiveInt(process.env.TORRENT_TELEGRAM_BOT_PAGE_SIZE);
  const basePageSize = parsedPageSize ?? DEFAULT_PAGE_SIZE;
  const searchPageSize = Math.max(1, Math.min(searchLimit, basePageSize));

  return {
    apiBaseUrl: process.env.TORRENT_API_URL ?? DEFAULT_API_BASE_URL,
    apiToken: process.env.TORRENT_API_TOKEN,
    pollingIntervalMs,
    statePath: resolveStatePath(),
    searchLimit,
    searchPageSize
  };
};
