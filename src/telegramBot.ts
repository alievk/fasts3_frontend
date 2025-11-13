import { Agent as HttpsAgent } from 'node:https';
import { Telegraf, Markup } from 'telegraf';
import type { Context } from 'telegraf';
import { loadConfig } from './config.js';
import { createApiClient } from './apiClient.js';
import { DownloadService } from './downloadService.js';
import { Poller } from './poller.js';
import { JobStatus, OwnedJob, SearchResult } from './types.js';
import { createSearchPipeline } from './searchPipeline.js';
import { createClientRegistry } from './clientRegistry.js';
import botTranslationsData from './locales/bot.json' assert { type: 'json' };

type SendMessageExtra = Parameters<Telegraf['telegram']['sendMessage']>[2];

const botToken = process.env.TORRENT_TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('Missing TORRENT_TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const config = loadConfig();
const botTranslations = botTranslationsData as Record<string, Record<string, string>>;
type TranslationParams = Record<string, string | number>;
const PRIMARY_LOCALE = 'ru';
const isSupportedLocale = (locale?: string): locale is string =>
  Boolean(locale && Object.prototype.hasOwnProperty.call(botTranslations, locale));
const defaultLocale = isSupportedLocale(config.botLocale) ? config.botLocale : PRIMARY_LOCALE;
const resolveTemplate = (locale: string, key: string): string | undefined => botTranslations[locale]?.[key];
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
const resolveToggleLocale = (locale: string): string => (locale === 'en' ? PRIMARY_LOCALE : 'en');
const buildLocaleToggleKeyboard = (locale: string) => {
  const targetLocale = resolveToggleLocale(locale);
  const buttonKey = targetLocale === 'en' ? 'start.switchToEnglish' : 'start.switchToRussian';
  return Markup.inlineKeyboard([Markup.button.callback(translate(buttonKey, locale), `set-locale:${targetLocale}`)]);
};
const buildStartContent = (locale: string) => ({
  text: [
    translate('start.welcome', locale),
    translate('start.commandsTitle', locale),
    translate('start.searchHint', locale),
    translate('start.jobsHint', locale)
  ].join('\n'),
  keyboard: buildLocaleToggleKeyboard(locale)
});
const sendStartMessage = async (
  chatId: number,
  replyFn?: (text: string, extra?: SendMessageExtra) => Promise<unknown>
): Promise<void> => {
  const locale = getChatLocale(chatId);
  const content = buildStartContent(locale);
  if (replyFn) {
    await replyFn(content.text, content.keyboard);
    return;
  }
  await sendTelegramMessage(chatId, content.text, content.keyboard);
};
const apiClient = createApiClient();
const clientRegistry = createClientRegistry(config.clientDbPath);
const searchPipeline = createSearchPipeline(config);
const downloadService = new DownloadService(apiClient, clientRegistry, config.searchLimit, searchPipeline);
const poller = new Poller(downloadService, config.pollingIntervalMs);
const telegramIpv4Agent = new HttpsAgent({ family: 4 });
const bot = new Telegraf(botToken, { telegram: { agent: telegramIpv4Agent } });
let botUsername: string | undefined;
const getBotUsername = (): string => {
  if (!botUsername) {
    throw new Error('Bot username is not initialized');
  }
  return botUsername;
};

const botCommands = [
  { command: 'search', description: translateDefault('commands.searchDescription') },
  { command: 'jobs', description: translateDefault('commands.jobsDescription') }
];

const activeChats = new Set<number>();

type SearchResultWithToken = SearchResult & { token: string };
type SearchSession = {
  results: SearchResultWithToken[];
  page: number;
  messageId?: number;
};

const searchPageSize = config.searchPageSize;
const DOWNLOAD_PAYLOAD_PREFIX = 'download_';
const MAX_RESULT_TOKENS = 500;

type ResultTokenRecord = {
  chatId: number;
  result: SearchResult;
};

const resultTokenStore = new Map<string, ResultTokenRecord>();
const resultTokenOrder: string[] = [];

const extractBtih = (magnet: string): string | null => {
  const match = magnet.match(/btih:([a-z0-9]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
};

const normalizeShortUrl = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const resolveResultTokenValue = (result: SearchResult): string => {
  const fallback = (result.id ?? '').toLowerCase();
  const source = extractBtih(result.magnet) ?? fallback;
  const normalized = source.toLowerCase();
  return normalized.slice(-6) || normalized || fallback || 'unknown';
};

const buildResultTokenKey = (chatId: number, token: string): string => `${chatId}:${token}`;

const removeResultTokenKey = (key: string): void => {
  const index = resultTokenOrder.indexOf(key);
  if (index >= 0) {
    resultTokenOrder.splice(index, 1);
  }
};

const pruneResultTokens = (): void => {
  while (resultTokenOrder.length > MAX_RESULT_TOKENS) {
    const oldest = resultTokenOrder.shift();
    if (!oldest) {
      break;
    }
    resultTokenStore.delete(oldest);
  }
};

const storeResultToken = (chatId: number, result: SearchResult): string => {
  const token = resolveResultTokenValue(result);
  const key = buildResultTokenKey(chatId, token);
  removeResultTokenKey(key);
  resultTokenStore.set(key, { chatId, result });
  resultTokenOrder.push(key);
  pruneResultTokens();
  return token;
};

const attachResultTokens = (chatId: number, results: SearchResult[]): SearchResultWithToken[] =>
  results.map((result) => ({ ...result, token: storeResultToken(chatId, result) }));

const resolveResultToken = (chatId: number, token: string): SearchResult | null => {
  const record = resultTokenStore.get(buildResultTokenKey(chatId, token));
  if (!record || record.chatId !== chatId) {
    return null;
  }
  return record.result;
};

type ConversationState =
  | {
      type: 'search';
      stage: 'awaitingQuery';
    };

const searchSessions = new Map<number, SearchSession>();
const conversationStates = new Map<number, ConversationState>();
const trackedJobs = new Map<string, OwnedJob>();
const removalSuppressions = new Map<string, string>();
const setConversationState = (chatId: number, state: ConversationState) => {
  conversationStates.set(chatId, state);
};
const clearConversationState = (chatId: number, type?: ConversationState['type']) => {
  const existing = conversationStates.get(chatId);
  if (!existing) {
    return;
  }
  if (type && existing.type !== type) {
    return;
  }
  conversationStates.delete(chatId);
};
const getConversationState = (chatId: number): ConversationState | undefined => conversationStates.get(chatId);

const buildTelegramClientId = (chatId: number): string => `telegram:${chatId}`;

const ensureTelegramClient = async (chatId: number): Promise<string> => {
  const clientId = buildTelegramClientId(chatId);
  const record = await clientRegistry.registerClient(clientId, { type: 'telegram', chatId });
  cacheChatLocale(chatId, record.locale ?? null);
  return clientId;
};

const getJobForClient = (jobId: string): OwnedJob | undefined =>
  trackedJobs.get(jobId) ?? downloadService.getJobs().find((item) => item.jobId === jobId);

const findOwnedJob = (jobId: string, clientId: string): OwnedJob | undefined => {
  const job = getJobForClient(jobId);
  if (!job || job.clientId !== clientId) {
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

const sendTelegramMessage = async (
  chatId: number,
  message: string,
  extra?: Parameters<typeof bot.telegram.sendMessage>[2]
): Promise<void> => {
  try {
    await bot.telegram.sendMessage(chatId, message, extra);
  } catch (error) {
    const code = (error as { response?: { error_code?: number } }).response?.error_code;
    if (code === 403) {
      activeChats.delete(chatId);
    }
    console.error(`Failed to deliver message to ${chatId}:`, error);
  }
};

type MessageBuilder = string | ((chatId: number) => string);

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

const notifyJobOwner = async (job: OwnedJob, message: MessageBuilder): Promise<void> => {
  const targets = await clientRegistry.getNotificationTargets(job.jobId);
  if (targets.length === 0) {
    return;
  }
  await Promise.all(
    targets.map(async (target) => {
      if (target.transport.type === 'telegram') {
        cacheChatLocale(target.transport.chatId, target.locale ?? null);
        const text = typeof message === 'function' ? message(target.transport.chatId) : message;
        await sendTelegramMessage(target.transport.chatId, text);
      }
    })
  );
};

const isQueryTooOldError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const response = (error as { response?: { error_code?: number; description?: string } }).response;
  return response?.error_code === 400 && typeof response.description === 'string' && response.description.includes('query is too old');
};

const isMessageUnchangedError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const response = (error as { response?: { error_code?: number; description?: string } }).response;
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
  if (!error || typeof error !== 'object') {
    return false;
  }
  const description = (error as { response?: { description?: string } }).response?.description ?? '';
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
  if (typeof size !== 'number' || Number.isNaN(size)) {
    return translate('common.unknown', locale);
  }
  const gigabytes = size / (1024 * 1024 * 1024);
  if (size < 100 * 1024 * 1024) {
    const megabytes = size / (1024 * 1024);
    return `${megabytes.toFixed(1)} MiB`;
  }
  return `${gigabytes.toFixed(2)} GiB`;
};

const buildPlayerUrl = (jobId: string): string => {
  const normalizedBase = config.playerBaseUrl.replace(/\/+$/, '');
  return `${normalizedBase}/public/player/?job_id=${encodeURIComponent(jobId)}`;
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

const formatJobInfoLines = (job: OwnedJob, locale: string): string[] => {
  const downloadLink = normalizeShortUrl(job.shortUrl ?? null);
  const playerLink = canStreamJob(job) ? buildPlayerUrl(job.jobId) : undefined;
  const progressText =
    job.lastKnownStatus === 'completed'
      ? '100%'
      : job.progress === null
        ? '—'
        : `${Math.round(job.progress * 100)}%`;
  const lines = [
    translate('job.jobIdLine', locale, { jobId: job.jobId }),
    translate('job.btihLine', locale, { btih: job.btih }),
    translate('job.statusLine', locale, { status: formatStatus(job.lastKnownStatus, locale) }),
    translate('job.progressLine', locale, { progress: progressText }),
    translate('job.sizeLine', locale, { size: formatSize(job.sizeBytes ?? null, locale) }),
    downloadLink ? translate('job.downloadLine', locale, { url: downloadLink }) : undefined,
    playerLink ? translate('job.playerLine', locale, { url: playerLink }) : undefined,
    job.error ? translate('job.errorLine', locale, { message: job.error }) : undefined
  ];
  return lines.filter((line): line is string => Boolean(line));
};

const formatJobDetail = (job: OwnedJob, locale: string): string => {
  return [translate('job.titleLine', locale, { title: job.label ?? job.btih }), ...formatJobInfoLines(job, locale)].join('\n');
};

const normalizeTitle = (title: string): string => title;
const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const buildStartLink = (payload: string): string => {
  const username = getBotUsername();
  return `https://t.me/${username}?start=${encodeURIComponent(payload)}`;
};
const formatDownloadLinkLine = (token: string, locale: string): string => {
  const payload = `${DOWNLOAD_PAYLOAD_PREFIX}${token}`;
  const label = translate('search.downloadLinkLabel', locale);
  const link = `<a href="${buildStartLink(payload)}">${escapeHtml(label)}</a>`;
  return translate('search.downloadLinkLine', locale, { url: link });
};
const parseDownloadPayload = (payload?: string | null): string | null => {
  if (!payload || !payload.startsWith(DOWNLOAD_PAYLOAD_PREFIX)) {
    return null;
  }
  const token = payload.slice(DOWNLOAD_PAYLOAD_PREFIX.length).trim();
  return token || null;
};

const buildSearchPage = (results: SearchResultWithToken[], requestedPage: number, locale: string) => {
  const totalPages = Math.max(1, Math.ceil(results.length / searchPageSize));
  const page = Math.min(Math.max(requestedPage, 0), totalPages - 1);
  const startIndex = page * searchPageSize;
  const pageResults = results.slice(startIndex, startIndex + searchPageSize);
  const lines = pageResults.map((result, offset) => {
    const index = startIndex + offset;
    const displayIndex = index + 1;
    return [
      `${displayIndex}. ${escapeHtml(normalizeTitle(result.title))}`,
      escapeHtml(translate('search.sizeLine', locale, { size: formatSize(result.sizeBytes, locale) })),
      escapeHtml(translate('search.peersLine', locale, { seeders: result.seeders, leechers: result.leechers })),
      formatDownloadLinkLine(result.token, locale)
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
  const text = `${lines.join('\n\n')}\n\n${pageCounter}`;
  return {
    page,
    totalPages,
    text,
    extra
  };
};

const startDownloadFromToken = async (
  chatId: number,
  token: string,
  replyFn: (text: string) => Promise<unknown>
): Promise<void> => {
  const locale = getChatLocale(chatId);
  const result = token ? resolveResultToken(chatId, token) : null;
  if (!result) {
    await replyFn(translate('search.expired', locale));
    return;
  }
  const clientId = await ensureTelegramClient(chatId);
  try {
    const job = await downloadService.startDownload(result, clientId);
    await replyFn(
      [
        translate('downloads.summaryTitle', locale, { title: result.title }),
        translate('job.jobIdLine', locale, { jobId: job.jobId }),
        translate('job.btihLine', locale, { btih: job.btih }),
        '',
        translate('downloads.checkStatusHint', locale)
      ].join('\n')
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await replyFn(translate('downloads.startFailed', locale, { message }));
  }
};

const buildJobActionsKeyboard = (job: OwnedJob, locale: string) => {
  const encodedId = encodeURIComponent(job.jobId);
  const downloadLink = normalizeShortUrl(job.shortUrl ?? null);
  const buttons = [
    downloadLink ? Markup.button.url(translate('jobs.actions.openLink', locale), downloadLink) : undefined,
    Markup.button.callback(translate('jobs.actions.refresh', locale), `refresh:${encodedId}`),
    Markup.button.callback(translate('jobs.actions.delete', locale), `delete:${encodedId}`)
  ].filter(Boolean) as Parameters<typeof Markup.inlineKeyboard>[0];
  return Markup.inlineKeyboard(buttons, { columns: 1 });
};

const buildJobsKeyboard = (jobs: OwnedJob[], locale: string) => {
  const buttons = jobs.map((job) =>
    Markup.button.callback(
      translate('jobs.listButton', locale, {
        title: normalizeTitle(job.label ?? job.btih),
        status: formatStatus(job.lastKnownStatus, locale)
      }),
      `job:${encodeURIComponent(job.jobId)}`
    )
  );
  return Markup.inlineKeyboard(buttons, { columns: 1 });
};

const sendJobList = async (chatId: number, clientId: string) => {
  const locale = getChatLocale(chatId);
  const jobs = downloadService.getJobsForClient(clientId);
  if (jobs.length === 0) {
    await sendTelegramMessage(chatId, translate('jobs.listEmpty', locale));
    return;
  }
  await sendTelegramMessage(chatId, translate('jobs.listPrompt', locale), buildJobsKeyboard(jobs, locale));
};

bot.use(async (ctx, next) => {
  if (ctx.chat) {
    activeChats.add(ctx.chat.id);
    await ensureTelegramClient(ctx.chat.id);
  }
  await ensureBootstrapped();
  return next();
});

bot.start(async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  const payloadToken = parseDownloadPayload(ctx.startPayload);
  if (payloadToken) {
    await startDownloadFromToken(chatId, payloadToken, (text) => ctx.reply(text));
    return;
  }
  await sendStartMessage(chatId, (text, extra) => ctx.reply(text, extra));
});

bot.command('search', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  setConversationState(chatId, { type: 'search', stage: 'awaitingQuery' });
  await ctx.reply(translateForChat(chatId, 'search.prompt'));
});

bot.on('message', async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return next();
  }
  const message = ctx.message;
  const textMessage = message as { text?: string; entities?: { type: string; offset: number }[] } | undefined;
  if (!textMessage || typeof textMessage.text !== 'string') {
    return next();
  }
  const text = textMessage.text;
  const isCommand =
    textMessage.entities?.some((entity) => entity.type === 'bot_command' && entity.offset === 0) ?? text.startsWith('/');
  if (isCommand) {
    return next();
  }
  const state = getConversationState(chatId);
  if (!state || state.type !== 'search' || state.stage !== 'awaitingQuery') {
    return next();
  }
  const query = text.trim();
  if (!query) {
    await ctx.reply(translateForChat(chatId, 'search.prompt'));
    return;
  }
  clearConversationState(chatId, 'search');
  try {
    const rawResults = await downloadService.search(query);
    if (rawResults.length === 0) {
      await ctx.reply(translateForChat(chatId, 'search.noResults', { query }));
      return;
    }
    const results = attachResultTokens(chatId, rawResults);
    const locale = getChatLocale(chatId);
    const pageInfo = buildSearchPage(results, 0, locale);
    const previousMessageId = searchSessions.get(chatId)?.messageId;
    const sentMessage = await ctx.reply(pageInfo.text, pageInfo.extra);
    searchSessions.set(chatId, { results, page: pageInfo.page, messageId: sentMessage.message_id });
    if (previousMessageId !== undefined) {
      await deleteSearchMessage(chatId, previousMessageId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.reply(translateForChat(chatId, 'search.failed', { message }));
  }
});

bot.command('jobs', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  const clientId = await ensureTelegramClient(chatId);
  await sendJobList(chatId, clientId);
});

bot.action(/^page:(\d+)$/, async (ctx) => {
  const match = ctx.match as RegExpExecArray | undefined;
  const rawPage = match?.[1];
  const requestedPage = Number.parseInt(rawPage ?? '', 10);
  const chatId = ctx.chat?.id;
  if (!chatId || Number.isNaN(requestedPage)) {
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
  await safeEditMessageText(ctx, pageInfo.text, pageInfo.extra);
});

bot.action(/^job:(.+)$/, async (ctx) => {
  const match = ctx.match as RegExpExecArray | undefined;
  const rawId = match?.[1];
  const jobId = rawId ? decodeURIComponent(rawId) : undefined;
  const chatId = ctx.chat?.id;
  if (!jobId || !chatId) {
    await safeAnswerCallback(ctx);
    return;
  }
  await safeAnswerCallback(ctx);
  const clientId = await ensureTelegramClient(chatId);
  const job = findOwnedJob(jobId, clientId);
  if (!job) {
    await ctx.reply(translateForChat(chatId, 'jobs.notFound', { jobId }));
    return;
  }
  const locale = getChatLocale(chatId);
  await ctx.reply(formatJobDetail(job, locale), buildJobActionsKeyboard(job, locale));
});

bot.action(/^refresh:(.+)$/, async (ctx) => {
  const match = ctx.match as RegExpExecArray | undefined;
  const rawId = match?.[1];
  const jobId = rawId ? decodeURIComponent(rawId) : undefined;
  const chatId = ctx.chat?.id;
  if (!jobId || !chatId) {
    await safeAnswerCallback(ctx);
    return;
  }
  await safeAnswerCallback(ctx);
  await downloadService.syncJob(jobId);
  const clientId = await ensureTelegramClient(chatId);
  const job = findOwnedJob(jobId, clientId);
  if (!job) {
    await safeEditMessageText(ctx, translateForChat(chatId, 'jobs.notFound', { jobId }));
    return;
  }
  const locale = getChatLocale(chatId);
  await safeEditMessageText(ctx, formatJobDetail(job, locale), buildJobActionsKeyboard(job, locale));
});

bot.action(/^delete:(.+)$/, async (ctx) => {
  const match = ctx.match as RegExpExecArray | undefined;
  const rawId = match?.[1];
  const jobId = rawId ? decodeURIComponent(rawId) : undefined;
  const chatId = ctx.chat?.id;
  if (!jobId || !chatId) {
    await safeAnswerCallback(ctx);
    return;
  }
  await safeAnswerCallback(ctx);
  const clientId = await ensureTelegramClient(chatId);
  const existing = findOwnedJob(jobId, clientId);
  if (!existing) {
    await safeEditMessageText(ctx, translateForChat(chatId, 'jobs.notFound', { jobId }));
    return;
  }
  removalSuppressions.set(jobId, clientId);
  await downloadService.remove(jobId);
  try {
    await safeEditMessageText(ctx, translateForChat(chatId, 'jobs.removed', { label: existing.label ?? jobId }));
  } catch (error) {
    console.error('Failed to edit job message after deletion:', error);
  }
  await sendJobList(chatId, clientId);
});

bot.action(/^set-locale:(\w+)$/i, async (ctx) => {
  const match = ctx.match as RegExpExecArray | undefined;
  const requested = match?.[1]?.toLowerCase();
  const chatId = ctx.chat?.id;
  if (!chatId || !requested || !isSupportedLocale(requested)) {
    await safeAnswerCallback(ctx);
    return;
  }
  const clientId = await ensureTelegramClient(chatId);
  const existing = getChatLocale(chatId);
  if (existing === requested) {
    await safeAnswerCallback(ctx);
    return;
  }
  const newLocale = setChatLocale(chatId, requested);
  await clientRegistry.setClientLocale(clientId, newLocale === defaultLocale ? null : newLocale);
  await safeAnswerCallback(ctx);
  await sendTelegramMessage(
    chatId,
    translate('locale.updated', newLocale, { language: getLocaleDisplayName(newLocale) })
  );
  await sendStartMessage(chatId);
});

downloadService.on('ready', (jobs) => {
  jobs.forEach((job) => trackedJobs.set(job.jobId, job));
});

downloadService.on('jobUpdated', (job) => {
  const previous = trackedJobs.get(job.jobId);
  const statusChanged = !previous || previous.lastKnownStatus !== job.lastKnownStatus;
  const previousLink = previous ? normalizeShortUrl(previous.shortUrl ?? null) : null;
  const currentLink = normalizeShortUrl(job.shortUrl ?? null);
  const linkReady = !previousLink && !!currentLink;
  trackedJobs.set(job.jobId, job);
  if (job.lastKnownStatus !== 'completed' || !currentLink) {
    return;
  }
  if (!statusChanged && !linkReady) {
    return;
  }
  void notifyJobOwner(job, (chatId) => {
    const locale = getChatLocale(chatId);
    return [
      translate('notifications.jobCompleted', locale, { label: job.label ?? job.btih }),
      ...formatJobInfoLines(job, locale)
    ].join('\n');
  });
});

downloadService.on('jobRemoved', (job) => {
  trackedJobs.delete(job.jobId);
  const suppressedClientId = removalSuppressions.get(job.jobId);
  removalSuppressions.delete(job.jobId);
  if (suppressedClientId && suppressedClientId === job.clientId) {
    return;
  }
  void notifyJobOwner(job, (chatId) =>
    translate('notifications.jobRemoved', getChatLocale(chatId), { label: job.label ?? job.jobId })
  );
});

downloadService.on('error', (error) => {
  void broadcast((chatId) => translateForChat(chatId, 'service.error', { message: error.message }));
});

const startBot = async () => {
  await ensureBootstrapped();
  const me = await bot.telegram.getMe();
  botUsername = me.username ?? undefined;
  if (!botUsername) {
    throw new Error('Bot username is required');
  }
  await bot.telegram.setMyCommands(botCommands);
  await bot.launch();
  console.log('Telegram bot started.');
};

startBot().catch((error) => {
  console.error('Failed to start bot:', error);
  poller.stop();
  process.exit(1);
});

const stop = async (reason: string) => {
  poller.stop();
  await bot.stop(reason);
};

process.once('SIGINT', () => {
  void stop('SIGINT').finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  void stop('SIGTERM').finally(() => process.exit(0));
});
