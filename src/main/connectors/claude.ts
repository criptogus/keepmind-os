import type { ProviderConnector } from './port';
import { detectCli } from './cli';
export const claude: ProviderConnector = { id: 'claude', baseUrl: 'https://api.anthropic.com/v1', models: async () => [], detect: () => detectCli('claude') };
