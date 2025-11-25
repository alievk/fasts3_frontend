import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { test } from 'node:test';
import { createTelegramBot } from '../telegramBot.js';
import { MemoryChatRegistry } from '../memoryChatRegistry.js';
import type { Config, OwnedJob } from '../types.js';

const createTestConfig = (): Config => ({
  apiBaseUrl: 'http://localhost:8000/api',
  apiToken: 'test-token',
  timezone: 'UTC',
  pollingIntervalMs: 1000,
  searchLimit: 5,
  searchPageSize: 5,
  searchRequestTimeoutMs: 1000,
  searchMinSizeBytes: undefined,
  searchMaxSizeBytes: undefined,
  playerBaseUrl: 'http://localhost/player',
  userDbProvider: 'd1',
  d1AccountId: 'test-acc',
  d1DatabaseId: 'test-db',
  d1ApiToken: 'test-token',
  paymentProvider: 'yookassa',
  yookassaShopId: 'shop',
  yookassaSecretKey: 'secret',
  botLocale: 'en',
  botTranslationsBundle: 'bot'
});

class StubDownloadService extends EventEmitter {
  async init(): Promise<void> {}
  async checkHealth(): Promise<void> {}
  async syncAll(): Promise<void> {}
  getJobs(): OwnedJob[] {
    return [];
  }
  getJobsForChat(): OwnedJob[] {
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
  const paymentStore = {
    listVisiblePlans: async () => [],
    getPlan: async () => undefined,
    findPendingOrder: async () => undefined,
    createOrder: async () => {
      throw new Error('not implemented');
    },
    setOrderExternalId: async () => {}
  };
  const paymentClient = {
    createPayment: async () => {
      throw new Error('not implemented');
    }
  };
  const poller = {
    start(): void {},
    stop(): void {}
  } as const;
  const runtime = createTelegramBot('test-token', config, {
    downloadService: downloadService as unknown as any,
    poller: poller as unknown as any,
    apiClient: {} as any,
    chatRegistry: new MemoryChatRegistry(),
    paymentStore: paymentStore as any,
    paymentClient: paymentClient as any
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

test('/lang shows language buttons with localized prompt', async () => {
  const { runtime, sentMessages } = createRuntimeWithStubs();
  await runtime.bot.handleUpdate({
    update_id: 3,
    message: {
      message_id: 30,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 7, type: 'private', first_name: 'User' },
      text: '/lang',
      entities: [{ offset: 0, length: 5, type: 'bot_command' }]
    }
  } as any);
  const message = sentMessages.find(({ chatId }) => chatId === 7);
  assert.ok(message, 'expected a /lang response');
  assert.ok(
    message.text.includes('Choose language:') || message.text.includes('Выбери язык:'),
    'expected language selection prompt'
  );
  const markup = message.replyMarkup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined;
  assert.ok(markup && Array.isArray(markup.inline_keyboard), 'expected inline keyboard');
  const buttons = (markup.inline_keyboard ?? []).flat();
  const labels = buttons.map((button) => button.text);
  assert.ok(labels.some((label) => label.includes('Русский')), 'expected Russian language button');
  assert.ok(labels.some((label) => label.includes('English')), 'expected English language button');
  const callbacks = buttons.map((button) => button.callback_data);
  assert.ok(callbacks.includes('set-locale:ru'), 'expected set-locale:ru callback');
  assert.ok(callbacks.includes('set-locale:en'), 'expected set-locale:en callback');
});

test('job completion notifies owner only once', async () => {
  const { runtime, downloadService, sentMessages } = createRuntimeWithStubs();
  await runtime.start();
  const job: OwnedJob = {
    jobId: 'job-1',
    telegramId: '42',
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
