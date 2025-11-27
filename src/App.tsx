import React from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';

export const App: React.FC = () => {
  const { exit } = useApp();

  const items = [{ label: 'Exit', value: 'exit' }];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="yellow">Admin CLI</Text>
      </Box>
      <SelectInput
        items={items}
        onSelect={() => exit()}
      />
      <Text color="gray">Use ↑/↓ to choose, Enter to confirm.</Text>
    </Box>
  );
};
