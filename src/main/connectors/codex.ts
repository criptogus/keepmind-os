import type { ProviderConnector } from './port';
import { detectCli } from './cli';
export const codex: ProviderConnector = { id: 'codex', baseUrl: 'https://api.openai.com/v1', models: async () => [], detect: () => detectCli('codex') };
