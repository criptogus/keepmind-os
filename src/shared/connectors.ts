export type CompatibleProviderKind = 'openrouter' | 'deepseek' | 'hermes' | 'custom';
export interface CompatibleProviderProfile {
  id: string;
  name: string;
  kind: CompatibleProviderKind;
  baseUrl: string;
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  maxOutputTokens: number;
  maxRunUsd: number;
}
export const compatibleModelId = (id: string) => `compatible/${id}`;
export const isCompatibleModel = (model: string) => model.startsWith('compatible/');

export interface CompatibleModelDiscovery {
  models: string[];
  prices: Array<{ model: string; inputUsdPerMillion: number; outputUsdPerMillion: number }>;
  retrievedAt: string;
}
