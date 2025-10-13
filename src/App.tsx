import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useJobs } from './useJobs.js';
import { SearchPane } from './SearchPane.js';
import { JobTracker } from './JobTracker.js';
import { useServices } from './serviceContext.js';
import { SearchResult } from './types.js';

export const App: React.FC = () => {
  const { downloadService } = useServices();
  const { jobs, ready, lastError, clearError } = useJobs();
  const [isStarting, setIsStarting] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  const handleSelect = async (result: SearchResult) => {
    if (isStarting) {
      return;
    }

    setIsStarting(true);
    setActionError(undefined);
    try {
      const job = await downloadService.startDownload(result);
      setInfoMessage(`Started download: ${job.label ?? job.jobId}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStarting(false);
    }
  };

  const handleRemove = async (jobId: string) => {
    try {
      await downloadService.remove(jobId);
      setInfoMessage(`Removed job ${jobId}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="yellow">Torrent CLI (mocked backend)</Text>
      </Box>
      <SearchPane onSelect={handleSelect} disabled={!ready || isStarting} />
      <JobTracker jobs={jobs} onRemove={handleRemove} disabled={!ready} />
      <Box marginTop={1} flexDirection="column">
        {!ready && <Text color="gray">Loading saved jobs…</Text>}
        {infoMessage && (
          <Text color="green">
            {infoMessage}
          </Text>
        )}
        {lastError && (
          <Text color="red">
            {lastError}
          </Text>
        )}
        {actionError && (
          <Text color="red">
            {actionError}
          </Text>
        )}
        {(lastError || actionError) && (
          <Text color="gray">
            Press enter in search box to retry after fixing issues.
          </Text>
        )}
      </Box>
    </Box>
  );
};
