import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { test } from 'node:test';
import { createTelegramBot } from '../telegramBot.js';
import type { Config, OwnedJob } from '../types.js';

const createTestConfig = (): Config => ({
  apiBaseUrl: 'http://localhost:8000/api',
  apiToken: 'test-token',
  pollingIntervalMs: 1000,
  searchLimit: 5,
  searchPageSize: 5,
  searchRequestTimeoutMs: 1000,
  searchMinSizeBytes: undefined,
  searchMaxSizeBytes: undefined,
  playerBaseUrl: 'http://localhost/player',
  clientDbPath: ':memory:',
  botLocale: 'en'
});

class StubDownloadService extends EventEmitter {
  async init(): Promise<void> {}
  async checkHealth(): Promise<void> {}
  async syncAll(): Promise<void> {}
  getJobs(): OwnedJob[] {
    return [];
  }
  getJobsForClient(): OwnedJob[] {
    return [];
  }
  async search(): Promise<never[]> {
    return [];
  }
  async getSearchResultDetail(): Promise<undefined> {
    return undefined;
  }
  async startDownload(): Promise<never> {
    throw new Error('not implemented');
  }
  async syncJob(): Promise<void> {}
  async remove(): Promise<void> {}
}

const createRuntimeWithStubs = () => {
  const config = createTestConfig();
  if (!process.env.PLAYER_BASE_URL) {
    process.env.PLAYER_BASE_URL = config.playerBaseUrl;
  }
  const downloadService = new StubDownloadService();
  const poller = {
    start(): void {},
    stop(): void {}
  } as const;
  const runtime = createTelegramBot('test-token', config, {
    downloadService: downloadService as unknown as any,
    poller: poller as unknown as any
  });
  const sentMessages: { chatId: number; text: string; replyMarkup?: unknown }[] = [];
  (runtime.bot.telegram as any).sendMessage = async (chatId: number, text: string) => {
    sentMessages.push({ chatId, text });
    return {};
  };
  (runtime.bot.telegram as any).deleteMessage = async () => ({});
  (runtime.bot.telegram as any).editMessageText = async () => ({});
  (runtime.bot.telegram as any).answerCbQuery = async () => ({});
  (runtime.bot.telegram as any).getMe = async () => ({
    id: 1,
    is_bot: true,
    first_name: 'TestBot',
    username: 'test_bot'
  });
  (runtime.bot.telegram as any).setMyCommands = async () => ({});
  (runtime.bot as any).launch = async () => {};
  const telegramProto = Object.getPrototypeOf(runtime.bot.telegram) as any;
  if (telegramProto && typeof telegramProto.callApi === 'function') {
    telegramProto.callApi = async (method: string, payload: { chat_id: number; text: string; reply_markup?: unknown }) => {
      if (method === 'sendMessage' && payload && typeof payload.chat_id === 'number') {
        sentMessages.push({ chatId: payload.chat_id, text: payload.text, replyMarkup: payload.reply_markup });
      }
      return {};
    };
  }
  return { runtime, downloadService, sentMessages };
};

test('createTelegramBot is exported as a function', () => {
  assert.equal(typeof createTelegramBot, 'function');
});

test('commands are ignored in non-private chats', async () => {
  const { runtime, sentMessages } = createRuntimeWithStubs();
  await runtime.bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 123, type: 'group', title: 'Test group' },
      text: '/search',
      entities: [{ offset: 0, length: 7, type: 'bot_command' }]
    }
  } as any);
  assert.equal(sentMessages.length, 0);
});

test('stale detail tokens are treated as expired', async () => {
  const { runtime, sentMessages } = createRuntimeWithStubs();
  const token = 'provider_123';
  await runtime.bot.handleUpdate({
    update_id: 2,
    callback_query: {
      id: 'cbq-1',
      from: { id: 42, is_bot: false, first_name: 'User' },
      message: {
        message_id: 20,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 42, type: 'private', first_name: 'User' },
        text: 'results'
      },
      data: `confirm:${encodeURIComponent(token)}`
    }
  } as any);
  assert.ok(
    sentMessages.some(({ text }) => text.includes('Search results expired') || text.includes('устарели')),
    'expected an expired search message'
  );
});

test('job completion notifies owner only once', async () => {
  const { runtime, downloadService, sentMessages } = createRuntimeWithStubs();
  await runtime.start();
  const job: OwnedJob = {
    jobId: 'job-1',
    clientId: 'telegram:42',
    hash: 'hash',
    label: 'Test job',
    createdAt: new Date().toISOString(),
    lastKnownStatus: 'completed',
    lastSyncedAt: new Date().toISOString(),
    statusUpdatedAt: new Date().toISOString(),
    progress: 1,
    shortUrl: null,
    error: null,
    sizeBytes: null,
    s3ObjectKey: null
  };
  downloadService.emit('jobUpdated', job);
  downloadService.emit('jobUpdated', job);
  assert.equal(
    sentMessages.filter(({ chatId }) => chatId === 42).length,
    1,
    'expected exactly one notification for completed job'
  );
});
