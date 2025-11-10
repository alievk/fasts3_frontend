import { Telegraf, Markup } from 'telegraf';
import type { Context } from 'telegraf';
import { loadConfig } from './config.js';
import { createApiClient } from './apiClient.js';
import { DownloadService } from './downloadService.js';
import { Poller } from './poller.js';
import { OwnedJob, SearchResult } from './types.js';
import { createSearchPipeline } from './searchPipeline.js';
import { createClientRegistry } from './clientRegistry.js';

const botToken = process.env.TORRENT_TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('Missing TORRENT_TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const config = loadConfig();
const apiClient = createApiClient();
const clientRegistry = createClientRegistry(config.clientDbPath);
const searchPipeline = createSearchPipeline(config);
const downloadService = new DownloadService(apiClient, clientRegistry, config.searchLimit, searchPipeline);
const poller = new Poller(downloadService, config.pollingIntervalMs);
const bot = new Telegraf(botToken);

const botCommands = [
  { command: 'search', description: 'Search torrents' },
  { command: 'jobs', description: 'Manage downloads' }
];

const activeChats = new Set<number>();

type SearchSession = {
  results: SearchResult[];
  page: number;
};

const searchPageSize = config.searchPageSize;

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
  await clientRegistry.registerClient(clientId, { type: 'telegram', chatId });
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
        await broadcast(`Backend health check failed: ${message}`);
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

const broadcast = async (message: string, options?: { excludeChatId?: number }) => {
  const excludeChatId = options?.excludeChatId;
  if (activeChats.size === 0) {
    return;
  }
  await Promise.all(
    [...activeChats].map(async (chatId) => {
      if (excludeChatId !== undefined && chatId === excludeChatId) {
        return;
      }
      await sendTelegramMessage(chatId, message);
    })
  );
};

const notifyJobOwner = async (job: OwnedJob, message: string): Promise<void> => {
  const targets = await clientRegistry.getNotificationTargets(job.jobId);
  if (targets.length === 0) {
    return;
  }
  await Promise.all(
    targets.map(async (target) => {
      if (target.transport.type === 'telegram') {
        await sendTelegramMessage(target.transport.chatId, message);
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

const formatSize = (size: number | null | undefined): string => {
  if (typeof size !== 'number' || Number.isNaN(size)) {
    return 'unknown';
  }
  const gigabytes = size / (1024 * 1024 * 1024);
  if (size < 100 * 1024 * 1024) {
    const megabytes = size / (1024 * 1024);
    return `${megabytes.toFixed(1)} MiB`;
  }
  return `${gigabytes.toFixed(2)} GiB`;
};

const formatDateTime = (primary: string | Date | null | undefined, fallback?: Date): string => {
  const value = primary ?? fallback ?? null;
  if (!value) {
    return 'unknown';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(date);
};

const buildPlayerUrl = (jobId: string): string => {
  const normalizedBase = config.playerBaseUrl.replace(/\/+$/, '');
  return `${normalizedBase}/public/player/?job_id=${encodeURIComponent(jobId)}`;
};

const formatJobInfoLines = (job: OwnedJob): string[] => {
  const downloadLink = job.shortUrl ?? job.s3Url ?? null;
  const expiresAt = job.s3UrlExpiresAt ? formatDateTime(job.s3UrlExpiresAt) : undefined;
  const playerLink = job.lastKnownStatus === 'completed' ? buildPlayerUrl(job.jobId) : undefined;
  const lines = [
    `Job ID: ${job.jobId}`,
    `BTIH: ${job.btih}`,
    `Status: ${job.lastKnownStatus}`,
    `Progress: ${
      job.lastKnownStatus === 'completed'
        ? '100%'
        : job.progress === null
          ? '—'
          : `${Math.round(job.progress * 100)}%`
    }`,
    `Size: ${formatSize(job.sizeBytes ?? null)}`,
    downloadLink ? `Download: ${downloadLink}` : undefined,
    expiresAt ? `Link expires: ${expiresAt}` : undefined,
    playerLink ? `Player: ${playerLink}` : undefined,
    job.error ? `Error: ${job.error}` : undefined
  ];
  return lines.filter((line): line is string => Boolean(line));
};

const formatJobDetail = (job: OwnedJob): string => {
  return [`Title: ${job.label ?? job.btih}`, ...formatJobInfoLines(job)].join('\n');
};

const normalizeTitle = (title: string): string => {
  return title;
};

const buildSearchPage = (results: SearchResult[], requestedPage: number) => {
  const totalPages = Math.max(1, Math.ceil(results.length / searchPageSize));
  const page = Math.min(Math.max(requestedPage, 0), totalPages - 1);
  const startIndex = page * searchPageSize;
  const pageResults = results.slice(startIndex, startIndex + searchPageSize);
  const lines = pageResults.map((result, offset) => {
    const index = startIndex + offset;
    return [
      `${index + 1}. ${normalizeTitle(result.title)}`,
      `Size: ${formatSize(result.sizeBytes)}`,
      `Seeders: ${result.seeders} • Leechers: ${result.leechers}`
    ].join('\n');
  });
  const rows: ReturnType<typeof Markup.button.callback>[][] = pageResults.map((_result, offset) => [
    Markup.button.callback(`Download ${startIndex + offset + 1}`, `start:${startIndex + offset}`)
  ]);
  const navButtons: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 0) {
    navButtons.push(Markup.button.callback('← Previous', `page:${page - 1}`));
  }
  if (page < totalPages - 1) {
    navButtons.push(Markup.button.callback('Next →', `page:${page + 1}`));
  }
  if (navButtons.length > 0) {
    rows.push(navButtons);
  }
  const text = `${lines.join('\n\n')}\n\nPage ${page + 1}/${totalPages}`;
  return {
    page,
    totalPages,
    text,
    keyboard: Markup.inlineKeyboard(rows)
  };
};

const buildJobActionsKeyboard = (job: OwnedJob) => {
  const encodedId = encodeURIComponent(job.jobId);
  const downloadLink = job.shortUrl ?? job.s3Url ?? null;
  const buttons = [
    downloadLink ? Markup.button.url('Open link', downloadLink) : undefined,
    Markup.button.callback('Refresh', `refresh:${encodedId}`),
    Markup.button.callback('Delete', `delete:${encodedId}`)
  ].filter(Boolean) as Parameters<typeof Markup.inlineKeyboard>[0];
  return Markup.inlineKeyboard(buttons, { columns: 1 });
};

const buildJobsKeyboard = (jobs: OwnedJob[]) => {
  const buttons = jobs.map((job) =>
    Markup.button.callback(
      `${normalizeTitle(job.label ?? job.btih)} — ${job.lastKnownStatus}`,
      `job:${encodeURIComponent(job.jobId)}`
    )
  );
  return Markup.inlineKeyboard(buttons, { columns: 1 });
};

const sendJobList = async (chatId: number, clientId: string) => {
  const jobs = downloadService.getJobsForClient(clientId);
  if (jobs.length === 0) {
    await sendTelegramMessage(chatId, 'No active or completed jobs. Run /search to start one.');
    return;
  }
  await sendTelegramMessage(chatId, 'Select a job to view details:', buildJobsKeyboard(jobs));
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
  await ctx.reply(
    [
      'Welcome to Torrent Bot.',
      'Commands:',
      '/search — search torrents',
      '/jobs — manage downloads via buttons'
    ].join('\n')
  );
});

bot.command('search', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  setConversationState(chatId, { type: 'search', stage: 'awaitingQuery' });
  await ctx.reply('Отправь мне название фильма.');
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  const state = getConversationState(chatId);
  if (!state || state.type !== 'search' || state.stage !== 'awaitingQuery') {
    return;
  }
  const query = ctx.message?.text?.trim();
  if (!query) {
    await ctx.reply('Отправь мне название фильма.');
    return;
  }
  clearConversationState(chatId, 'search');
  try {
    const results = await downloadService.search(query);
    if (results.length === 0) {
      await ctx.reply(`Ничего не найдено для "${query}"`);
      return;
    }
    const pageInfo = buildSearchPage(results, 0);
    searchSessions.set(chatId, { results, page: pageInfo.page });
    await ctx.reply(pageInfo.text, pageInfo.keyboard);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.reply(`Search failed: ${message}`);
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

bot.action(/^start:(\d+)$/, async (ctx) => {
  const match = ctx.match as RegExpExecArray | undefined;
  const index = Number.parseInt(match?.[1] ?? '', 10);
  const chatId = ctx.chat?.id;
  if (!chatId) {
    await safeAnswerCallback(ctx);
    return;
  }
  const clientId = await ensureTelegramClient(chatId);
  const session = searchSessions.get(chatId);
  const results = session?.results;
  if (!results || Number.isNaN(index) || index < 0 || index >= results.length) {
    await safeAnswerCallback(ctx, 'Search results expired. Run /search again.');
    return;
  }
  const result = results[index];
  try {
    const job = await downloadService.startDownload(result, clientId);
    await safeAnswerCallback(ctx, 'Download started.');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(
      [
        `Started ${result.title}`,
        `Job ID: ${job.jobId}`,
        `BTIH: ${job.btih}`,
        `\nCheck status: /jobs`
      ].join('\n')
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await safeAnswerCallback(ctx, 'Failed to start download', { show_alert: true });
    await ctx.reply(`Failed to start download: ${message}`);
  }
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
  if (!session) {
    await safeAnswerCallback(ctx, 'Search results expired. Run /search again.');
    return;
  }
  const pageInfo = buildSearchPage(session.results, requestedPage);
  session.page = pageInfo.page;
  await safeAnswerCallback(ctx);
  await safeEditMessageText(ctx, pageInfo.text, pageInfo.keyboard);
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
    await ctx.reply(`Job ${jobId} not found.`);
    return;
  }
  await ctx.reply(formatJobDetail(job), buildJobActionsKeyboard(job));
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
    await safeEditMessageText(ctx, `Job ${jobId} not found.`);
    return;
  }
  await safeEditMessageText(ctx, formatJobDetail(job), buildJobActionsKeyboard(job));
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
    await safeEditMessageText(ctx, `Job ${jobId} not found.`);
    return;
  }
  removalSuppressions.set(jobId, clientId);
  await downloadService.remove(jobId);
  try {
    await safeEditMessageText(ctx, `Job removed: ${existing.label ?? jobId}`);
  } catch (error) {
    console.error('Failed to edit job message after deletion:', error);
  }
  await sendJobList(chatId, clientId);
});

downloadService.on('ready', (jobs) => {
  jobs.forEach((job) => trackedJobs.set(job.jobId, job));
});

downloadService.on('jobUpdated', (job) => {
  const previous = trackedJobs.get(job.jobId);
  const statusChanged = !previous || previous.lastKnownStatus !== job.lastKnownStatus;
  const previousLink = previous?.shortUrl ?? previous?.s3Url ?? null;
  const currentLink = job.shortUrl ?? job.s3Url ?? null;
  const linkReady = !previousLink && !!currentLink;
  trackedJobs.set(job.jobId, job);
  if (job.lastKnownStatus !== 'completed' || !currentLink) {
    return;
  }
  if (!statusChanged && !linkReady) {
    return;
  }
  void notifyJobOwner(job, [`Job completed: ${job.label ?? job.btih}`, ...formatJobInfoLines(job)].join('\n'));
});

downloadService.on('jobRemoved', (job) => {
  trackedJobs.delete(job.jobId);
  const suppressedClientId = removalSuppressions.get(job.jobId);
  removalSuppressions.delete(job.jobId);
  if (suppressedClientId && suppressedClientId === job.clientId) {
    return;
  }
  void notifyJobOwner(job, `Job removed: ${job.label ?? job.jobId}`);
});

downloadService.on('error', (error) => {
  void broadcast(`Service error: ${error.message}`);
});

const startBot = async () => {
  await ensureBootstrapped();
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
