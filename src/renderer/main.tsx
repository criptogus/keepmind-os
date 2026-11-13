import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import App from './App';
import { LangProvider } from './lib/i18n';
import './index.css';
import { theme } from './lib/theme';
import { useThemeStore } from './store/themeStore';

// Persistence is owned by themeStore; Mantine owns auto/system resolution.
const colorSchemeManager = { get: () => 'auto' as const, set: () => {}, subscribe: () => {}, unsubscribe: () => {}, clear: () => {} };

function ThemedApp() {
  const colorScheme = useThemeStore(state => state.theme);
  return <MantineProvider theme={theme} forceColorScheme={colorScheme === 'auto' ? undefined : colorScheme} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager}><LangProvider><App /></LangProvider></MantineProvider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemedApp />
  </React.StrictMode>
);
