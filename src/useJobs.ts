import { useEffect, useState } from 'react';
import { OwnedJob } from './types.js';
import { useServices } from './serviceContext.js';

interface JobsHookState {
  jobs: OwnedJob[];
  ready: boolean;
  lastError?: string;
  clearError: () => void;
}

const updateJobList = (jobs: OwnedJob[], updated: OwnedJob): OwnedJob[] => {
  const next = jobs.filter((job) => job.jobId !== updated.jobId);
  return [updated, ...next].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const useJobs = (): JobsHookState => {
  const { downloadService, poller } = useServices();
  const [jobs, setJobs] = useState<OwnedJob[]>([]);
  const [ready, setReady] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();

  useEffect(() => {
    const handleReady = (initial: OwnedJob[]) => {
      setJobs(initial);
      setReady(true);
    };
    const handleUpdate = (job: OwnedJob) => {
      setJobs((current) => updateJobList(current, job));
    };
    const handleRemove = (job: OwnedJob) => {
      setJobs((current) => current.filter((item) => item.jobId !== job.jobId));
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
