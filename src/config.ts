import dotenv from 'dotenv';
import type { BotTranslationsBundle, Config, PaymentProvider, UserDbProvider } from './types.js';

dotenv.config();

const DEFAULT_TIMEZONE = 'UTC';
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

const resolveUserDbProvider = (): UserDbProvider => {
  const raw = process.env.USER_DB_PROVIDER?.toLowerCase().trim();
  if (!raw || raw === 'd1') {
    return 'd1';
  }
  throw new Error(`Unsupported USER_DB_PROVIDER: ${raw}`);
};

const resolvePaymentProvider = (): PaymentProvider => {
  const raw = process.env.PAYMENT_PROVIDER?.toLowerCase().trim();
  if (!raw || raw === 'yookassa') {
    return 'yookassa';
  }
  throw new Error(`Unsupported PAYMENT_PROVIDER: ${raw}`);
};

const resolveBotTranslationsBundle = (): BotTranslationsBundle => {
  const raw = process.env.TELEGRAM_TRANSLATION_BUNDLE?.trim().toLowerCase();
  if (raw && raw !== 'bot') {
    console.warn(`Unknown TELEGRAM_TRANSLATION_BUNDLE "${raw}", falling back to "bot"`);
  }
  return 'bot';
};

const resolveTimezone = (): string => {
  const value = process.env.TZ?.trim();
  const timezone = value && value.length > 0 ? value : DEFAULT_TIMEZONE;
  process.env.TZ = timezone;
  return timezone;
};

export const loadConfig = (): Config => {
  const timezone = resolveTimezone();
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
  const botLocale = process.env.TELEGRAM_DEFAULT_BOT_LOCALE?.trim().toLowerCase();
  if (!botLocale) {
    throw new Error('TELEGRAM_DEFAULT_BOT_LOCALE is required');
  }
  const botTranslationsBundle = resolveBotTranslationsBundle();
  const userDbProvider = resolveUserDbProvider();
  const paymentProvider = resolvePaymentProvider();
  const yookassaShopId = process.env.YOOKASSA_SHOP_ID;
  const yookassaSecretKey = process.env.YOOKASSA_SECRET_KEY;
  const yookassaReceiptEmail = process.env.YOOKASSA_RECEIPT_EMAIL?.trim();
  if (paymentProvider === 'yookassa') {
    if (!yookassaShopId || !yookassaSecretKey) {
      throw new Error('YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY are required for Yookassa provider');
    }
  }
  const d1AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const d1DatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const d1ApiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (userDbProvider === 'd1') {
    if (!d1AccountId || !d1DatabaseId || !d1ApiToken) {
      throw new Error('CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN are required for D1 provider');
    }
  }

  const demoPlanId = parsePositiveInt(process.env.DEMO_PLAN_ID);
  const weeklyQuotaGb = parsePositiveFloat(process.env.WEEKLY_QUOTA_GB);

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
    userDbProvider,
    paymentProvider,
    yookassaShopId,
    yookassaSecretKey,
    yookassaReceiptEmail,
    d1AccountId,
    d1DatabaseId,
    d1ApiToken,
    botLocale,
    botTranslationsBundle,
    timezone,
    demoPlanId,
    weeklyQuotaGb
  };
};
