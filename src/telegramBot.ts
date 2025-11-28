import { Agent as HttpsAgent } from 'node:https';
import { Telegraf, Markup } from 'telegraf';
import type { Context } from 'telegraf';
import { createApiClient } from './apiClient.js';
import { DownloadService, QuotaExceededError, QUOTA_WINDOW_DAYS } from './downloadService.js';
import { Poller } from './poller.js';
import type {
  ApiClient,
  BotTranslations,
  ChatRegistry,
  Config,
  PaymentClient,
  PaymentOrder,
  PaymentStatus,
  PaymentPlan,
  SearchResultPipeline
} from './types.js';
import { JobStatus, OwnedJob, SearchResult, SearchResultDetail } from './types.js';
import { normalizeHash } from './hashUtils.js';
import { createSearchPipeline } from './searchPipeline.js';
import { createChatRegistry } from './chatRegistry.js';
import botTranslationsData from './locales/bot.json' with { type: 'json' };
import { D1PaymentStore } from './d1PaymentStore.js';
import { createPaymentClient } from './paymentClient.js';

type SendMessageExtra = Parameters<Telegraf['telegram']['sendMessage']>[2];
type EditMessageTextExtra = Parameters<Context['editMessageText']>[1];

/*
  Assumptions:
  - bot only handles 1:1 private chats (each chat.id is a single client)
  - each OwnedJob has exactly one Telegram owner chat
  - /start payloads and callback data are ephemeral and may expire between restarts
*/

const withDisabledPreview = (extra?: SendMessageExtra): SendMessageExtra =>
  ({
    ...(extra as object),
    disable_web_page_preview: true
  } as SendMessageExtra);

const withDisabledPreviewEdit = (extra?: EditMessageTextExtra): EditMessageTextExtra =>
  ({
    ...(extra as object),
    disable_web_page_preview: true
  } as EditMessageTextExtra);

let config: Config;
const TRANSLATION_BUNDLES: Record<'bot', BotTranslations> = {
  bot: botTranslationsData as BotTranslations
};

type PaymentStore = {
  listVisiblePlans: () => Promise<PaymentPlan[]>;
  getPlan: (planId: number) => Promise<PaymentPlan | undefined>;
  findPendingOrder: (userId: string, planId: number, provider: string) => Promise<PaymentOrder | undefined>;
  createOrder: (params: {
    userId: string;
    planId: number;
    amount: number;
    provider: string;
    externalId?: string | null;
    status?: PaymentStatus;
  }) => Promise<PaymentOrder>;
  setOrderExternalId: (orderId: number, externalId: string) => Promise<void>;
  getSubscriptionExpiresAt: (telegramId: string) => Promise<string | null>;
  setSubscriptionExpiresAt: (telegramId: string, expiresAt: string | null, timestamp: string) => Promise<void>;
  getDemoUsed: (telegramId: string) => Promise<boolean>;
  setDemoUsed: (telegramId: string, used: boolean, timestamp: string) => Promise<void>;
};

let botTranslations: BotTranslations = TRANSLATION_BUNDLES.bot;
type TranslationParams = Record<string, string | number>;
const PRIMARY_LOCALE = 'ru';
const isSupportedLocale = (locale?: string): locale is string =>
  Boolean(locale && Object.prototype.hasOwnProperty.call(botTranslations, locale));
let defaultLocale = PRIMARY_LOCALE;
const normalizeTranslationValue = (value: string | string[]): string => (Array.isArray(value) ? value.join('') : value);
const resolveTemplate = (locale: string, key: string): string | undefined => {
  const value = botTranslations[locale]?.[key];
  if (value === undefined) {
    return undefined;
  }
  return normalizeTranslationValue(value);
};
const formatTemplate = (template: string, params?: TranslationParams): string =>
  template.replace(/\{([^}]+)\}/g, (_match, token: string) => {
    const value = params?.[token.trim()];
    return value === undefined ? '' : String(value);
  });
const translate = (key: string, locale: string, params?: TranslationParams): string => {
  const template = resolveTemplate(locale, key) ?? resolveTemplate(PRIMARY_LOCALE, key) ?? key;
  return formatTemplate(template, params);
};
const chatLocales = new Map<number, string>();
const getLocaleFlag = (locale: string): string => {
  if (locale === 'ru') {
    return '🇷🇺';
  }
  if (locale === 'en') {
    return '🇬🇧';
  }
  return '';
};
const cacheChatLocale = (chatId: number, locale: string | null | undefined): void => {
  if (!locale || locale === defaultLocale) {
    chatLocales.delete(chatId);
    return;
  }
  chatLocales.set(chatId, locale);
};
const getChatLocale = (chatId?: number): string => {
  if (chatId === undefined) {
    return defaultLocale;
  }
  const stored = chatLocales.get(chatId);
  return stored && isSupportedLocale(stored) ? stored : defaultLocale;
};
const setChatLocale = (chatId: number, locale: string): string => {
  const normalized = isSupportedLocale(locale) ? locale : defaultLocale;
  cacheChatLocale(chatId, normalized === defaultLocale ? null : normalized);
  return normalized;
};
const translateForChat = (chatId: number | undefined, key: string, params?: TranslationParams): string =>
  translate(key, getChatLocale(chatId), params);
const translateDefault = (key: string, params?: TranslationParams): string => translate(key, defaultLocale, params);
const getLocaleDisplayName = (locale: string): string => translate('locale.selfName', locale);
const getOrderedLocales = (): string[] => {
  const available = Object.keys(botTranslations).filter(isSupportedLocale);
  const preferredOrder = ['ru', 'en'];
  const primary = preferredOrder.filter((locale) => available.includes(locale));
  const extra = available.filter((locale) => !preferredOrder.includes(locale));
  return [...primary, ...extra];
};
const buildLanguageKeyboard = () => {
  const locales = getOrderedLocales();
  const buttons = locales.map((locale) => {
    const flag = getLocaleFlag(locale);
    const name = getLocaleDisplayName(locale);
    const label = flag ? `${flag} ${name}` : name;
    return Markup.button.callback(label, `set-locale:${locale}`);
  });
  return Markup.inlineKeyboard([buttons]);
};
const buildStartContent = (locale: string) => {
  const howItWorks = translate('common.howItWorksHtml', locale);
  const advantages = translate('common.advantagesHtml', locale);
  return {
    text: translate('start.messageHtml', locale, { howItWorks, advantages }),
    extra: { parse_mode: 'HTML' as const }
  };
};

const SUBSCRIPTION_PAYLOAD_PREFIX = 'subscription:';
const DEMO_ACTIVATE_PAYLOAD = 'demo:activate';

const formatPlanPrice = (price: number, locale: string): string => {
  try {
    return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0
    }).format(price);
  } catch {
    return `${price} RUB`;
  }
};

