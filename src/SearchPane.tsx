import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { SearchResult } from './types.js';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { useSearch } from './useSearch.js';

interface SearchPaneProps {
  onSelect: (result: SearchResult) => void;
  disabled?: boolean;
}

export const SearchPane: React.FC<SearchPaneProps> = ({ onSelect, disabled = false }) => {
  const { query, setQuery, results, isSearching, search, lastError, clearError, reset } = useSearch();

  type SelectItem = {
    label: string;
    value: SearchResult;
    key?: string;
  };

  const items = useMemo<SelectItem[]>(
    () =>
      results.map((result) => ({
        label: `${result.title} • ${(result.sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB • ${result.seeders} seeders`,
        value: result,
        key: result.id
      })),
    [results]
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan">Search torrents</Text>
      <Box>
        <Text>{'> '}</Text>
        <TextInput
          value={query}
          onChange={(value) => {
            clearError();
            setQuery(value);
          }}
          onSubmit={() => {
            if (!disabled) {
              void search();
            }
          }}
          focus={!disabled}
          placeholder="Enter keywords (e.g. ubuntu noble)"
        />
      </Box>
      {isSearching && <Text color="gray">Searching…</Text>}
      {lastError && <Text color="red">{lastError}</Text>}
      {!isSearching && results.length > 0 && (
        <Box marginTop={1}>
          <SelectInput
            items={items}
            isFocused={!disabled}
            onSelect={(item: SelectItem) => {
              onSelect(item.value);
              reset();
            }}
          />
        </Box>
      )}
      {!isSearching && results.length === 0 && query.trim().length > 0 && <Text color="gray">No results.</Text>}
    </Box>
  );
};
