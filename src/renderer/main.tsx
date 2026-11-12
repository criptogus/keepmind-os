import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import App from './App';
import { LangProvider } from './lib/i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={{ primaryColor: 'dark' }}>
      <LangProvider>
        <App />
      </LangProvider>
    </MantineProvider>
  </React.StrictMode>
);
