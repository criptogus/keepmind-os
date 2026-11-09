import type { ProviderConnector } from './port';
export const custom: ProviderConnector = { id: 'custom', models: async () => [], detect: async () => ({ installed: true, loggedIn: false }) };
