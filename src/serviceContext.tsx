import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { loadConfig } from './config.js';
import { createApiClient } from './apiClient.js';
import { DownloadService } from './downloadService.js';
import { Poller } from './poller.js';
import { createSearchPipeline } from './searchPipeline.js';
import { createChatRegistry } from './chatRegistry.js';
import { Config } from './types.js';
const ADMIN_TELEGRAM_ID = 'admin-cli';

interface ServiceContextValue {
  config: Config;
  downloadService: DownloadService;
  poller: Poller;
}

const ServiceContext = createContext<ServiceContextValue | undefined>(undefined);

export const ServiceProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const config = useMemo(() => loadConfig(), []);
  const searchPipeline = useMemo(() => createSearchPipeline(config), [config]);
  const chatRegistry = useMemo(() => createChatRegistry(config), [config]);

  const downloadService = useMemo(() => {
    const apiClient = createApiClient();
    return new DownloadService(apiClient, chatRegistry, config.searchLimit, searchPipeline, ADMIN_TELEGRAM_ID);
  }, [chatRegistry, config.searchLimit, searchPipeline]);
  const poller = useMemo(() => new Poller(downloadService, config.pollingIntervalMs), [downloadService, config.pollingIntervalMs]);

  useEffect(() => {
    void chatRegistry.registerChat(ADMIN_TELEGRAM_ID);
  }, [chatRegistry]);

  return <ServiceContext.Provider value={{ config, downloadService, poller }}>{children}</ServiceContext.Provider>;
};

export const useServices = (): ServiceContextValue => {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error('useServices must be used within ServiceProvider');
  }
  return context;
};
