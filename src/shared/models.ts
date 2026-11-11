/**
 * Single source of truth for the LLM model catalog.
 *
 * MODEL_CATALOG is the bundled fallback — kept current manually. At runtime the
 * main process merges it with live model lists fetched from each provider's
 * /models endpoint (see src/main/integrations/ModelCatalog.ts), so newly
 * released models appear without an app update.
 */

export type ModelProvider = 'openai' | 'anthropic';
export type ModelTier = 'simple' | 'medium' | 'complex' | 'flagship';
export type TaskTier = 'simple' | 'medium' | 'complex';

export interface ModelInfo {
  id: string;
  label: string;
  provider: ModelProvider;
  tier: ModelTier;
  /** 'live' = returned by the provider API, 'bundled' = shipped fallback. */
  source?: 'bundled' | 'live';
}

export interface ModelCatalogResponse {
  models: ModelInfo[];
  updatedAt: string | null;
  liveProviders: ModelProvider[];
}

// ---------------------------------------------------------------------------
// Bundled catalog (fallback + labels/tiers for known models)
// ---------------------------------------------------------------------------

const m = (
  id: string,
  label: string,
  provider: ModelProvider,
  tier: ModelTier
): ModelInfo => ({ id, label, provider, tier, source: 'bundled' });

export const MODEL_CATALOG: ModelInfo[] = [
  // OpenAI — current lineup (GPT-6 / GPT-6.1 / GPT-5.6 tiers + Codex)
  m('gpt-6-astra', 'GPT-6 Astra', 'openai', 'flagship'),
  m('gpt-6.1-sol', 'GPT-6.1 Sol', 'openai', 'complex'),
  m('gpt-6.1-terra', 'GPT-6.1 Terra', 'openai', 'medium'),
  m('gpt-6.1-luna', 'GPT-6.1 Luna', 'openai', 'simple'),
  m('gpt-5.6-sol', 'GPT-5.6 Sol', 'openai', 'complex'),
  m('gpt-5.6-terra', 'GPT-5.6 Terra', 'openai', 'medium'),
  m('gpt-5.6-luna', 'GPT-5.6 Luna', 'openai', 'simple'),
  m('gpt-5.3-codex', 'GPT-5.3 Codex', 'openai', 'complex'),
  m('gpt-5.2-codex', 'GPT-5.2 Codex', 'openai', 'medium'),
  m('gpt-5.1-codex', 'GPT-5.1 Codex', 'openai', 'medium'),

  // Anthropic — current lineup
  m('claude-fable-5-2', 'Claude Fable 5.2', 'anthropic', 'flagship'),
  m('claude-opus-5-5', 'Claude Opus 5.5', 'anthropic', 'complex'),
  m('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'anthropic', 'medium'),
  m('claude-haiku-5-5', 'Claude Haiku 5.5', 'anthropic', 'simple'),
  m('claude-opus-4-8', 'Claude Opus 4.8', 'anthropic', 'complex'),
  m('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'anthropic', 'medium'),
];

export const DEFAULT_MODEL: Record<ModelProvider, string> = {
  openai: 'gpt-6.1-terra',
  anthropic: 'claude-sonnet-5-5',
};

// Codex-subscription OAuth path only serves codex-line models.
export const CODEX_DEFAULT_MODEL = 'gpt-6.1-sol';

// ---------------------------------------------------------------------------
// Provider / tier detection
// ---------------------------------------------------------------------------

export function providerForModel(model: string): ModelProvider | null {
  const id = model.toLowerCase();
  if (id.startsWith('claude-')) return 'anthropic';
  if (id.startsWith('gpt-') || /^o\d/.test(id) || id.startsWith('chatgpt-')) return 'openai';
  return null;
}

/** 'codex' models route through the ChatGPT-subscription backend. */
export function isCodexModel(model: string): boolean {
  return model.toLowerCase().includes('codex');
}

const TIER_ORDER: ModelTier[] = ['simple', 'medium', 'complex', 'flagship'];

/** Best-effort tier guess for models not present in MODEL_CATALOG (live fetch). */
export function guessModelTier(id: string): ModelTier {
  const s = id.toLowerCase();
  if (/fable|mythos|astra|ultra|pro-max/.test(s)) return 'flagship';
  if (/haiku|luna|mini|nano/.test(s)) return 'simple';
  if (/sonnet|terra/.test(s)) return 'medium';
  if (/opus|sol|codex/.test(s)) return 'complex';
  return 'medium';
}

export function tierForModel(model: string): ModelTier | null {
  const known = MODEL_CATALOG.find((x) => x.id === model);
  return known ? known.tier : guessModelTier(model);
}

// ---------------------------------------------------------------------------
// Task classifier + router
// ---------------------------------------------------------------------------

const COMPLEX_KEYWORDS = ['analyz', 'architect', 'debug', 'refactor', 'optimi', 'secur', 'complex', 'design', 'strateg', 'plan', 'code', 'implement', 'migrat'];
const SIMPLE_RE = /\b(hi|hello|ok|yes|no|thanks|status|list)\b/i;

export function classifyTask(inputText: string): TaskTier {
  const text = inputText.toLowerCase();
  const complexHits = COMPLEX_KEYWORDS.filter((k) => text.includes(k)).length;
  let score = Math.min(3, Math.floor(text.length / 800));
  score += complexHits >= 2 ? 3 : complexHits === 1 ? 2 : 0;
  if (SIMPLE_RE.test(text) && text.length < 200) score -= 1;
  if (score >= 3) return 'complex';
  return score < 0 ? 'simple' : 'medium';
}

const TIER_DEFAULT: Record<ModelProvider, Record<TaskTier, string>> = {
  openai: {
    simple: 'gpt-6.1-luna',
    medium: 'gpt-6.1-terra',
    complex: 'gpt-6.1-sol',
  },
  anthropic: {
    simple: 'claude-haiku-5-5',
    medium: 'claude-sonnet-5-5',
    complex: 'claude-opus-5-5',
  },
};

const CODEX_TIER_DEFAULT: Record<TaskTier, string> = {
  simple: 'gpt-5.1-codex',
  medium: 'gpt-5.2-codex',
  complex: 'gpt-5.3-codex',
};

/**
 * Picks the cheapest adequate model within the same provider family.
 * - Keeps the configured model when it already sits in the target tier and is
 *   a known model (bundled catalog or live-fetched list — pass `knownIds`).
 * - Upgrades deprecated/unknown models to the current default for the tier.
 * - Codex models stay inside the codex family (ChatGPT-subscription backend).
 */
export function routeModelForTask(model: string, inputText: string, knownIds?: Set<string>): string {
  // Reasoning-series models (o1/o3/o4…) have a different API shape — never reroute them.
  if (/^o\d/.test(model)) return model;
  const provider = providerForModel(model);
  if (!provider) return model;

  const tier = classifyTask(inputText);
  const target = isCodexModel(model)
    ? CODEX_TIER_DEFAULT[tier]
    : TIER_DEFAULT[provider][tier];

  const isKnown = knownIds
    ? knownIds.has(model)
    : MODEL_CATALOG.some((x) => x.id === model);
  if (isKnown && tierForModel(model) === tierForModel(target)) {
    return model;
  }
  return target;
}

// ---------------------------------------------------------------------------
// Catalog helpers (used by main + renderer)
// ---------------------------------------------------------------------------

export function modelsForProvider(models: ModelInfo[], provider: ModelProvider): ModelInfo[] {
  const order = (t: ModelTier) => TIER_ORDER.indexOf(t);
  return models
    .filter((x) => x.provider === provider)
    .sort((a, b) => order(b.tier) - order(a.tier) || a.label.localeCompare(b.label));
}

/** Prettify a raw provider model id into a display label. */
export function prettifyModelId(id: string): string {
  return id
    .replace(/^(gpt|claude|o|chatgpt)-?/i, (p) => p.toUpperCase())
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
