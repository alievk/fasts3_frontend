import React, { createContext, useContext, useMemo } from 'react';
import { loadConfig } from './config.js';
import { createApiClient } from './apiClient.js';
import { JobStore } from './jobStore.js';
import { DownloadService } from './downloadService.js';
import { Poller } from './poller.js';
import { Config } from './types.js';
import { createSearchPipeline } from './searchPipeline.js';

interface ServiceContextValue {
  config: Config;
  downloadService: DownloadService;
  poller: Poller;
}

const ServiceContext = createContext<ServiceContextValue | undefined>(undefined);

export const ServiceProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const config = useMemo(() => loadConfig(), []);
  const searchPipeline = useMemo(() => createSearchPipeline(config), [config]);

  const downloadService = useMemo(() => {
    const apiClient = createApiClient();
    const jobStore = new JobStore(config.statePath);
    return new DownloadService(apiClient, jobStore, config.searchLimit, searchPipeline);
  }, [config.statePath, config.searchLimit, searchPipeline]);
  const poller = useMemo(() => new Poller(downloadService, config.pollingIntervalMs), [downloadService, config.pollingIntervalMs]);

  return <ServiceContext.Provider value={{ config, downloadService, poller }}>{children}</ServiceContext.Provider>;
};

export const useServices = (): ServiceContextValue => {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error('useServices must be used within ServiceProvider');
  }
  return context;
};
