import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { loadConfig } from './config.js';
import { createChatRegistry } from './chatRegistry.js';
import { D1PaymentStore } from './d1PaymentStore.js';

type Screen = 'menu' | 'delete-user-input' | 'delete-user-confirm' | 'delete-user-result';

export const App: React.FC = () => {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('menu');
  const [telegramId, setTelegramId] = useState('');
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const items = [
    { label: 'Delete User', value: 'delete-user' },
    { label: 'Exit', value: 'exit' }
  ];

  const handleSelect = (item: { value: string }) => {
    if (item.value === 'exit') {
      exit();
    } else if (item.value === 'delete-user') {
      setTelegramId('');
      setResult(null);
      setScreen('delete-user-input');
    }
  };

  const handleTelegramIdSubmit = () => {
    const trimmed = telegramId.trim();
    if (!trimmed) return;
    setScreen('delete-user-confirm');
  };

  const performDelete = async () => {
    setIsProcessing(true);
    try {
      const config = loadConfig();
      const chatRegistry = createChatRegistry(config);
      const paymentStore = new D1PaymentStore(config.d1AccountId!, config.d1DatabaseId!, config.d1ApiToken!);

      const paymentDeleted = await paymentStore.deleteUser(telegramId.trim());
      const chatDeleted = await chatRegistry.deleteUser(telegramId.trim());

      if (chatDeleted || paymentDeleted) {
        setResult({ success: true, message: `User ${telegramId.trim()} deleted successfully` });
      } else {
        setResult({ success: false, message: `User ${telegramId.trim()} not found` });
      }
    } catch (error) {
      setResult({ success: false, message: `Error: ${error instanceof Error ? error.message : String(error)}` });
    }
    setIsProcessing(false);
    setScreen('delete-user-result');
  };

  useInput((input, key) => {
    if (screen === 'delete-user-input' && key.escape) {
      setScreen('menu');
    }
    if (screen === 'delete-user-confirm') {
      if (input.toLowerCase() === 'y') {
        void performDelete();
      } else if (input.toLowerCase() === 'n' || key.escape) {
        setScreen('menu');
      }
    }
    if (screen === 'delete-user-result' && (key.return || key.escape)) {
      setScreen('menu');
    }
  });

  if (screen === 'delete-user-input') {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="yellow">Delete User</Text>
        </Box>
        <Box>
          <Text>Telegram ID: </Text>
          <TextInput value={telegramId} onChange={setTelegramId} onSubmit={handleTelegramIdSubmit} />
        </Box>
        <Text color="gray">Enter telegram ID and press Enter. Esc to cancel.</Text>
      </Box>
    );
  }

  if (screen === 'delete-user-confirm') {
    if (isProcessing) {
      return (
        <Box flexDirection="column">
          <Text color="yellow">Deleting user {telegramId.trim()}...</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="red">⚠ Confirm Deletion</Text>
        </Box>
        <Text>Delete user <Text bold>{telegramId.trim()}</Text> and all their data?</Text>
        <Text color="gray">Press Y to confirm, N or Esc to cancel.</Text>
      </Box>
    );
  }

  if (screen === 'delete-user-result') {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color={result?.success ? 'green' : 'red'}>{result?.message}</Text>
        </Box>
        <Text color="gray">Press Enter to return to menu.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="yellow">Admin CLI</Text>
      </Box>
      <SelectInput items={items} onSelect={handleSelect} />
      <Text color="gray">Use ↑/↓ to choose, Enter to confirm.</Text>
    </Box>
  );
};
