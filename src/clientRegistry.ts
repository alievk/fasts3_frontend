import { ClientRegistry } from './types.js';
import { SQLiteClientRegistry } from './sqliteClientRegistry.js';

export const createClientRegistry = (dbPath: string): ClientRegistry => {
  return new SQLiteClientRegistry(dbPath);
};

export { MemoryClientRegistry } from './memoryClientRegistry.js';
