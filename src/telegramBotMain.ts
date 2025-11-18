import { loadConfig } from './config.js';
import { createTelegramBot } from './telegramBot.js';

const botToken = process.env.TORRENT_TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('Missing TORRENT_TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const config = loadConfig();
const runtime = createTelegramBot(botToken, config);

runtime.start().catch((error) => {
  console.error('Failed to start bot:', error);
  void runtime.stop('startup-failed').finally(() => process.exit(1));
});

process.once('SIGINT', () => {
  void runtime.stop('SIGINT').finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  void runtime.stop('SIGTERM').finally(() => process.exit(0));
});

