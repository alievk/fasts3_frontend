import { ChatRegistry, Config } from './types.js';
import { D1ChatRegistry } from './d1ChatRegistry.js';
import { SQLiteChatRegistry } from './sqliteChatRegistry.js';

export const createChatRegistry = (config: Config): ChatRegistry => {
  if (config.clientDbProvider === 'd1') {
    if (!config.d1AccountId || !config.d1DatabaseId || !config.d1ApiToken) {
      throw new Error('D1 provider selected but credentials are missing in config');
    }
    return new D1ChatRegistry(config.d1AccountId, config.d1DatabaseId, config.d1ApiToken);
  }
  return new SQLiteChatRegistry(config.clientDbPath);
};

export { MemoryChatRegistry } from './memoryChatRegistry.js';
