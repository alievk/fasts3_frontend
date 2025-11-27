import React, { createContext, useContext, useMemo } from 'react';
import { loadConfig } from './config.js';
import { Config } from './types.js';

interface ServiceContextValue {
  config: Config;
}

const ServiceContext = createContext<ServiceContextValue | undefined>(undefined);

export const ServiceProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const config = useMemo(() => loadConfig(), []);
  return <ServiceContext.Provider value={{ config }}>{children}</ServiceContext.Provider>;
};

export const useServices = (): ServiceContextValue => {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error('useServices must be used within ServiceProvider');
  }
  return context;
};
