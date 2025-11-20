import { ClientRegistry, Config } from './types.js';
import { D1ClientRegistry } from './d1ClientRegistry.js';
import { SQLiteClientRegistry } from './sqliteClientRegistry.js';

export const createClientRegistry = (config: Config): ClientRegistry => {
  if (config.clientDbProvider === 'd1') {
    if (!config.d1AccountId || !config.d1DatabaseId || !config.d1ApiToken) {
      throw new Error('D1 provider selected but credentials are missing in config');
    }
    return new D1ClientRegistry(config.d1AccountId, config.d1DatabaseId, config.d1ApiToken);
  }
  return new SQLiteClientRegistry(config.clientDbPath);
};

export { MemoryClientRegistry } from './memoryClientRegistry.js';
