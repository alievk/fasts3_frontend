import { useCallback, useState } from 'react';
import { SearchResult } from './types.js';
import { useServices } from './serviceContext.js';

interface UseSearchState {
  query: string;
  setQuery: (value: string) => void;
  results: SearchResult[];
  isSearching: boolean;
  search: () => Promise<void>;
  lastError?: string;
  clearError: () => void;
  reset: () => void;
}

export const useSearch = (): UseSearchState => {
  const { downloadService } = useServices();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    setLastError(undefined);
    try {
      const found = await downloadService.search(query);
      setResults(found);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSearching(false);
    }
  }, [downloadService, query]);

  const reset = () => {
    setResults([]);
    setQuery('');
  };

  return {
    query,
    setQuery,
    results,
    isSearching,
    search: runSearch,
    lastError,
    clearError: () => setLastError(undefined),
    reset
  };
};
