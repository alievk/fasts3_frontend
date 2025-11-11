import path from 'node:path';
import dotenv from 'dotenv';
import { Config } from './types.js';

dotenv.config();

const DEFAULT_API_BASE_URL = 'http://localhost:8000/api';
const DEFAULT_POLLING_MS = 3000;
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_PAGE_SIZE = 5;
const DEFAULT_MIN_SIZE_GIB = 0.6;
const DEFAULT_MAX_SIZE_GIB = 5;
const DEFAULT_SEARCH_TIMEOUT_MS = 10000;

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

const parsePositiveFloat = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

const resolveClientDbPath = (): string => {
  if (process.env.TORRENT_CLIENT_DB_PATH) {
    return path.resolve(process.env.TORRENT_CLIENT_DB_PATH);
  }

  return path.resolve('.cache', 'torrent-cli', 'clients.sqlite');
};

export const loadConfig = (): Config => {
  const apiBaseUrl = process.env.TORRENT_API_URL ?? DEFAULT_API_BASE_URL;
  const pollingEnv = process.env.TORRENT_CLI_POLL_MS;
  const pollingIntervalMs =
    pollingEnv !== undefined ? Math.max(1000, Number.parseInt(pollingEnv, 10) || DEFAULT_POLLING_MS) : DEFAULT_POLLING_MS;
  const parsedLimit = parsePositiveInt(process.env.TORRENT_TELEGRAM_BOT_SEARCH_LIMIT);
  const searchLimit = parsedLimit ?? DEFAULT_SEARCH_LIMIT;
  const parsedPageSize = parsePositiveInt(process.env.TORRENT_TELEGRAM_BOT_PAGE_SIZE);
  const basePageSize = parsedPageSize ?? DEFAULT_PAGE_SIZE;
  const searchPageSize = Math.max(1, Math.min(searchLimit, basePageSize));
  const minSizeGiB = parsePositiveFloat(process.env.TORRENT_SEARCH_MIN_SIZE_GIB) ?? DEFAULT_MIN_SIZE_GIB;
  const maxSizeGiB = parsePositiveFloat(process.env.TORRENT_SEARCH_MAX_SIZE_GIB);
  const resolvedMaxGiB = maxSizeGiB ?? DEFAULT_MAX_SIZE_GIB;
  const resolvedMinGiB = Math.min(minSizeGiB, resolvedMaxGiB);
  const searchMinSizeBytes = Math.floor(resolvedMinGiB * 1024 * 1024 * 1024);
  const searchMaxSizeBytes = Math.floor(resolvedMaxGiB * 1024 * 1024 * 1024);
  const searchRequestTimeoutMs = parsePositiveInt(process.env.TORRENT_SEARCH_REQUEST_TIMEOUT_MS) ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const playerBaseUrl = process.env.PLAYER_BASE_URL;
  if (!playerBaseUrl) {
    throw new Error('PLAYER_BASE_URL is required');
  }
  const botLocale = process.env.TORRENT_TELEGRAM_BOT_LOCALE?.toLowerCase();

  return {
    apiBaseUrl,
    apiToken: process.env.TORRENT_API_TOKEN,
    pollingIntervalMs,
    searchLimit,
    searchPageSize,
    searchRequestTimeoutMs,
    searchMinSizeBytes,
    searchMaxSizeBytes,
    playerBaseUrl,
    clientDbPath: resolveClientDbPath(),
    botLocale
  };
};
