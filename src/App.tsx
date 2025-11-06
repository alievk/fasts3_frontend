import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import { useJobs } from './useJobs.js';
import { useServices } from './serviceContext.js';
import { OwnedJob, SearchResult } from './types.js';
import { SearchPane } from './SearchPane.js';
import clipboard from 'clipboardy';

type Screen =
  | { key: 'menu' }
  | { key: 'search' }
  | { key: 'jobs' }
  | { key: 'jobDetail'; jobId: string };

type NavigationState = {
  history: Screen[];
  index: number;
};

export const App: React.FC = () => {
  const { downloadService } = useServices();
  const { jobs, ready, lastError, clearError } = useJobs();
  const [isStarting, setIsStarting] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [navigation, setNavigation] = useState<NavigationState>({ history: [{ key: 'menu' }], index: 0 });
  const { exit } = useApp();

  const currentScreen = navigation.history[navigation.index];

  const pushScreen = (screen: Screen) => {
    setNavigation((prev) => {
      const history = [...prev.history.slice(0, prev.index + 1), screen];
      return { history, index: history.length - 1 };
    });
  };

  const goBack = () => {
    setNavigation((prev) => {
      if (prev.index === 0) {
        return prev;
      }
      return { ...prev, index: prev.index - 1 };
    });
  };

  const goForward = () => {
    setNavigation((prev) => {
      if (prev.index >= prev.history.length - 1) {
        return prev;
      }
      return { ...prev, index: prev.index + 1 };
    });
  };

  useInput((_input, key) => {
    if (key.leftArrow) {
      goBack();
    } else if (key.rightArrow) {
      goForward();
    }
  });

  const screenTitle = useMemo(() => {
    switch (currentScreen.key) {
      case 'menu':
        return 'Main Menu';
      case 'search':
        return 'Search';
      case 'jobs':
        return 'Downloads';
      case 'jobDetail':
        return 'Job Info';
      default:
        return 'Torrent CLI';
    }
  }, [currentScreen.key]);

  const handleMenuNavigate = (target: 'search' | 'jobs') => {
    clearError();
    setActionError(undefined);
    setInfoMessage(undefined);
    pushScreen({ key: target });
  };

  const handleExit = () => {
    exit();
  };

  const handleJobOpen = (jobId: string) => {
    void downloadService.syncJob(jobId);
    pushScreen({ key: 'jobDetail', jobId });
  };

  const handleSelect = async (result: SearchResult) => {
    if (isStarting) {
      return;
    }

    setIsStarting(true);
    setActionError(undefined);
    try {
      const job = await downloadService.startDownload(result);
      setInfoMessage(`Started download: ${job.label ?? job.btih}`);
      clearError();
      setNavigation({
        history: [
          { key: 'menu' },
          { key: 'jobs' },
          { key: 'jobDetail', jobId: job.jobId }
        ],
        index: 2
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStarting(false);
    }
  };

  const handleRemove = async (jobId: string) => {
    setActionError(undefined);
    try {
      await downloadService.remove(jobId);
      clearError();
      setInfoMessage(`Removed job ${jobId}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setActionError(err.message);
      throw err;
    }
  };

  const handleDeleteAndNavigate = async (jobId: string) => {
    try {
      await handleRemove(jobId);
      setNavigation({
        history: [
          { key: 'menu' },
          { key: 'jobs' }
        ],
        index: 1
      });
    } catch {
      // keep current screen; error already surfaced
    }
  };

  const currentJob =
    currentScreen.key === 'jobDetail' ? jobs.find((job) => job.jobId === currentScreen.jobId) : undefined;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="yellow">Torrent CLI</Text>
        <Text color="gray"> — {screenTitle}</Text>
      </Box>
      <Box>
        {currentScreen.key === 'menu' && (
          <MainMenu
            focus
            onNavigate={handleMenuNavigate}
            onExit={handleExit}
          />
        )}
        {currentScreen.key === 'search' && (
          <Box flexDirection="column" flexGrow={1}>
            <SearchPane onSelect={handleSelect} disabled={!ready || isStarting} />
            <Text color="gray">Press ← to return to menu.</Text>
          </Box>
        )}
        {currentScreen.key === 'jobs' && (
          <JobsScreen
            jobs={jobs}
            focus
            onSelect={handleJobOpen}
          />
        )}
        {currentScreen.key === 'jobDetail' && (
          <JobDetailScreen
            job={currentJob}
            focus
            onBack={goBack}
            onDelete={currentJob ? (jobId) => handleDeleteAndNavigate(jobId) : undefined}
          />
        )}
      </Box>
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

type MainMenuOption = 'search' | 'jobs' | 'exit';

interface MainMenuProps {
  focus: boolean;
  onNavigate: (option: Exclude<MainMenuOption, 'exit'>) => void;
  onExit: () => void;
}

const MainMenu: React.FC<MainMenuProps> = ({ focus, onNavigate, onExit }) => {
  const items: Array<{ label: string; value: MainMenuOption }> = useMemo(
    () => [
      { label: 'Search torrent', value: 'search' },
      { label: 'Jobs', value: 'jobs' },
      { label: 'Exit', value: 'exit' }
    ],
    []
  );

  return (
    <Box flexDirection="column">
      <SelectInput
        isFocused={focus}
        items={items}
        onSelect={(item) => {
          if (item.value === 'exit') {
            onExit();
          } else {
            onNavigate(item.value);
          }
        }}
      />
      <Text color="gray">Use ↑/↓ to choose, Enter to confirm.</Text>
    </Box>
  );
};

interface JobsScreenProps {
  jobs: OwnedJob[];
  focus: boolean;
  onSelect: (jobId: string) => void;
}

const JobsScreen: React.FC<JobsScreenProps> = ({ jobs, focus, onSelect }) => {
  const items = useMemo(
    () =>
      jobs.map((job) => ({
        label: `${job.label ?? job.btih} — ${job.lastKnownStatus}${
          job.progress !== null ? ` (${Math.round(job.progress * 100)}%)` : ''
        }`,
        value: job.jobId
      })),
    [jobs]
  );

  if (jobs.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="gray">No downloads yet.</Text>
        <Text color="gray">Press ← to return to menu.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <SelectInput
        isFocused={focus}
        items={items}
        onSelect={(item) => onSelect(item.value)}
      />
      <Text color="gray">Use ↑/↓ to choose a job, Enter for details.</Text>
      <Text color="gray">Press ← to return to menu.</Text>
    </Box>
  );
};

interface JobDetailScreenProps {
  job: OwnedJob | undefined;
  focus: boolean;
  onBack: () => void;
  onDelete?: (jobId: string) => Promise<void>;
}

const JobDetailScreen: React.FC<JobDetailScreenProps> = ({ job, focus, onBack, onDelete }) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{ status: 'success' | 'error'; message: string } | undefined>();

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }
    const timer = setTimeout(() => {
      setCopyFeedback(undefined);
    }, 3000);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  useInput(
    (input) => {
      if (!job) {
        return;
      }
      if (input.toLowerCase() !== 'c') {
        return;
      }
      const link = job.shortUrl ?? job.s3Url;
      if (!link) {
        setCopyFeedback({ status: 'error', message: 'No download link available yet.' });
        return;
      }
      void (async () => {
        try {
          await clipboard.write(link);
          setCopyFeedback({ status: 'success', message: 'Copied download link to clipboard.' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'clipboard unavailable.';
          setCopyFeedback({ status: 'error', message: `Failed to copy download link: ${message}` });
        }
      })();
    },
    { isActive: focus }
  );

  if (!job) {
    return (
      <Box flexDirection="column">
        <Text color="red">Job not found.</Text>
        <Text color="gray">Press ← to return to jobs.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>{job.label ?? job.btih}</Text>
      <Text>Status: {job.lastKnownStatus}</Text>
      <Text>Job ID: {job.jobId}</Text>
      <Text>BTIH: {job.btih}</Text>
      <Text>
        Progress:{' '}
        {job.lastKnownStatus === 'completed'
          ? '100%'
          : job.progress === null
            ? '—'
            : `${Math.round(job.progress * 100)}%`}
      </Text>
      <Text>
        Size:{' '}
        {typeof job.sizeBytes === 'number'
          ? `${(job.sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
          : 'Unknown'}
      </Text>
      <Text>Download: {job.shortUrl ?? job.s3Url ?? '—'}</Text>
      <Text>Link expires: {job.s3UrlExpiresAt ?? '—'}</Text>
      {copyFeedback && (
        <Text color={copyFeedback.status === 'success' ? 'green' : 'red'}>
          {copyFeedback.message}
        </Text>
      )}
      {job.error && <Text color="red">Error: {job.error}</Text>}
      <Box marginTop={1}>
        <Text color="gray">Actions</Text>
      </Box>
      <SelectInput
        isFocused={focus && !isDeleting}
        items={[
          ...(onDelete
            ? [{ label: 'Delete/Stop job', value: 'delete' as const }]
            : []),
          { label: 'Back', value: 'back' as const }
        ]}
        onSelect={(item) => {
          if (item.value === 'delete' && onDelete) {
            if (isDeleting) {
              return;
            }
            setIsDeleting(true);
            void (async () => {
              try {
                await onDelete(job.jobId);
              } finally {
                setIsDeleting(false);
              }
            })();
          } else if (item.value === 'back') {
            onBack();
          }
        }}
      />
      {isDeleting && <Text color="gray">Deleting…</Text>}
      {(job.shortUrl ?? job.s3Url) && <Text color="gray">Press C to copy the download link.</Text>}
      <Text color="gray">Use ↑/↓ to choose, Enter to confirm.</Text>
      <Text color="gray">Use ← to go back to jobs.</Text>
    </Box>
  );
};
