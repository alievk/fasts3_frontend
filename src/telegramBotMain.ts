import { loadConfig } from './config.js';
import { createTelegramBot } from './telegramBot.js';
import type { TelegramBotRuntime } from './telegramBot.js';

let runtime: TelegramBotRuntime | undefined;
let isShuttingDown = false;

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};

const shutdown = async (code: number, reason: string): Promise<void> => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  try {
    if (runtime) {
      await runtime.stop(reason);
    }
  } catch (error) {
    console.error('Failed during bot shutdown:', error);
  } finally {
    process.exit(code);
  }
};

const setupSignalHandlers = (): void => {
  process.once('SIGINT', () => {
    void shutdown(0, 'SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown(0, 'SIGTERM');
  });
};

const setupGlobalErrorHandlers = (): void => {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception in bot process:', error);
    if (runtime) {
      void shutdown(1, 'uncaught-exception');
    } else {
      process.exit(1);
    }
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection in bot process:', reason);
    if (runtime) {
      void shutdown(1, 'unhandled-rejection');
    } else {
      process.exit(1);
    }
  });
};

const main = async (): Promise<void> => {
  const botToken = requireEnv('TORRENT_TELEGRAM_BOT_TOKEN');
  const config = loadConfig();
  runtime = createTelegramBot(botToken, config);
  setupSignalHandlers();
  await runtime.start();
};

setupGlobalErrorHandlers();

void main().catch((error) => {
  console.error('Failed to start bot:', error);
  if (runtime) {
    void shutdown(1, 'startup-failed');
  } else {
    process.exit(1);
  }
});
