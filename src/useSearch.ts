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
  const [resultsQuery, setResultsQuery] = useState<string | undefined>();
  const [isSearching, setIsSearching] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      setResultsQuery(undefined);
      return;
    }

    setIsSearching(true);
    setLastError(undefined);
    try {
      const found = await downloadService.search(query);
      setResults(found);
      setResultsQuery(query);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSearching(false);
    }
  }, [downloadService, query]);

  const reset = () => {
    setResults([]);
    setQuery('');
    setResultsQuery(undefined);
  };

  const updateQuery = useCallback(
    (value: string) => {
      setQuery(value);
      if (value !== resultsQuery) {
        setResults([]);
        setResultsQuery(undefined);
      }
    },
    [resultsQuery]
  );

  return {
    query,
    setQuery: updateQuery,
    results,
    isSearching,
    search: runSearch,
    lastError,
    clearError: () => setLastError(undefined),
    reset
  };
};
