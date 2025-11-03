import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { StoredJob } from './types.js';

interface JobTrackerProps {
  jobs: StoredJob[];
  onRemove: (jobId: string) => void;
  disabled?: boolean;
}

const formatProgress = (progress: number | null, status: string): string => {
  if (status === 'completed') {
    return '100%';
  }
  if (progress === null) {
    return '—';
  }
  return `${Math.round(progress * 100)}%`;
};

export const JobTracker: React.FC<JobTrackerProps> = ({ jobs, onRemove, disabled = false }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (selectedIndex >= jobs.length) {
      setSelectedIndex(Math.max(0, jobs.length - 1));
    }
  }, [jobs, selectedIndex]);

  useInput(
    (input: string, key: Key) => {
      if (disabled || jobs.length === 0) {
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((index) => Math.min(jobs.length - 1, index + 1));
      } else if (key.upArrow) {
        setSelectedIndex((index) => Math.max(0, index - 1));
      } else if (input === 'd' || input === 'D') {
        const job = jobs[selectedIndex];
        if (job) {
          onRemove(job.jobId);
        }
      }
    },
    { isActive: !disabled }
  );

  if (jobs.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="gray">No downloads yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan">Downloads</Text>
      {jobs.map((job, index) => {
        const isSelected = index === selectedIndex && !disabled;
        const status = job.lastKnownStatus;
        const progress = formatProgress(job.progress, status);
        const line = `${status.padEnd(11)} ${progress.padEnd(5)} ${job.label ?? job.btih}`;
        const link = job.shortUrl ?? job.s3Url;
        return (
          <Text key={job.jobId} color={isSelected ? 'green' : undefined}>
            {isSelected ? '➤ ' : '  '}
            {line}
            {link ? ` → ${link}` : ''}
          </Text>
        );
      })}
      <Text color="gray">Use ↑/↓ to navigate, press D to delete selected job.</Text>
    </Box>
  );
};
