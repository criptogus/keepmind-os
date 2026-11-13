import OpenAI from 'openai';
import type { CredentialStore } from '../auth/CredentialStore.js';
import type { CompatibleProviderProfile, CompatibleModelDiscovery } from '../../shared/connectors.js';
import { compatibleModelId } from '../../shared/connectors.js';
import type { ModelInfo } from '../../shared/models.js';

interface Settings { getSetting(key: string): string | null | undefined; setSetting(key: string, value: string): void }
const KEY = 'providers.compatible';
export function validateProvider(value: CompatibleProviderProfile): CompatibleProviderProfile {
  if (!value || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id) || !['openrouter', 'deepseek', 'hermes', 'custom'].includes(value.kind)) throw new Error('Invalid provider');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200) throw new Error('Provider name and model required');
  const url = new URL(value.baseUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('Use HTTPS or the local address http://127.0.0.1');
  if (value.kind === 'openrouter' && url.origin !== 'https://openrouter.ai') throw new Error('Invalid OpenRouter endpoint');
  if (value.kind === 'deepseek' && url.origin !== 'https://api.deepseek.com') throw new Error('Invalid DeepSeek endpoint');
  for (const number of [value.inputUsdPerMillion, value.outputUsdPerMillion, value.maxRunUsd]) if (!Number.isFinite(number) || number <= 0) throw new Error('Known positive prices and run budget required');
  if (!Number.isSafeInteger(value.maxOutputTokens) || value.maxOutputTokens < 1 || value.maxOutputTokens > 128_000) throw new Error('Invalid output limit');
  // Construct explicitly so renderer-supplied keys never enter ordinary settings.
  return { id: value.id, name: value.name.trim(), kind: value.kind, baseUrl: url.href.replace(/\/$/, ''), model: value.model.trim(), inputUsdPerMillion: value.inputUsdPerMillion, outputUsdPerMillion: value.outputUsdPerMillion, maxOutputTokens: value.maxOutputTokens, maxRunUsd: value.maxRunUsd };
}
export class CompatibleProviders {
  constructor(private settings: Settings, private secrets: Pick<CredentialStore, 'getSecret' | 'setSecret' | 'clearSecret'>) {}
  list(): CompatibleProviderProfile[] {
    const parsed = JSON.parse(this.settings.getSetting(KEY) || '[]');
    if (!Array.isArray(parsed)) throw new Error('Invalid provider settings');
    return parsed.map(validateProvider);
  }
  save(value: CompatibleProviderProfile, apiKey?: string) {
    const profile = validateProvider(value);
    if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 16_384 || /[\r\n]/.test(apiKey))) throw new Error('Invalid API key');
    const existing = this.list().find(p => p.id === profile.id);
    if (existing && existing.baseUrl !== profile.baseUrl && !apiKey) throw new Error('Re-enter the key when changing endpoint');
    if (apiKey) this.secrets.setSecret(`compatible.${profile.id}`, apiKey);
    const profiles = this.list().filter(p => p.id !== profile.id);
    profiles.push(profile);
    if (profiles.length > 30) throw new Error('Provider limit reached');
    this.settings.setSetting(KEY, JSON.stringify(profiles));
    return profile;
  }
  remove(id: string) {
    this.settings.setSetting(KEY, JSON.stringify(this.list().filter(p => p.id !== id)));
    this.secrets.clearSecret(`compatible.${id}`);
  }
  resolve(modelId: string) {
    const profile = this.list().find(p => compatibleModelId(p.id) === modelId);
    if (!profile) throw new Error('Compatible provider not configured');
    const apiKey = this.secrets.getSecret(`compatible.${profile.id}`);
    if (!apiKey && new URL(profile.baseUrl).hostname !== '127.0.0.1') throw new Error('Provider API key required');
    return { profile, client: new OpenAI({ apiKey: apiKey || 'local', baseURL: profile.baseUrl, maxRetries: 0, timeout: 60_000, fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }) }) };
  }
  async test(id: string): Promise<CompatibleModelDiscovery> {
    const { client, profile } = this.resolve(compatibleModelId(id));
    try {
      const models = await client.models.list({ timeout: 10_000 });
      if (!Array.isArray(models.data)) throw new Error('Invalid model list');
      const prices = profile.kind === 'openrouter' ? models.data.flatMap(model => {
        const pricing = (model as unknown as { pricing?: { prompt?: string; completion?: string } }).pricing;
        const input = Number(pricing?.prompt) * 1_000_000, output = Number(pricing?.completion) * 1_000_000;
        return Number.isFinite(input) && input > 0 && Number.isFinite(output) && output > 0 ? [{ model: model.id, inputUsdPerMillion: input, outputUsdPerMillion: output }] : [];
      }).slice(0, 200) : [];
      return { models: models.data.map(m => m.id).filter(id => typeof id === 'string').slice(0, 200), prices, retrievedAt: new Date().toISOString() };
    } catch { throw new Error(`Could not connect to ${profile.name}. Check the endpoint, key and model access.`); }
  }
  catalog(): ModelInfo[] {
    return this.list().map(p => ({ id: compatibleModelId(p.id), label: `${p.name} · ${p.model}`, provider: 'openai', tier: 'medium', source: 'live' }));
  }
}
