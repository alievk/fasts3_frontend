import React, { useCallback, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { SearchResult, SearchResultDetail } from './types.js';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { useSearch } from './useSearch.js';
import { useServices } from './serviceContext.js';

interface SearchPaneProps {
  onDownload: (result: SearchResultDetail) => void;
  disabled?: boolean;
}

const formatGigabytes = (bytes?: number | null): string | null => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) {
    return null;
  }
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
};

const formatSizeLabel = (bytes?: number | null): string => {
  const value = formatGigabytes(bytes);
  return value ? `${value}Gb` : 'Unknown';
};

const formatResultLabel = (result: SearchResult): string => {
  const provider = result.providerLabel || result.provider;
  const sizeText = formatSizeLabel(result.sizeBytes);
  return `[${provider}] Name: ${result.title} | Size: ${sizeText} | Seeds: ${result.seeders} | Peers: ${result.leechers}`;
};

const resolveLargestExtension = (detail: SearchResultDetail | undefined): string => {
  if (!detail || detail.files.length === 0) {
    return 'Unknown';
  }
  const sorted = [...detail.files].sort((a, b) => {
    const left = a.sizeBytes ?? 0;
    const right = b.sizeBytes ?? 0;
    return right - left;
  });
  const candidate = sorted.find((file) => typeof file.sizeBytes === 'number' && file.sizeBytes > 0) ?? sorted[0];
  const name = candidate?.name ?? '';
  const match = name.match(/(\.[^.\s]+)$/i);
  return match ? match[1].toLowerCase() : 'Unknown';
};

export const SearchPane: React.FC<SearchPaneProps> = ({ onDownload, disabled = false }) => {
  const { downloadService } = useServices();
  const { query, setQuery, results, isSearching, search, lastError, clearError, reset } = useSearch();
  const [selectedResult, setSelectedResult] = useState<SearchResult | undefined>();
  const [detail, setDetail] = useState<SearchResultDetail | undefined>();
  const [detailError, setDetailError] = useState<string | undefined>();
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const clearSelection = useCallback(() => {
    setSelectedResult(undefined);
    setDetail(undefined);
    setDetailError(undefined);
    setIsLoadingDetail(false);
  }, []);

  const handleQueryChange = (value: string) => {
    clearError();
    clearSelection();
    setQuery(value);
  };

  const handleSearchSubmit = () => {
    if (!disabled) {
      void search();
    }
  };

  const showDetail = useCallback(
    async (result: SearchResult) => {
      setSelectedResult(result);
      setDetail(undefined);
      setDetailError(undefined);
      setIsLoadingDetail(true);
      try {
        const fetched = await downloadService.getSearchResultDetail(result);
        if (!fetched) {
          setDetailError('Details unavailable for this result.');
        } else {
          setDetail(fetched);
        }
      } catch (error) {
        setDetailError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [downloadService]
  );

  type SelectItem = {
    label: string;
    value: SearchResult;
    key?: string;
  };

  const items = useMemo<SelectItem[]>(
    () =>
      results.map((result) => ({
        label: formatResultLabel(result),
        value: result,
        key: result.id
      })),
    [results]
  );

  const handleDownloadConfirm = () => {
    if (!detail) {
      return;
    }
    onDownload(detail);
    clearSelection();
    reset();
  };

  const renderDetailView = () => {
    if (!selectedResult) {
      return null;
    }
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">{selectedResult.title}</Text>
        <Text>Provider: {selectedResult.providerLabel || selectedResult.provider}</Text>
        <Text>
          Size: {formatSizeLabel(detail?.sizeBytes ?? selectedResult.sizeBytes)} • Seeds: {selectedResult.seeders} • Peers: {selectedResult.leechers}
        </Text>
        {detail && (
          <>
            <Text>Hash: {detail.hash ?? 'Unknown'}</Text>
            <Text>Largest file extension: {resolveLargestExtension(detail)}</Text>
          </>
        )}
        {isLoadingDetail && <Text color="gray">Loading details…</Text>}
        {detailError && !isLoadingDetail && <Text color="red">{detailError}</Text>}
        {!isLoadingDetail && (
          <Box marginTop={1} flexDirection="column">
            <SelectInput
              items={
                detail
                  ? [
                      { label: 'Download', value: 'download' },
                      { label: 'Back to results', value: 'back' }
                    ]
                  : [{ label: 'Back to results', value: 'back' }]
              }
              isFocused={!disabled}
              onSelect={(item) => {
                if (item.value === 'download') {
                  handleDownloadConfirm();
                } else {
                  clearSelection();
                }
              }}
            />
            <Text color="gray">Use ↑/↓ to choose an action, Enter to confirm.</Text>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan">Search torrents</Text>
      <Box>
        <Text>{'> '}</Text>
        <TextInput
          value={query}
          onChange={handleQueryChange}
          onSubmit={handleSearchSubmit}
          focus={!disabled && !selectedResult}
          placeholder="Enter keywords (e.g. ubuntu noble)"
        />
      </Box>
      {isSearching && <Text color="gray">Searching…</Text>}
      {lastError && <Text color="red">{lastError}</Text>}
      {!isSearching && results.length > 0 && !selectedResult && (
        <Box marginTop={1} flexDirection="column">
          <SelectInput
            items={items}
            isFocused={!disabled}
            onSelect={(item: SelectItem) => {
              if (!disabled) {
                void showDetail(item.value);
              }
            }}
          />
          <Text color="gray">Use ↑/↓ to choose, Enter to view details.</Text>
        </Box>
      )}
      {!isSearching && results.length === 0 && query.trim().length > 0 && <Text color="gray">No results.</Text>}
      {renderDetailView()}
    </Box>
  );
};