const formatPlanLabel = (plan: PaymentPlan, locale: string): string => {
  const price = formatPlanPrice(plan.price, locale);
  return `${plan.name} — ${price}`;
};

const formatPaymentLinkMessage = (plan: PaymentPlan, paymentUrl: string, locale: string): string => {
  const price = formatPlanPrice(plan.price, locale);
  const safeName = escapeHtml(plan.name);
  const safeUrl = escapeHtml(paymentUrl);
  return translate('subscription.paymentLinkHtml', locale, {
    plan: safeName,
    price,
    link: `<a href="${safeUrl}">${translate('subscription.payLinkLabel', locale)}</a>`
  });
};

const buildPaymentReturnUrl = (): string => {
  const username = getBotUsername();
  return `https://t.me/${username}`;
};

const formatOrderDescription = (orderId: number): string => `Order #${orderId}`;

const buildSubscriptionKeyboard = (plans: PaymentPlan[], locale: string, demoPlan?: PaymentPlan) => {
  const buttons = plans.map((plan) =>
    Markup.button.callback(formatPlanLabel(plan, locale), `${SUBSCRIPTION_PAYLOAD_PREFIX}${plan.id}`)
  );
  if (demoPlan) {
    const demoLabel = translate('subscription.demoButton', locale, { days: demoPlan.durationDays });
    buttons.unshift(Markup.button.callback(demoLabel, DEMO_ACTIVATE_PAYLOAD));
  }
  return Markup.inlineKeyboard(buttons, { columns: 1 });
};

const buildDemoOfferKeyboard = (demoPlan: PaymentPlan, locale: string) => {
  const demoLabel = translate('subscription.demoButton', locale, { days: demoPlan.durationDays });
  return Markup.inlineKeyboard([Markup.button.callback(demoLabel, DEMO_ACTIVATE_PAYLOAD)], { columns: 1 });
};

const sendStartMessage = async (
  chatId: number,
  replyFn?: (text: string, extra?: SendMessageExtra) => Promise<unknown>
): Promise<void> => {
  const locale = getChatLocale(chatId);
  const content = buildStartContent(locale);
  if (replyFn) {
    await replyFn(content.text, content.extra);
    return;
  }
  await sendTelegramMessage(chatId, content.text, content.extra);
};
let apiClient: ApiClient;
let chatRegistry: ChatRegistry;
let searchPipeline: SearchResultPipeline;
let downloadService: DownloadService;
let poller: Poller;
let paymentStore: PaymentStore;
let paymentClient: PaymentClient;
let bot: Telegraf;
let botUsername: string | undefined;
const getBotUsername = (): string => {
  if (!botUsername) {
    throw new Error('Bot username is not initialized');
  }
  return botUsername;
};

const isSubscriptionActive = async (telegramId: string): Promise<boolean> => {
  const expiresAt = await paymentStore.getSubscriptionExpiresAt(telegramId);
  if (!expiresAt) return false;
  return new Date(expiresAt) > new Date();
};

const getBotCommands = (locale: string) => [
  { command: 'search', description: translate('commands.searchDescription', locale) },
  { command: 'jobs', description: translate('commands.jobsDescription', locale) },
  { command: 'limit', description: translate('commands.limitDescription', locale) },
  { command: 'subscription', description: translate('commands.subscriptionDescription', locale) },
  { command: 'help', description: translate('commands.helpDescription', locale) },
  { command: 'lang', description: translate('commands.langDescription', locale) }
];

const activeChats = new Set<number>();
const completedJobs = new Set<string>();

const getPrivateChatId = (ctx: Context): number | undefined => {
  const chat = ctx.chat;
  if (!chat || chat.type !== 'private') {
    return undefined;
  }
  return chat.id;
};

type SearchSession = {
  results: SearchResult[];
  page: number;
  messageId?: number;
};

let searchPageSize = 1;
const DETAIL_PAYLOAD_PREFIX = 'details_';
const JOB_PAYLOAD_PREFIX = 'job_';
const DOWNLOAD_CONFIRM_PREFIX = 'confirm:';
const DOWNLOAD_CANCEL_ACTION = 'dismiss-detail';
const STREAM_INFO_PAYLOAD_PREFIX = 'streamhelp_';
const CANT_FIND_HELP_PAYLOAD_PREFIX = 'cantfind_';

const normalizeShortUrl = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const encodeResultToken = (result: SearchResult): string => `${result.provider.toLowerCase()}_${result.id}`;
const resolveSessionResult = (chatId: number, parsed: { provider: string; id: string }): SearchResult | null => {
  const session = searchSessions.get(chatId);
  if (!session) {
    return null;
  }
  const normalizedProvider = parsed.provider.toLowerCase();
  const fromSession = session.results.find(
    (item) => item.provider.toLowerCase() === normalizedProvider && item.id === parsed.id
  );
  return fromSession ?? null;
};

const parseDetailToken = (token: string | undefined | null): { provider: string; id: string } | null => {
  if (!token) {
    return null;
  }
  const [provider, ...rest] = token.split('_');
  if (!provider || rest.length === 0) {
    return null;
  }
  const id = rest.join('_');
  if (!id) {
    return null;
  }
  return { provider: provider.toLowerCase(), id };
};

const searchSessions = new Map<number, SearchSession>();
const removalSuppressions = new Map<string, string>();

const ensureTelegramChat = async (chatId: number): Promise<string> => {
  const telegramId = String(chatId);
  const record = await chatRegistry.registerChat(telegramId);
  cacheChatLocale(chatId, record.locale ?? null);
  return telegramId;
};

const getJobForChat = (jobId: string): OwnedJob | undefined =>
  downloadService.getJobs().find((item) => item.jobId === jobId);

const findOwnedJob = (jobId: string, telegramId: string): OwnedJob | undefined => {
  const job = getJobForChat(jobId);
  if (!job || job.telegramId !== telegramId) {
    return undefined;
  }
  return job;
};

let bootstrapPromise: Promise<void> | undefined;

const ensureBootstrapped = (): Promise<void> => {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await downloadService.init();
      try {
        await downloadService.checkHealth();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await broadcast((chatId) => translateForChat(chatId, 'health.checkFailed', { message }));
      }
      await downloadService.syncAll();
      poller.start();
    })();
  }
  return bootstrapPromise;
};

type TelegramErrorResponse = {
  error_code?: number;
  description?: string;
};

const getTelegramErrorResponse = (error: unknown): TelegramErrorResponse | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const response = (error as { response?: TelegramErrorResponse }).response;
  return response ?? null;
};

const sendTelegramMessage = async (
  chatId: number,
  message: string,
  extra?: Parameters<typeof bot.telegram.sendMessage>[2]
): Promise<void> => {
  try {
    await bot.telegram.sendMessage(chatId, message, withDisabledPreview(extra));
  } catch (error) {
    const response = getTelegramErrorResponse(error);
    if (response?.error_code === 403) {
      activeChats.delete(chatId);
    }
    console.error(`Failed to deliver message to ${chatId}:`, error);
  }
};

