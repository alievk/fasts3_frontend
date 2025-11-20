import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { loadConfig } from './config.js';
import { createApiClient } from './apiClient.js';
import { DownloadService } from './downloadService.js';
import { Poller } from './poller.js';
import { createSearchPipeline } from './searchPipeline.js';
import { createClientRegistry } from './clientRegistry.js';
import { Config } from './types.js';
const ADMIN_CLIENT_ID = 'admin-cli';

interface ServiceContextValue {
  config: Config;
  downloadService: DownloadService;
  poller: Poller;
}

const ServiceContext = createContext<ServiceContextValue | undefined>(undefined);

export const ServiceProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const config = useMemo(() => loadConfig(), []);
  const searchPipeline = useMemo(() => createSearchPipeline(config), [config]);
  const clientRegistry = useMemo(() => createClientRegistry(config), [config]);

  const downloadService = useMemo(() => {
    const apiClient = createApiClient();
    return new DownloadService(apiClient, clientRegistry, config.searchLimit, searchPipeline, ADMIN_CLIENT_ID);
  }, [clientRegistry, config.searchLimit, searchPipeline]);
  const poller = useMemo(() => new Poller(downloadService, config.pollingIntervalMs), [downloadService, config.pollingIntervalMs]);

  useEffect(() => {
    void clientRegistry.registerClient(ADMIN_CLIENT_ID, { type: 'cli' });
  }, [clientRegistry]);

  return <ServiceContext.Provider value={{ config, downloadService, poller }}>{children}</ServiceContext.Provider>;
};

export const useServices = (): ServiceContextValue => {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error('useServices must be used within ServiceProvider');
  }
  return context;
};
