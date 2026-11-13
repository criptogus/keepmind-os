import {
  MODEL_CATALOG,
  DEFAULT_MODEL,
  guessModelTier,
  prettifyModelId,
  providerForModel,
  type ModelInfo,
  type ModelProvider,
  type ModelCatalogResponse,
} from '../../shared/models.js';

/**
 * Live model catalog: fetches the model lists each provider exposes and merges
 * them with the bundled fallback catalog. Results are cached in settings so
 * the UI and the router see new models without an app update.
 */

const CACHE_KEY = 'models.catalog';
const CACHE_AT_KEY = 'models.catalogAt';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh at most once a day

export interface ProviderCredentials {
  apiKey?: string;
  oauthToken?: string;
  oauthBetaHeader?: string;
}

interface SettingsStore {
  getSetting(key: string): string | null | undefined;
  setSetting(key: string, value: string): void;
}

// Non-chat OpenAI model families that show up in /v1/models.
const OPENAI_EXCLUDE =
  /embedding|dall-e|tts|whisper|moderation|sora|realtime|audio|transcribe|image|search-|davinci|babbage|instruct|computer-use|codex-mini/i;

function isChatModelId(id: string): boolean {
  return /^(gpt-|o\d|chatgpt-)/.test(id) && !OPENAI_EXCLUDE.test(id);
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenAI models endpoint returned ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return (data.data || [])
    .map((x) => x.id)
    .filter(isChatModelId)
    .map((id) => ({
      id,
      label: prettifyModelId(id),
      provider: 'openai' as const,
      tier: guessModelTier(id),
      source: 'live' as const,
    }));
}

async function fetchAnthropicModels(creds: ProviderCredentials): Promise<ModelInfo[]> {
  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
  };
  if (creds.apiKey) {
    headers['x-api-key'] = creds.apiKey;
  } else if (creds.oauthToken) {
    headers['Authorization'] = `Bearer ${creds.oauthToken}`;
    if (creds.oauthBetaHeader) headers['anthropic-beta'] = creds.oauthBetaHeader;
  } else {
    throw new Error('No Anthropic credentials');
  }

  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Anthropic models endpoint returned ${res.status}`);
  const data = (await res.json()) as {
    data?: Array<{ id: string; display_name?: string }>;
  };
  return (data.data || [])
    .map((x) => x.id)
    .filter((id) => id.startsWith('claude-'))
    .map((id, i) => ({
      id,
      label: prettifyModelId(id),
      provider: 'anthropic' as const,
      tier: guessModelTier(id),
      source: 'live' as const,
    }));
}

const TIER_RANK = { flagship: 3, complex: 2, medium: 1, simple: 0 } as const;

/** Merge bundled + live lists; live wins on id conflicts, keeps known tiers. */
export function mergeCatalog(live: ModelInfo[]): ModelInfo[] {
  const byId = new Map<string, ModelInfo>();
  for (const x of MODEL_CATALOG) byId.set(x.id, x);
  for (const x of live) {
    const existing = byId.get(x.id);
    // Bundled tiers are curated — keep them when a live entry matches a known id.
    byId.set(x.id, existing ? { ...x, tier: existing.tier } : x);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return TIER_RANK[b.tier] - TIER_RANK[a.tier] || a.label.localeCompare(b.label);
  });
}

export function getCachedCatalog(storage: SettingsStore): ModelCatalogResponse {
  const raw = storage.getSetting(CACHE_KEY);
  const at = storage.getSetting(CACHE_AT_KEY) || null;
  if (!raw) {
    return { models: mergeCatalog([]), updatedAt: at, liveProviders: [] };
  }
  try {
    const cached = JSON.parse(raw) as { models?: ModelInfo[]; providers?: ModelProvider[] };
    const live = Array.isArray(cached.models) ? cached.models : [];
    return {
      models: mergeCatalog(live),
      updatedAt: at,
      liveProviders: cached.providers || [],
    };
  } catch {
    return { models: mergeCatalog([]), updatedAt: at, liveProviders: [] };
  }
}

export function isCacheFresh(storage: SettingsStore): boolean {
  const at = storage.getSetting(CACHE_AT_KEY);
  if (!at) return false;
  const ts = Date.parse(at);
  return Number.isFinite(ts) && Date.now() - ts < CACHE_TTL_MS;
}

/**
 * Fetches live model lists for every provider that has credentials.
 * Providers without credentials keep their bundled entries. Never throws —
 * per-provider failures are swallowed and reported via `errors`.
 */
export async function refreshModelCatalog(
  storage: SettingsStore,
  creds: { openai?: ProviderCredentials; anthropic?: ProviderCredentials }
): Promise<ModelCatalogResponse & { errors: Partial<Record<ModelProvider, string>> }> {
  const errors: Partial<Record<ModelProvider, string>> = {};
  const live: ModelInfo[] = [];
  const liveProviders: ModelProvider[] = [];

  if (creds.openai?.apiKey) {
    try {
      live.push(...(await fetchOpenAIModels(creds.openai.apiKey)));
      liveProviders.push('openai');
    } catch (e) {
      errors.openai = e instanceof Error ? e.message : String(e);
    }
  }

  if (creds.anthropic && (creds.anthropic.apiKey || creds.anthropic.oauthToken)) {
    try {
      live.push(...(await fetchAnthropicModels(creds.anthropic)));
      liveProviders.push('anthropic');
    } catch (e) {
      errors.anthropic = e instanceof Error ? e.message : String(e);
    }
  }

  // Keep previously cached live models for providers we couldn't refresh now.
  const prev = getCachedCatalog(storage);
  const refreshed = new Set(liveProviders);
  const carried = prev.models.filter(
    (x) => x.source === 'live' && !refreshed.has(x.provider)
  );

  const allLive = [...live, ...carried];
  const updatedAt = liveProviders.length > 0 ? new Date().toISOString() : prev.updatedAt;
  storage.setSetting(CACHE_KEY, JSON.stringify({ models: allLive, providers: [...refreshed, ...prev.liveProviders.filter((p) => !refreshed.has(p))] }));
  storage.setSetting(CACHE_AT_KEY, updatedAt || '');

  return { models: mergeCatalog(allLive), updatedAt, liveProviders: [...new Set([...liveProviders, ...prev.liveProviders])], errors };
}

/** Ids the router should treat as valid (bundled + cached live). */
export function knownModelIds(storage: SettingsStore): Set<string> {
  return new Set(getCachedCatalog(storage).models.map((x) => x.id));
}

export function defaultModelFor(provider: ModelProvider): string {
  return DEFAULT_MODEL[provider];
}