type MessageBuilder = string | ((chatId: number) => string);
type MessageExtraBuilder =
  | SendMessageExtra
  | ((chatId: number) => SendMessageExtra | undefined);

const broadcast = async (message: MessageBuilder, options?: { excludeChatId?: number }) => {
  const excludeChatId = options?.excludeChatId;
  if (activeChats.size === 0) {
    return;
  }
  await Promise.all(
    [...activeChats].map(async (chatId) => {
      if (excludeChatId !== undefined && chatId === excludeChatId) {
        return;
      }
      const text = typeof message === 'function' ? message(chatId) : message;
      await sendTelegramMessage(chatId, text);
    })
  );
};

const getJobOwnerChatId = (job: OwnedJob): number | null => {
  const parsed = Number.parseInt(job.telegramId, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const notifyJobOwner = async (
  job: OwnedJob,
  message: MessageBuilder,
  extra?: MessageExtraBuilder
): Promise<void> => {
  const chatId = getJobOwnerChatId(job);
  if (!chatId) {
    return;
  }
  const text = typeof message === 'function' ? message(chatId) : message;
  const extraValue = typeof extra === 'function' ? extra(chatId) : extra;
  await sendTelegramMessage(chatId, text, extraValue);
};

const isQueryTooOldError = (error: unknown): boolean => {
  const response = getTelegramErrorResponse(error);
  return response?.error_code === 400 && typeof response.description === 'string' && response.description.includes('query is too old');
};

const isMessageUnchangedError = (error: unknown): boolean => {
  const response = getTelegramErrorResponse(error);
  return response?.error_code === 400 && typeof response.description === 'string' && response.description.includes('message is not modified');
};

const safeAnswerCallback = async (
  ctx: Context,
  ...args: Parameters<Context['answerCbQuery']>
): Promise<void> => {
  try {
    await ctx.answerCbQuery(...args);
  } catch (error) {
    if (!isQueryTooOldError(error)) {
      throw error;
    }
  }
};

const safeEditMessageText = async (
  ctx: Context,
  ...args: Parameters<Context['editMessageText']>
): Promise<void> => {
  try {
    await ctx.editMessageText(...args);
  } catch (error) {
    if (!isMessageUnchangedError(error)) {
      throw error;
    }
  }
};

const isDeleteMessageErrorIgnorable = (error: unknown): boolean => {
  const description = getTelegramErrorResponse(error)?.description ?? '';
  if (!description) {
    return false;
  }
  return (
    description.includes('message to delete not found') ||
    description.includes("message can't be deleted") ||
    description.includes('message identifier is not valid')
  );
};

const deleteSearchMessage = async (chatId: number, messageId: number): Promise<void> => {
  try {
    await bot.telegram.deleteMessage(chatId, messageId);
  } catch (error) {
    if (!isDeleteMessageErrorIgnorable(error)) {
      console.error(`Failed to delete search message ${messageId} for chat ${chatId}:`, error);
    }
  }
};

const formatStatus = (status: JobStatus, locale: string): string => translate(`status.${status}`, locale);

const formatSize = (size: number | null | undefined, locale: string): string => {
  if (typeof size !== 'number' || Number.isNaN(size) || size <= 0) {
    return translate('common.unknown', locale);
  }
  const value = (size / (1024 * 1024 * 1024)).toFixed(2);
  return translate('common.sizeGb', locale, { value });
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const buildPlayerUrl = (jobId: string): string => {
  const normalizedBase = config.playerBaseUrl.replace(/\/+$/, '');
  return `${normalizedBase}?job_id=${encodeURIComponent(jobId)}`;
};

const canStreamJob = (job: OwnedJob): boolean => {
  if (job.lastKnownStatus !== 'completed') {
    return false;
  }
  const key = job.s3ObjectKey;
  if (!key) {
    return false;
  }
  const filename = key.split('/').pop() ?? key;
  return filename.toLowerCase().endsWith('.mp4');
};

const formatJobDetail = (job: OwnedJob, locale: string): string => {
  const title = job.label ?? job.hash;
  const statusText = formatStatus(job.lastKnownStatus, locale);
  const hasProgress = typeof job.progress === 'number' && !Number.isNaN(job.progress);
  let statusValue: string;
  if (job.lastKnownStatus === 'downloading' && hasProgress) {
    const percent = Math.round((job.progress ?? 0) * 100);
    statusValue = `${statusText} - ${percent}%`;
  } else if (job.lastKnownStatus === 'error' && job.error) {
    statusValue = `${statusText} - ${job.error}`;
  } else {
    statusValue = statusText;
  }
  const statusLine = translate('job.statusLine', locale, { status: statusValue });
  const sizeLine = translate('job.sizeLine', locale, {
    size: formatSize(job.sizeBytes ?? null, locale)
  });
  const jobIdLine = translate('job.jobIdLine', locale, { jobId: job.jobId });
  const hashLine = translate('job.hashLine', locale, { hash: job.hash });
  const downloadUrl = normalizeShortUrl(job.shortUrl ?? null);
  const playerUrl = canStreamJob(job) ? buildPlayerUrl(job.jobId) : undefined;
  const downloadLabel = translate('job.links.download', locale);
  const watchLabel = translate('job.links.watch', locale);
  let linksLine: string | null = null;
  const links: string[] = [];
  if (downloadUrl) {
    const downloadLink = `<a href="${escapeHtml(downloadUrl)}">${escapeHtml(downloadLabel)}</a>`;
    links.push(`⏬ ${downloadLink}`);
  }
  if (playerUrl) {
    const watchLink = `<a href="${escapeHtml(playerUrl)}">${escapeHtml(watchLabel)}</a>`;
    links.push(`🍿 ${watchLink}`);
  }
  if (links.length > 0) {
    linksLine = links.join(' ');
  }
  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    '',
    escapeHtml(statusLine),
    escapeHtml(sizeLine),
    escapeHtml(jobIdLine),
    escapeHtml(hashLine)
  ];
  if (linksLine) {
    lines.push('', linksLine);
  }
  return lines.join('\n');
};

const buildStartLink = (payload: string): string => {
  const username = getBotUsername();
  return `https://t.me/${username}?start=${encodeURIComponent(payload)}`;
};

const normalizeStartPayload = (payload?: string | null): string | undefined => {
  if (!payload) {
    return undefined;
  }
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
};

const parseJobPayload = (payload?: string | null): string | null => {
  if (!payload || !payload.startsWith(JOB_PAYLOAD_PREFIX)) {
    return null;
  }
  const jobId = payload.slice(JOB_PAYLOAD_PREFIX.length).trim();
  return jobId || null;
};

const normalizeDetailHash = (detail: SearchResultDetail): SearchResultDetail => {
  const trimmed = detail.hash?.trim();
  return { ...detail, hash: trimmed && trimmed.length > 0 ? trimmed : null };
};

const getLargestFileExtension = (detail: SearchResultDetail): string | null => {
  if (!detail.files.length) {
    return null;
  }
  const sorted = [...detail.files].sort((a, b) => {
    const left = a.sizeBytes ?? 0;
    const right = b.sizeBytes ?? 0;
    return right - left;
  });
  const candidate = sorted.find((file) => typeof file.sizeBytes === 'number' && file.sizeBytes > 0) ?? sorted[0];
  const name = candidate?.name ?? '';
  const match = name.match(/(\.[^.\s]+)$/i);
  if (!match) {
    return null;
  }
  const cleaned = match[1].toLowerCase().replace(/^\./, '');
  return cleaned.length > 0 ? cleaned : null;
};

const resolveStreamability = (detail: SearchResultDetail, locale: string, fallbackTitle: string) => {
  const rawExtension = getLargestFileExtension(detail);
  const normalizedExt = rawExtension?.toLowerCase();
  let canStream = normalizedExt === 'mp4';
  if (!canStream && (!rawExtension || detail.files.length === 0)) {
    const titleLookup = (detail.title ?? fallbackTitle).toLowerCase();
    if (titleLookup.includes('mp4')) {
      canStream = true;
    }
  }
  let extensionValue = rawExtension;
  if (!extensionValue) {
    const titleLookup = (detail.title ?? fallbackTitle).toLowerCase();
    if (titleLookup.includes('mp4')) {
      extensionValue = 'mp4';
    }
  }
  const extensionDisplay = extensionValue ?? translate('common.unknown', locale);
  extensionValue = extensionValue ?? 'unknown';
  return { canStream, extensionValue, extensionDisplay };
};

const formatDownloadLinkLine = (token: string, locale: string): string => {
  const payload = `${DETAIL_PAYLOAD_PREFIX}${token}`;
  const label = translate('search.downloadLinkLabel', locale);
  const link = `<a href="${buildStartLink(payload)}">${escapeHtml(label)}</a>`;
  return translate('search.downloadLinkLine', locale, { url: link });
};

const formatCantFindHelpLinkLine = (locale: string): string => {
  const label = translate('search.cantFindLinkLabel', locale);
  const url = escapeHtml(buildStartLink(CANT_FIND_HELP_PAYLOAD_PREFIX));
  return `<a href="${url}">${escapeHtml(label)}</a>`;
};

const parseDetailPayload = (payload?: string | null): string | null => {
  if (!payload || !payload.startsWith(DETAIL_PAYLOAD_PREFIX)) {
    return null;
  }
  const token = payload.slice(DETAIL_PAYLOAD_PREFIX.length).trim();
  return token || null;
};

const buildSearchPage = (results: SearchResult[], requestedPage: number, locale: string) => {
  const totalPages = Math.max(1, Math.ceil(results.length / searchPageSize));
  const page = Math.min(Math.max(requestedPage, 0), totalPages - 1);
  const startIndex = page * searchPageSize;
  const pageResults = results.slice(startIndex, startIndex + searchPageSize);
  const lines = pageResults.map((result, offset) => {
    const index = startIndex + offset;
    const displayIndex = index + 1;
    return [
      `${displayIndex}. ${escapeHtml(result.title)}`,
      escapeHtml(translate('search.providerLine', locale, { provider: result.providerLabel || result.provider })),
      escapeHtml(translate('search.sizeLine', locale, { size: formatSize(result.sizeBytes, locale) })),
      escapeHtml(translate('search.peersLine', locale, { seeders: result.seeders, leechers: result.leechers })),
      formatDownloadLinkLine(encodeResultToken(result), locale)
    ].join('\n');
  });
  const navButtons: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 0) {
    navButtons.push(Markup.button.callback(translate('search.prevPage', locale), `page:${page - 1}`));
  }
  if (page < totalPages - 1) {
    navButtons.push(Markup.button.callback(translate('search.nextPage', locale), `page:${page + 1}`));
  }
  const keyboard = navButtons.length > 0 ? Markup.inlineKeyboard([navButtons]) : undefined;
  const extra = keyboard ? { ...keyboard, parse_mode: 'HTML' as const } : ({ parse_mode: 'HTML' as const });
  const pageCounter = escapeHtml(translate('search.pageCounter', locale, { current: page + 1, total: totalPages }));
  const cantFindLinkLine = formatCantFindHelpLinkLine(locale);
  const text = `${lines.join('\n\n')}\n\n${cantFindLinkLine}\n\n${pageCounter}`;
  return {
    page,
    totalPages,
    text,
    extra
  };
};

const buildDownloadConfirmationKeyboard = (token: string, locale: string) =>
  Markup.inlineKeyboard(
    [Markup.button.callback(translate('search.detailConfirm', locale), `${DOWNLOAD_CONFIRM_PREFIX}${encodeURIComponent(token)}`)],
    { columns: 1 }
  );

const startDownloadFromToken = async (
  chatId: number,
  token: string,
  replyFn: (text: string, extra?: SendMessageExtra) => Promise<unknown>
): Promise<void> => {
  const locale = getChatLocale(chatId);
  const parsed = parseDetailToken(token);
  if (!parsed) {
    await replyFn(translate('search.expired', locale));
    return;
  }
  const baseResult = resolveSessionResult(chatId, parsed);
  if (!baseResult) {
    await replyFn(translate('search.expired', locale));
    return;
  }
  try {
    const fetchedDetail = await downloadService.getSearchResultDetail(baseResult);
    if (!fetchedDetail) {
      await replyFn(
        translate('search.detailUnavailable', locale, {
          provider: baseResult.providerLabel || baseResult.provider,
          id: baseResult.id
        })
      );
      return;
    }
    const detail = normalizeDetailHash(fetchedDetail);
    const { canStream, extensionValue, extensionDisplay } = resolveStreamability(detail, locale, baseResult.title);
    const streamOption = translate(canStream ? 'common.yes' : 'common.no', locale);
    const hashValue = detail.hash ?? translate('common.unknown', locale);
    const displayTitle = detail.title ?? baseResult.title;
    const titleLine = `<b>${escapeHtml(displayTitle)}</b>`;
    const providerLine = escapeHtml(
      translate('search.detailProviderLine', locale, {
        provider: baseResult.providerLabel || baseResult.provider
      })
    );
    const effectiveSizeBytes = baseResult.sizeBytes;
    const sizeLine = escapeHtml(
      translate('search.detailSizeLine', locale, { size: formatSize(effectiveSizeBytes, locale) })
    );
    const formatLine = escapeHtml(
      translate('search.detailExtensionLine', locale, { extension: extensionDisplay })
    );
    const streamPrefixRaw = translate('search.detailStreamLine', locale, { option: '' });
    const streamPrefix = escapeHtml(streamPrefixRaw.trimEnd());
    const streamValue = escapeHtml(streamOption);
    let streamLine = `${streamPrefix} <b>${streamValue}</b>`;
    if (!canStream) {
      const whyUrl = escapeHtml(buildStartLink(`${STREAM_INFO_PAYLOAD_PREFIX}${extensionValue}`));
      const whyLabel = escapeHtml(translate('search.streamWhy', locale));
      streamLine += ` (<a href="${whyUrl}">${whyLabel}</a>)`;
    }
    const idLine = escapeHtml(translate('search.detailIdLine', locale, { id: baseResult.id }));
    const hashLine = escapeHtml(translate('search.detailHashLine', locale, { hash: hashValue }));
    const detailLines = [titleLine, '', providerLine, idLine, hashLine, sizeLine, formatLine, streamLine];
    const keyboard = buildDownloadConfirmationKeyboard(token, locale);
    await replyFn(detailLines.join('\n'), { ...keyboard, parse_mode: 'HTML' as const });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await replyFn(translate('search.detailFailed', locale, { message }));
  }
};

const buildJobActionsKeyboard = (job: OwnedJob, locale: string) => {
  const encodedId = encodeURIComponent(job.jobId);
  const buttons = [
    Markup.button.callback(translate('jobs.actions.refresh', locale), `refresh:${encodedId}`),
    Markup.button.callback(translate('jobs.actions.delete', locale), `delete:${encodedId}`)
  ] as Parameters<typeof Markup.inlineKeyboard>[0];
  return Markup.inlineKeyboard(buttons, { columns: 1 });
};

const sendJobDetailMessage = async (
  chatId: number,
  telegramId: string,
  jobId: string,
  replyFn: (text: string, extra?: SendMessageExtra) => Promise<unknown>
): Promise<void> => {
  const job = findOwnedJob(jobId, telegramId);
  if (!job) {
    await replyFn(translateForChat(chatId, 'jobs.notFound', { jobId }));
    return;
  }
  const locale = getChatLocale(chatId);
  const keyboard = buildJobActionsKeyboard(job, locale);
  await replyFn(formatJobDetail(job, locale), { ...keyboard, parse_mode: 'HTML' as const });
};

const sendJobList = async (chatId: number, telegramId: string) => {
  const locale = getChatLocale(chatId);
  const jobs = downloadService.getJobsForChat(telegramId);
  if (jobs.length === 0) {
    await sendTelegramMessage(chatId, translate('jobs.listEmpty', locale));
    return;
  }
  const openLabel = escapeHtml(translate('search.downloadLinkLabel', locale));
  const lines = jobs.map((job, index) => {
    const title = job.label ?? job.hash;
    const statusText = formatStatus(job.lastKnownStatus, locale);
    const link = `<a href="${escapeHtml(buildStartLink(`${JOB_PAYLOAD_PREFIX}${job.jobId}`))}">${openLabel}</a>`;
    return `${index + 1}. ${escapeHtml(title)} - <b>${escapeHtml(statusText)}</b> - ${link}`;
  });
  const text = lines.join('\n\n');
  await sendTelegramMessage(chatId, text, { parse_mode: 'HTML' as const });
};

export type TelegramBotRuntime = {
  bot: Telegraf;
  start: () => Promise<void>;
  stop: (reason: string) => Promise<void>;
};

type TelegramBotDependencies = {
  apiClient?: ApiClient;
  chatRegistry?: ChatRegistry;
  searchPipeline?: SearchResultPipeline;
  downloadService?: DownloadService;
  poller?: Poller;
  paymentStore?: PaymentStore;
  paymentClient?: PaymentClient;
};

export const createTelegramBot = (
  botToken: string,
  providedConfig: Config,
  deps: TelegramBotDependencies = {}
): TelegramBotRuntime => {
  config = providedConfig;
  botTranslations = TRANSLATION_BUNDLES[config.botTranslationsBundle] ?? TRANSLATION_BUNDLES.bot;
  defaultLocale = isSupportedLocale(config.botLocale) ? config.botLocale : PRIMARY_LOCALE;
  searchPageSize = config.searchPageSize;
  apiClient = deps.apiClient ?? createApiClient();
  chatRegistry = deps.chatRegistry ?? createChatRegistry(config);
  searchPipeline = deps.searchPipeline ?? createSearchPipeline(config);
  downloadService =
    deps.downloadService ?? new DownloadService(apiClient, chatRegistry, config.searchLimit, searchPipeline);
  poller = deps.poller ?? new Poller(downloadService, config.pollingIntervalMs);
  paymentStore =
    deps.paymentStore ??
    (config.userDbProvider === 'd1'
      ? new D1PaymentStore(config.d1AccountId!, config.d1DatabaseId!, config.d1ApiToken!)
      : (() => {
          throw new Error(`Unsupported user DB provider: ${config.userDbProvider}`);
        })());
  paymentClient = deps.paymentClient ?? createPaymentClient(config);
  const telegramIpv4Agent = new HttpsAgent({ family: 4 });
  bot = new Telegraf(botToken, { telegram: { agent: telegramIpv4Agent } });

  bot.use(async (ctx, next) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId !== undefined) {
      activeChats.add(chatId);
      await ensureTelegramChat(chatId);
    }
    await ensureBootstrapped();
    return next();
  });

  const handleStartPayload = async (chatId: number, payload: string | undefined, ctx: Context): Promise<void> => {
    if (payload?.startsWith(STREAM_INFO_PAYLOAD_PREFIX)) {
      const extensionValue = payload.slice(STREAM_INFO_PAYLOAD_PREFIX.length) || 'unknown';
      await ctx.reply(
        translateForChat(chatId, 'search.streamExplanation', { extension: extensionValue }),
        withDisabledPreview()
      );
      return;
    }
    if (payload?.startsWith(CANT_FIND_HELP_PAYLOAD_PREFIX)) {
      await ctx.reply(translateForChat(chatId, 'search.cantFindHint'), withDisabledPreview());
      return;
    }
    const jobPayload = parseJobPayload(payload);
    if (jobPayload) {
      const telegramId = await ensureTelegramChat(chatId);
      await sendJobDetailMessage(chatId, telegramId, jobPayload, (text, extra) =>
        ctx.reply(text, withDisabledPreview(extra))
      );
      return;
    }
    const payloadToken = parseDetailPayload(payload);
    if (payloadToken) {
      await startDownloadFromToken(chatId, payloadToken, (text, extra) =>
        ctx.reply(text, withDisabledPreview(extra))
      );
      return;
    }
    await sendStartMessage(chatId, (text, extra) => ctx.reply(text, withDisabledPreview(extra)));
    await ctx.reply(translateForChat(chatId, 'search.prompt'), withDisabledPreview());
  };

  bot.start(async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    const payload = normalizeStartPayload(ctx.startPayload);
    await handleStartPayload(chatId, payload, ctx);
  });

  bot.command('help', async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    const howItWorks = translateForChat(chatId, 'common.howItWorksHtml');
    const faq = translateForChat(chatId, 'faq.messageHtml');
    const text = translateForChat(chatId, 'help.messageHtml', { howItWorks, faq });
    await ctx.reply(text, withDisabledPreview({ parse_mode: 'HTML' as const }));
  });

  bot.command('subscription', async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    const locale = getChatLocale(chatId);
    const telegramId = await ensureTelegramChat(chatId);
    const expiresAt = await paymentStore.getSubscriptionExpiresAt(telegramId);
    const isActive = expiresAt && new Date(expiresAt) > new Date();
    let statusLine: string;
    if (isActive) {
      const dateLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
      const formatted = new Date(expiresAt).toLocaleDateString(dateLocale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: config.timezone
      });
      statusLine = translate('subscription.expiresAt', locale, { date: formatted });
    } else {
      statusLine = translate('subscription.noActive', locale);
    }
    let plans: PaymentPlan[] = [];
    try {
      plans = await paymentStore.listVisiblePlans();
    } catch (error) {
      console.error('Failed to load subscription plans:', error);
    }
    if (plans.length === 0) {
      await ctx.reply(translateForChat(chatId, 'subscription.noPlans'), withDisabledPreview());
      return;
    }
    let demoPlan: PaymentPlan | undefined;
    if (!isActive && config.demoPlanId) {
      const demoUsed = await paymentStore.getDemoUsed(telegramId);
      if (!demoUsed) {
        demoPlan = await paymentStore.getPlan(config.demoPlanId);
      }
    }
    const keyboard = buildSubscriptionKeyboard(plans, locale, demoPlan);
    const text = `${statusLine}\n\n${translateForChat(chatId, 'subscription.message')}`;
    await ctx.reply(text, withDisabledPreview({ ...keyboard }));
  });

  bot.command('limit', async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    const locale = getChatLocale(chatId);
    const telegramId = await ensureTelegramChat(chatId);
    const quotaGb = await chatRegistry.getUserQuota(telegramId);
    const usageBytes = await chatRegistry.getUsageBytes(telegramId, QUOTA_WINDOW_DAYS);
    const usageGb = (usageBytes / (1024 ** 3)).toFixed(1);
    const quotaDisplay = quotaGb !== null ? `${quotaGb}` : translate('limit.unlimited', locale);
    const lines = [translate('limit.message', locale, { used: usageGb, quota: quotaDisplay })];
    const oldest = await chatRegistry.getOldestDownloadDate(telegramId, QUOTA_WINDOW_DAYS);
    if (oldest) {
      const refreshInDays = Math.max(1, Math.ceil(QUOTA_WINDOW_DAYS - (Date.now() - oldest.getTime()) / (24 * 60 * 60 * 1000)));
      lines.push(translate('limit.refreshIn', locale, { days: refreshInDays }));
    }
    await ctx.reply(lines.join('\n'), withDisabledPreview());
  });

  bot.command('how_download_phone', async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    const text = translateForChat(chatId, 'howDownloadPhone.messageHtml');
    await ctx.reply(text, withDisabledPreview({ parse_mode: 'HTML' as const }));
  });

  bot.command('how_watch_on_phone', async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    const text = translateForChat(chatId, 'howWatchOnPhone.messageHtml');
    await ctx.reply(text, withDisabledPreview({ parse_mode: 'HTML' as const }));
  });

  bot.command('how_stream_airplay', async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    const text = translateForChat(chatId, 'howStreamAirplay.messageHtml');
    await ctx.reply(text, withDisabledPreview({ parse_mode: 'HTML' as const }));
  });

  bot.command('lang', async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    const keyboard = buildLanguageKeyboard();
    const text = translateForChat(chatId, 'lang.prompt');
    await ctx.reply(text, withDisabledPreview({ ...keyboard }));
  });

  bot.command('search', async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    await ctx.reply(translateForChat(chatId, 'search.prompt'), withDisabledPreview());
  });

  bot.on('message', async (ctx, next) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return next();
    }
    const message = ctx.message;
    const textMessage = message as { text?: string; entities?: { type: string; offset: number }[] } | undefined;
    if (!textMessage || typeof textMessage.text !== 'string') {
      return next();
    }
    const text = textMessage.text;
    const isCommand =
      textMessage.entities?.some((entity) => entity.type === 'bot_command' && entity.offset === 0) ??
      text.startsWith('/');
    if (isCommand) {
      return next();
    }
    const query = text.trim();
    if (!query) {
      await ctx.reply(translateForChat(chatId, 'search.prompt'), withDisabledPreview());
      return;
    }
    try {
      await ctx.reply(translateForChat(chatId, 'search.searching', { query }), withDisabledPreview());
      const rawResults = await downloadService.search(query);
      if (rawResults.length === 0) {
        await ctx.reply(translateForChat(chatId, 'search.noResults', { query }), withDisabledPreview());
        return;
      }
      const locale = getChatLocale(chatId);
      const pageInfo = buildSearchPage(rawResults, 0, locale);
      const previousMessageId = searchSessions.get(chatId)?.messageId;
      const sentMessage = await ctx.reply(pageInfo.text, withDisabledPreview(pageInfo.extra));
      searchSessions.set(chatId, { results: rawResults, page: pageInfo.page, messageId: sentMessage.message_id });
      if (previousMessageId !== undefined) {
        await deleteSearchMessage(chatId, previousMessageId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(translateForChat(chatId, 'search.failed', { message }), withDisabledPreview());
    }
  });

  bot.command('jobs', async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      return;
    }
    const telegramId = await ensureTelegramChat(chatId);
    await sendJobList(chatId, telegramId);
  });

  bot.action(new RegExp(`^${SUBSCRIPTION_PAYLOAD_PREFIX}(\\d+)$`), async (ctx) => {
    const match = ctx.match as RegExpExecArray | undefined;
    const rawPlanId = match?.[1];
    const planId = rawPlanId ? Number.parseInt(rawPlanId, 10) : Number.NaN;
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined || Number.isNaN(planId)) {
      await safeAnswerCallback(ctx);
      return;
    }
    await safeAnswerCallback(ctx);
    const locale = getChatLocale(chatId);
    const telegramId = await ensureTelegramChat(chatId);

    let plan: PaymentPlan | undefined;
    try {
      plan = await paymentStore.getPlan(planId);
    } catch (error) {
      console.error('Failed to load plan:', error);
    }
    if (!plan || !plan.display) {
      await ctx.reply(translate('subscription.noPlans', locale), withDisabledPreview());
      return;
    }

    const provider = config.paymentProvider;
    try {
      let order = await paymentStore.findPendingOrder(telegramId, plan.id, provider);
      if (!order) {
        order = await paymentStore.createOrder({
          userId: telegramId,
          planId: plan.id,
          amount: plan.price,
          provider
        });
        console.log(
          `[payment] created order id=${order.id} user=${order.userId} plan=${order.planId} amount=${order.amount} provider=${order.provider}`
        );
      } else {
        console.log(
          `[payment] reuse pending order id=${order.id} user=${order.userId} plan=${order.planId} amount=${order.amount} provider=${order.provider}`
        );
      }
      const payment = await paymentClient.createPayment({
        amount: plan.price,
        description: formatOrderDescription(order.id),
        returnUrl: buildPaymentReturnUrl(),
        internalOrderId: order.id
      });
      console.log(
        `[payment] payment link created order=${order.id} user=${order.userId} payment_id=${payment.id} url=${payment.confirmationUrl}`
      );
      await paymentStore.setOrderExternalId(order.id, payment.id);
      const message = formatPaymentLinkMessage(plan, payment.confirmationUrl, locale);
      await ctx.reply(message, withDisabledPreview({ parse_mode: 'HTML' as const }));
    } catch (error) {
      console.error('Failed to create payment link:', error);
      await ctx.reply(translate('subscription.paymentFailed', locale), withDisabledPreview());
    }
  });

  bot.action(DEMO_ACTIVATE_PAYLOAD, async (ctx) => {
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined) {
      await safeAnswerCallback(ctx);
      return;
    }
    await safeAnswerCallback(ctx);
    const locale = getChatLocale(chatId);
    const telegramId = await ensureTelegramChat(chatId);

    if (!config.demoPlanId) {
      await ctx.reply(translate('subscription.noPlans', locale), withDisabledPreview());
      return;
    }
    const demoUsed = await paymentStore.getDemoUsed(telegramId);
    if (demoUsed) {
      await ctx.reply(translate('subscription.noPlans', locale), withDisabledPreview());
      return;
    }
    const demoPlan = await paymentStore.getPlan(config.demoPlanId);
    if (!demoPlan) {
      await ctx.reply(translate('subscription.noPlans', locale), withDisabledPreview());
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + demoPlan.durationDays * 24 * 60 * 60 * 1000);
    const timestamp = now.toISOString();
    await paymentStore.setSubscriptionExpiresAt(telegramId, expiresAt.toISOString(), timestamp);
    await paymentStore.setDemoUsed(telegramId, true, timestamp);

    const dateLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
    const formatted = expiresAt.toLocaleDateString(dateLocale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: config.timezone
    });
    console.log(`[demo] activated for user=${telegramId} expires=${expiresAt.toISOString()}`);
    await ctx.reply(translate('subscription.demoActivated', locale, { date: formatted }), withDisabledPreview());
  });

  bot.action(/^page:(\d+)$/, async (ctx) => {
    const match = ctx.match as RegExpExecArray | undefined;
    const rawPage = match?.[1];
    const requestedPage = Number.parseInt(rawPage ?? '', 10);
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined || Number.isNaN(requestedPage)) {
      await safeAnswerCallback(ctx);
      return;
    }
    const session = searchSessions.get(chatId);
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (!session || !messageId || session.messageId !== messageId) {
      await safeAnswerCallback(ctx, translateForChat(chatId, 'search.expired'));
      return;
    }
    const pageInfo = buildSearchPage(session.results, requestedPage, getChatLocale(chatId));
    session.page = pageInfo.page;
    await safeAnswerCallback(ctx);
    await safeEditMessageText(ctx, pageInfo.text, withDisabledPreviewEdit(pageInfo.extra));
  });

  bot.action(new RegExp(`^${DOWNLOAD_CONFIRM_PREFIX}(.+)$`), async (ctx) => {
    const match = ctx.match as RegExpExecArray | undefined;
    const rawToken = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined || !rawToken) {
      await safeAnswerCallback(ctx);
      return;
    }
    await safeAnswerCallback(ctx);
    const locale = getChatLocale(chatId);
    const parsed = parseDetailToken(rawToken);
    if (!parsed) {
      await ctx.reply(translate('search.expired', locale), withDisabledPreview());
      return;
    }
    const baseResult = resolveSessionResult(chatId, parsed);
    if (!baseResult) {
      await ctx.reply(translate('search.expired', locale), withDisabledPreview());
      return;
    }
    let detail: SearchResultDetail | undefined;
    try {
      const fetchedDetail = await downloadService.getSearchResultDetail(baseResult);
      if (fetchedDetail) {
        detail = normalizeDetailHash(fetchedDetail);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(translate('search.detailFailed', locale, { message }), withDisabledPreview());
      return;
    }
    if (!detail) {
      await ctx.reply(
        translate('search.detailUnavailable', locale, {
          provider: baseResult.providerLabel || baseResult.provider,
          id: baseResult.id
        }),
        withDisabledPreview()
      );
      return;
    }
    const telegramId = await ensureTelegramChat(chatId);
    if (!(await isSubscriptionActive(telegramId))) {
      let demoPlan: PaymentPlan | undefined;
      if (config.demoPlanId) {
        const demoUsed = await paymentStore.getDemoUsed(telegramId);
        if (!demoUsed) {
          demoPlan = await paymentStore.getPlan(config.demoPlanId);
        }
      }
      if (demoPlan) {
        const keyboard = buildDemoOfferKeyboard(demoPlan, locale);
        await ctx.reply(translate('subscription.demoOffer', locale), withDisabledPreview({ ...keyboard }));
      } else {
        await ctx.reply(translate('subscription.expired', locale), withDisabledPreview());
      }
      return;
    }
    try {
      const existingJobs = downloadService.getJobsForChat(telegramId);
      const knownJobIds = new Set(existingJobs.map((job) => job.jobId));
      const job = await downloadService.startDownload(detail, telegramId);
      const isExistingJob = knownJobIds.has(job.jobId);

      if (isExistingJob) {
        const keyboard = buildJobActionsKeyboard(job, locale);
        await ctx.reply(
          formatJobDetail(job, locale),
          withDisabledPreview({ ...keyboard, parse_mode: 'HTML' as const })
        );
        return;
      }

      if (job.lastKnownStatus === 'completed') {
        return;
      }

      const jobTitle = detail.title ?? baseResult.title ?? job.hash ?? translate('common.unknown', locale);
      const uploadingHeading = escapeHtml(translate('downloads.uploadingHeading', locale));
      const jobTitleLine = `<b>${escapeHtml(jobTitle)}</b>`;
      const statusLabel = escapeHtml(translate('downloads.checkStatusHint', locale));
      const statusLink = `<a href="${escapeHtml(buildStartLink(`${JOB_PAYLOAD_PREFIX}${job.jobId}`))}">${statusLabel}</a>`;
      await ctx.reply(
        [uploadingHeading, '', jobTitleLine, '', statusLink].join('\n'),
        withDisabledPreview({ parse_mode: 'HTML' as const })
      );
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        await ctx.reply(
          translate('quota.exceeded', locale, { maxGb: error.maxGb, retryInDays: error.retryInDays }),
          withDisabledPreview()
        );
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(translate('downloads.startFailed', locale, { message }), withDisabledPreview());
    }
  });

  bot.action(DOWNLOAD_CANCEL_ACTION, async (ctx) => {
    await safeAnswerCallback(ctx);
  });

  bot.action(/^job:(.+)$/, async (ctx) => {
    const match = ctx.match as RegExpExecArray | undefined;
    const rawId = match?.[1];
    const jobId = rawId ? decodeURIComponent(rawId) : undefined;
    const chatId = getPrivateChatId(ctx);
    if (!jobId || chatId === undefined) {
      await safeAnswerCallback(ctx);
      return;
    }
    await safeAnswerCallback(ctx);
    const telegramId = await ensureTelegramChat(chatId);
    await sendJobDetailMessage(chatId, telegramId, jobId, (text, extra) =>
      ctx.reply(text, withDisabledPreview(extra))
    );
  });

  bot.action(/^refresh:(.+)$/, async (ctx) => {
    const match = ctx.match as RegExpExecArray | undefined;
    const rawId = match?.[1];
    const jobId = rawId ? decodeURIComponent(rawId) : undefined;
    const chatId = getPrivateChatId(ctx);
    if (!jobId || chatId === undefined) {
      await safeAnswerCallback(ctx);
      return;
    }
    await safeAnswerCallback(ctx);
    await downloadService.syncJob(jobId);
    const telegramId = await ensureTelegramChat(chatId);
    const job = findOwnedJob(jobId, telegramId);
    if (!job) {
      await safeEditMessageText(
        ctx,
        translateForChat(chatId, 'jobs.notFound', { jobId }),
        withDisabledPreviewEdit()
      );
      return;
    }
    const locale = getChatLocale(chatId);
    const keyboard = buildJobActionsKeyboard(job, locale);
    await safeEditMessageText(
      ctx,
      formatJobDetail(job, locale),
      withDisabledPreviewEdit({ ...keyboard, parse_mode: 'HTML' as const })
    );
  });

  bot.action(/^delete:(.+)$/, async (ctx) => {
    const match = ctx.match as RegExpExecArray | undefined;
    const rawId = match?.[1];
    const jobId = rawId ? decodeURIComponent(rawId) : undefined;
    const chatId = getPrivateChatId(ctx);
    if (!jobId || chatId === undefined) {
      await safeAnswerCallback(ctx);
      return;
    }
    await safeAnswerCallback(ctx);
    const telegramId = await ensureTelegramChat(chatId);
    const existing = findOwnedJob(jobId, telegramId);
    if (!existing) {
      await safeEditMessageText(
        ctx,
        translateForChat(chatId, 'jobs.notFound', { jobId }),
        withDisabledPreviewEdit()
      );
      return;
    }
    removalSuppressions.set(jobId, telegramId);
    await downloadService.remove(jobId);
    try {
      await safeEditMessageText(
        ctx,
        translateForChat(chatId, 'jobs.removed', { label: existing.label ?? jobId }),
        withDisabledPreviewEdit()
      );
    } catch (error) {
      console.error('Failed to edit job message after deletion:', error);
    }
    await sendJobList(chatId, telegramId);
  });

  bot.action(/^set-locale:(\w+)$/i, async (ctx) => {
    const match = ctx.match as RegExpExecArray | undefined;
    const requested = match?.[1]?.toLowerCase();
    const chatId = getPrivateChatId(ctx);
    if (chatId === undefined || !requested || !isSupportedLocale(requested)) {
      await safeAnswerCallback(ctx);
      return;
    }
    const telegramId = await ensureTelegramChat(chatId);
    const newLocale = setChatLocale(chatId, requested);
    await chatRegistry.setChatLocale(telegramId, newLocale === defaultLocale ? null : newLocale);
    await safeAnswerCallback(ctx);
    await sendTelegramMessage(
      chatId,
      translate('locale.updated', newLocale, { language: getLocaleDisplayName(newLocale) })
    );
  });

  downloadService.on('jobUpdated', (job) => {
    if (job.lastKnownStatus !== 'completed') {
      return;
    }
    if (completedJobs.has(job.jobId)) {
      return;
    }
    completedJobs.add(job.jobId);
    void notifyJobOwner(
      job,
      (chatId) => {
        const locale = getChatLocale(chatId);
        const title = job.label ?? job.hash;
        const openLabel = translate('search.downloadLinkLabel', locale);
        const linkUrl = buildStartLink(`${JOB_PAYLOAD_PREFIX}${job.jobId}`);
        const linkHtml = `<a href="${escapeHtml(linkUrl)}">${escapeHtml(openLabel)}</a>`;
        return translate('notifications.jobCompleted', locale, { title, link: linkHtml });
      },
      () => ({ parse_mode: 'HTML' as const })
    );
  });

  downloadService.on('jobRemoved', (job) => {
    completedJobs.delete(job.jobId);
    const suppressedTelegramId = removalSuppressions.get(job.jobId);
    removalSuppressions.delete(job.jobId);
    if (suppressedTelegramId && suppressedTelegramId === job.telegramId) {
      return;
    }
    void notifyJobOwner(job, (chatId) =>
      translate('notifications.jobRemoved', getChatLocale(chatId), { label: job.label ?? job.jobId })
    );
  });

  downloadService.on('error', (error) => {
    void broadcast((chatId) => translateForChat(chatId, 'service.error', { message: error.message }));
  });

  const start = async () => {
    await ensureBootstrapped();
    const me = await bot.telegram.getMe();
    botUsername = me.username ?? undefined;
    if (!botUsername) {
      throw new Error('Bot username is required');
    }
    const locales = getOrderedLocales();
    const baseLocale = defaultLocale;
    await bot.telegram.setMyCommands(getBotCommands(baseLocale));
    await Promise.all(
      locales
        .filter((locale) => locale !== baseLocale)
        .map((locale) => bot.telegram.setMyCommands(getBotCommands(locale), { language_code: locale }))
    );
    await bot.launch();
    console.log('Telegram bot started.');
  };

  const stop = async (reason: string) => {
    poller.stop();
    await bot.stop(reason);
  };

  return { bot, start, stop };
};
