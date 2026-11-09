import type { ProviderConnector } from './port';
export const HERMES_DEFAULT_BASE_URL = 'http://127.0.0.1:8642/v1';
export const hermes: ProviderConnector = { id: 'hermes', baseUrl: HERMES_DEFAULT_BASE_URL, models: async () => [], detect: async () => ({ installed: true, loggedIn: false }) };
