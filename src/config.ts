import path from 'node:path';
import dotenv from 'dotenv';
import type { BotTranslationsBundle, ClientDbProvider, Config } from './types.js';

dotenv.config();

const DEFAULT_API_BASE_URL = 'http://localhost:8000/api';
const DEFAULT_POLLING_MS = 3000;
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_PAGE_SIZE = 5;
const DEFAULT_MIN_SIZE_GIB = 0;
const DEFAULT_MAX_SIZE_GIB = Number.POSITIVE_INFINITY;
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
  const explicitPath = process.env.CLIENT_DB_PATH ?? process.env.LOCAL_SQLITE_DB_PATH;
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  return path.resolve('.cache', 'torrent-cli', 'clients.sqlite');
};

const resolveClientDbProvider = (): ClientDbProvider => {
  const raw = process.env.CLIENT_DB_PROVIDER?.toLowerCase().trim();
  if (!raw || raw === 'sqlite') {
    return 'sqlite';
  }
  if (raw === 'd1') {
    return 'd1';
  }
  throw new Error(`Unsupported CLIENT_DB_PROVIDER: ${raw}`);
};

const resolveBotTranslationsBundle = (): BotTranslationsBundle => {
  const raw = process.env.TELEGRAM_LOCALE?.trim().toLowerCase();
  if (raw === 'bot_fake') {
    return 'bot_fake';
  }
  if (raw && raw !== 'bot') {
    console.warn(`Unknown TELEGRAM_LOCALE "${raw}", falling back to "bot"`);
  }
  return 'bot';
};

export const loadConfig = (): Config => {
  const apiBaseUrl = process.env.API_URL ?? DEFAULT_API_BASE_URL;
  const pollingEnv = process.env.CLI_POLL_MS;
  const pollingIntervalMs =
    pollingEnv !== undefined ? Math.max(1000, Number.parseInt(pollingEnv, 10) || DEFAULT_POLLING_MS) : DEFAULT_POLLING_MS;
  const parsedLimit = parsePositiveInt(process.env.TELEGRAM_BOT_SEARCH_LIMIT);
  const searchLimit = parsedLimit ?? DEFAULT_SEARCH_LIMIT;
  const parsedPageSize = parsePositiveInt(process.env.TELEGRAM_BOT_PAGE_SIZE);
  const basePageSize = parsedPageSize ?? DEFAULT_PAGE_SIZE;
  const searchPageSize = Math.max(1, Math.min(searchLimit, basePageSize));
  const minSizeGiB = parsePositiveFloat(process.env.SEARCH_MIN_SIZE_GIB) ?? DEFAULT_MIN_SIZE_GIB;
  const maxSizeGiB = parsePositiveFloat(process.env.SEARCH_MAX_SIZE_GIB) ?? DEFAULT_MAX_SIZE_GIB;
  const resolvedMinGiB = Math.min(minSizeGiB, maxSizeGiB);
  const searchMinSizeBytes =
    Number.isFinite(resolvedMinGiB) && resolvedMinGiB > 0 ? Math.floor(resolvedMinGiB * 1024 * 1024 * 1024) : undefined;
  const searchMaxSizeBytes =
    Number.isFinite(maxSizeGiB) && maxSizeGiB > 0 ? Math.floor(maxSizeGiB * 1024 * 1024 * 1024) : undefined;
  const searchRequestTimeoutMs = parsePositiveInt(process.env.SEARCH_REQUEST_TIMEOUT_MS) ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const playerBaseUrl = process.env.PLAYER_BASE_URL;
  if (!playerBaseUrl) {
    throw new Error('PLAYER_BASE_URL is required');
  }
  const botLocale = process.env.TELEGRAM_BOT_LOCALE?.toLowerCase();
  const botTranslationsBundle = resolveBotTranslationsBundle();
  const clientDbProvider = resolveClientDbProvider();
  const d1AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const d1DatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const d1ApiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (clientDbProvider === 'd1') {
    if (!d1AccountId || !d1DatabaseId || !d1ApiToken) {
      throw new Error('CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN are required for D1 provider');
    }
  }

  return {
    apiBaseUrl,
    apiToken: process.env.API_TOKEN,
    pollingIntervalMs,
    searchLimit,
    searchPageSize,
    searchRequestTimeoutMs,
    searchMinSizeBytes,
    searchMaxSizeBytes,
    playerBaseUrl,
    clientDbProvider,
    clientDbPath: resolveClientDbPath(),
    d1AccountId,
    d1DatabaseId,
    d1ApiToken,
    botLocale,
    botTranslationsBundle
  };
};
