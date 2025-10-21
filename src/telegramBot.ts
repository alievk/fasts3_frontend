import { Telegraf, Markup } from 'telegraf';
import type { Context } from 'telegraf';
import { loadConfig } from './config.js';
import { createApiClient } from './apiClient.js';
import { JobStore } from './jobStore.js';
import { DownloadService } from './downloadService.js';
import { Poller } from './poller.js';
import { SearchResult, StoredJob } from './types.js';

const botToken = process.env.TORRENT_TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('Missing TORRENT_TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const config = loadConfig();
const apiClient = createApiClient();
const jobStore = new JobStore(config.statePath);
const downloadService = new DownloadService(apiClient, jobStore);
const poller = new Poller(downloadService, config.pollingIntervalMs);
const bot = new Telegraf(botToken);

const activeChats = new Set<number>();
const searchSessions = new Map<number, SearchResult[]>();
const trackedJobs = new Map<string, StoredJob>();
const removalSuppressions = new Map<string, number>();

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
      try {
        await bot.telegram.sendMessage(chatId, message);
      } catch (error) {
        const code = (error as { response?: { error_code?: number } }).response?.error_code;
        if (code === 403) {
          activeChats.delete(chatId);
        }
        console.error(`Failed to deliver message to ${chatId}:`, error);
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

const formatJobDetail = (job: StoredJob): string => {
  const lastUpdated = formatDateTime(job.lastSyncedAt ?? null);
  const lines = [
    `Title: ${job.label ?? job.jobId}`,
    `ID: ${job.jobId}`,
    `Status: ${job.lastKnownStatus}`,
    `Progress: ${
      job.lastKnownStatus === 'completed'
        ? '100%'
        : job.progress === null
          ? '—'
          : `${Math.round(job.progress * 100)}%`
    }`,
    `Size: ${formatSize(job.sizeBytes ?? null)}`,
    job.s3Url ? `S3 link: ${job.s3Url}` : undefined,
    job.error ? `Error: ${job.error}` : undefined,
    `Last update: ${lastUpdated}`
  ];
  return lines.filter(Boolean).join('\n');
};

const normalizeTitle = (title: string): string => {
  return title;
};

const buildSearchKeyboard = (results: SearchResult[]) => {
  return Markup.inlineKeyboard(
    results.map((_result, index) => [Markup.button.callback(`Download ${index + 1}`, `start:${index}`)])
  );
};

const buildJobActionsKeyboard = (job: StoredJob) => {
  const encodedId = encodeURIComponent(job.jobId);
  const buttons = [
    job.s3Url ? Markup.button.url('Open link', job.s3Url) : undefined,
    Markup.button.callback('Refresh', `refresh:${encodedId}`),
    Markup.button.callback('Delete', `delete:${encodedId}`)
  ].filter(Boolean) as Parameters<typeof Markup.inlineKeyboard>[0];
  return Markup.inlineKeyboard(buttons, { columns: 1 });
};

const buildJobsKeyboard = (jobs: StoredJob[]) => {
  const buttons = jobs.map((job) =>
    Markup.button.callback(
      `${normalizeTitle(job.label ?? job.jobId)} — ${job.lastKnownStatus}`,
      `job:${encodeURIComponent(job.jobId)}`
    )
  );
  return Markup.inlineKeyboard(buttons, { columns: 1 });
};

const sendJobList = async (chatId: number) => {
  const jobs = downloadService.getJobs();
  if (jobs.length === 0) {
    await bot.telegram.sendMessage(chatId, 'No active or completed jobs. Run /search to start one.');
    return;
  }
  await bot.telegram.sendMessage(chatId, 'Select a job to view details:', buildJobsKeyboard(jobs));
};

bot.use(async (ctx, next) => {
  if (ctx.chat) {
    activeChats.add(ctx.chat.id);
  }
  await ensureBootstrapped();
  return next();
});

bot.start(async (ctx) => {
  await ctx.reply(
    [
      'Welcome to Torrent Bot.',
      'Commands:',
      '/search <query> — search torrents',
      '/jobs — manage downloads via buttons'
    ].join('\n')
  );
});

bot.command('search', async (ctx) => {
  const text = ctx.message?.text ?? '';
  const query = text.replace(/^\/search(@\w+)?\s*/i, '').trim();
  if (!query) {
    await ctx.reply('Usage: /search <query>');
    return;
  }
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }
  try {
    const results = await downloadService.search(query);
    if (results.length === 0) {
      await ctx.reply(`No results for "${query}"`);
      return;
    }
    searchSessions.set(chatId, results);
    const lines = results.map((result, index) => {
      return [
        `${index + 1}. ${normalizeTitle(result.title)}`,
        `Size: ${formatSize(result.sizeBytes)}`,
        `Seeders: ${result.seeders} • Leechers: ${result.leechers}`
      ].join('\n');
    });
    await ctx.reply(lines.join('\n\n'), buildSearchKeyboard(results));
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
  await sendJobList(chatId);
});

bot.action(/^start:(\d+)$/, async (ctx) => {
  const match = ctx.match as RegExpExecArray | undefined;
  const index = Number.parseInt(match?.[1] ?? '', 10);
  const chatId = ctx.chat?.id;
  if (!chatId) {
    await safeAnswerCallback(ctx);
    return;
  }
  const results = searchSessions.get(chatId);
  if (!results || Number.isNaN(index) || index < 0 || index >= results.length) {
    await safeAnswerCallback(ctx, 'Search results expired. Run /search again.');
    return;
  }
  const result = results[index];
  try {
    const job = await downloadService.startDownload(result);
    await safeAnswerCallback(ctx, 'Download started.');
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(`Started ${result.title}\nJob ID: ${job.jobId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await safeAnswerCallback(ctx, 'Failed to start download', { show_alert: true });
    await ctx.reply(`Failed to start download: ${message}`);
  }
});

bot.action(/^job:(.+)$/, async (ctx) => {
  const match = ctx.match as RegExpExecArray | undefined;
  const rawId = match?.[1];
  const jobId = rawId ? decodeURIComponent(rawId) : undefined;
  if (!jobId) {
    await safeAnswerCallback(ctx);
    return;
  }
  await safeAnswerCallback(ctx);
  const job = trackedJobs.get(jobId) ?? downloadService.getJobs().find((item) => item.jobId === jobId);
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
  if (!jobId) {
    await safeAnswerCallback(ctx);
    return;
  }
  await safeAnswerCallback(ctx);
  await downloadService.syncJob(jobId);
  const job = trackedJobs.get(jobId) ?? downloadService.getJobs().find((item) => item.jobId === jobId);
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
  const existing = trackedJobs.get(jobId) ?? downloadService.getJobs().find((item) => item.jobId === jobId);
  removalSuppressions.set(jobId, chatId);
  await downloadService.remove(jobId);
  try {
    await safeEditMessageText(ctx, `Job removed: ${existing?.label ?? jobId}`);
  } catch (error) {
    console.error('Failed to edit job message after deletion:', error);
  }
  await sendJobList(chatId);
});

downloadService.on('ready', (jobs) => {
  jobs.forEach((job) => trackedJobs.set(job.jobId, job));
});

downloadService.on('jobUpdated', (job) => {
  const previous = trackedJobs.get(job.jobId);
  const statusChanged = !previous || previous.lastKnownStatus !== job.lastKnownStatus;
  const linkReady = !previous?.s3Url && !!job.s3Url;
  trackedJobs.set(job.jobId, job);
  if (!statusChanged && !linkReady) {
    return;
  }
  void broadcast(
    [
      `Job update: ${job.label ?? job.jobId}`,
      `Status: ${job.lastKnownStatus}`,
      job.progress !== null ? `Progress: ${Math.round(job.progress * 100)}%` : undefined,
      job.s3Url ? `S3 link: ${job.s3Url}` : undefined
    ]
      .filter(Boolean)
      .join('\n')
  );
});

downloadService.on('jobRemoved', (jobId) => {
  const previous = trackedJobs.get(jobId);
  trackedJobs.delete(jobId);
  const label = previous?.label ?? jobId;
  const suppressedChatId = removalSuppressions.get(jobId);
  removalSuppressions.delete(jobId);
  void broadcast(`Job removed: ${label}`, suppressedChatId !== undefined ? { excludeChatId: suppressedChatId } : undefined);
});

downloadService.on('error', (error) => {
  void broadcast(`Service error: ${error.message}`);
});

const startBot = async () => {
  await ensureBootstrapped();
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
