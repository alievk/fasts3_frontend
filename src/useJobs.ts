import { useEffect, useState } from 'react';
import { StoredJob } from './types.js';
import { useServices } from './serviceContext.js';

interface JobsHookState {
  jobs: StoredJob[];
  ready: boolean;
  lastError?: string;
  clearError: () => void;
}

const updateJobList = (jobs: StoredJob[], updated: StoredJob): StoredJob[] => {
  const next = jobs.filter((job) => job.btih !== updated.btih);
  return [updated, ...next].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const useJobs = (): JobsHookState => {
  const { downloadService, poller } = useServices();
  const [jobs, setJobs] = useState<StoredJob[]>([]);
  const [ready, setReady] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();

  useEffect(() => {
    const handleReady = (initial: StoredJob[]) => {
      setJobs(initial);
      setReady(true);
    };
    const handleUpdate = (job: StoredJob) => {
      setJobs((current) => updateJobList(current, job));
    };
    const handleRemove = (btih: string) => {
      setJobs((current) => current.filter((job) => job.btih !== btih));
    };
    const handleError = (error: Error) => {
      setLastError(error.message);
    };

    downloadService.on('ready', handleReady);
    downloadService.on('jobUpdated', handleUpdate);
    downloadService.on('jobRemoved', handleRemove);
    downloadService.on('error', handleError);

    void (async () => {
      await downloadService.init();
      try {
        await downloadService.checkHealth();
      } catch {
        // `checkHealth` emits the error; continue to allow manual retries.
      }
      await downloadService.syncAll();
      poller.start();
    })();

    return () => {
      poller.stop();
      downloadService.off('ready', handleReady);
      downloadService.off('jobUpdated', handleUpdate);
      downloadService.off('jobRemoved', handleRemove);
      downloadService.off('error', handleError);
    };
  }, [downloadService, poller]);

  return {
    jobs,
    ready,
    lastError,
    clearError: () => setLastError(undefined)
  };
};
