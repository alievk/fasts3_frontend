#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { ServiceProvider } from './serviceContext.js';

render(
  <ServiceProvider>
    <App />
  </ServiceProvider>
);
