import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTelegramBot } from '../telegramBot.js';

test('createTelegramBot is exported as a function', () => {
  assert.equal(typeof createTelegramBot, 'function');
});

