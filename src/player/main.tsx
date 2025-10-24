import React from 'react';
import { createRoot } from 'react-dom/client';
import { PlayerApp } from './PlayerApp.js';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing root element');
}

const root = createRoot(rootElement);
root.render(<PlayerApp />);
