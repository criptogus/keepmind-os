import { describe, it, expect } from 'vitest';
import {
  MODEL_CATALOG,
  DEFAULT_MODEL,
  providerForModel,
  isCodexModel,
  classifyTask,
  routeModelForTask,
  tierForModel,
  guessModelTier,
  modelsForProvider,
} from '../src/shared/models.js';
import { mergeCatalog, getCachedCatalog, knownModelIds } from '../src/main/integrations/ModelCatalog.js';
import type { ModelInfo } from '../src/shared/models.js';

const knownIds = () => new Set(MODEL_CATALOG.map((x) => x.id));

describe('model catalog', () => {
  it('has unique ids and valid providers', () => {
    const ids = MODEL_CATALOG.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of MODEL_CATALOG) {
      expect(['openai', 'anthropic']).toContain(x.provider);
      expect(['simple', 'medium', 'complex', 'flagship']).toContain(x.tier);
    }
  });

  it('detects providers', () => {
    expect(providerForModel('gpt-6.1-terra')).toBe('openai');
    expect(providerForModel('o4-mini')).toBe('openai');
    expect(providerForModel('claude-sonnet-5-5')).toBe('anthropic');
    expect(providerForModel('llama-3')).toBeNull();
    expect(isCodexModel('gpt-5.1-codex')).toBe(true);
    expect(isCodexModel('gpt-6.1-terra')).toBe(false);
  });

  it('guesses tiers for unknown/live models', () => {
    expect(guessModelTier('gpt-9-nano')).toBe('simple');
    expect(guessModelTier('claude-haiku-9-9')).toBe('simple');
    expect(guessModelTier('gpt-9.9-sol')).toBe('complex');
    expect(guessModelTier('claude-fable-9-9')).toBe('flagship');
    expect(guessModelTier('gpt-9.9-terra')).toBe('medium');
  });
});

describe('classifyTask', () => {
  it('classifies simple tasks', () => {
    expect(classifyTask('hi')).toBe('simple');
    expect(classifyTask('what is the status?')).toBe('simple');
  });

  it('classifies complex tasks', () => {
    expect(classifyTask('please refactor this architecture and debug the implementation plan')).toBe('complex');
  });

  it('defaults to medium for ambiguous input', () => {
    expect(classifyTask('summarize this paragraph of moderate length text that goes on for a bit without hitting any keyword')).toBe('medium');
  });
});

describe('routeModelForTask', () => {
  it('routes simple tasks to cheap models within the provider', () => {
    expect(routeModelForTask('gpt-6-astra', 'hi', knownIds())).toBe('gpt-6.1-luna');
    expect(routeModelForTask('claude-opus-5-5', 'hi', knownIds())).toBe('claude-haiku-5-5');
  });

  it('routes complex tasks to strong models', () => {
    expect(routeModelForTask('gpt-6.1-luna', 'analyze and refactor this codebase architecture', knownIds())).toBe('gpt-6.1-sol');
    expect(routeModelForTask('claude-haiku-5-5', 'debug this complex security architecture', knownIds())).toBe('claude-opus-5-5');
  });

  it('keeps a model already in the target tier', () => {
    expect(routeModelForTask('gpt-6.1-terra', 'what is the weather like today in detail', knownIds())).toBe('gpt-6.1-terra');
  });

  it('upgrades deprecated models to current defaults', () => {
    expect(routeModelForTask('gpt-4', 'analyze this complex system design', knownIds())).toBe('gpt-6.1-sol');
    expect(routeModelForTask('claude-3-sonnet-20240229', 'hi', knownIds())).toBe('claude-haiku-5-5');
  });

  it('keeps live-fetched models when they match the tier', () => {
    const liveIds = new Set([...knownIds(), 'gpt-7-nova']);
    expect(routeModelForTask('gpt-7-nova', 'what is the weather like today in detail', liveIds)).toBe('gpt-7-nova');
  });

  it('never reroutes o-series reasoning models', () => {
    expect(routeModelForTask('o4-mini', 'hi', knownIds())).toBe('o4-mini');
  });

  it('keeps codex models inside the codex family', () => {
    const result = routeModelForTask('gpt-5.1-codex', 'hi', knownIds());
    expect(result).toContain('codex');
  });

  it('returns unknown-provider models unchanged', () => {
    expect(routeModelForTask('llama-3-70b', 'hi', knownIds())).toBe('llama-3-70b');
  });
});

describe('ModelCatalog merge', () => {
  const live: ModelInfo[] = [
    { id: 'gpt-6.1-terra', label: 'Live Terra', provider: 'openai', tier: 'simple', source: 'live' },
    { id: 'gpt-9-ultra', label: 'GPT-9 Ultra', provider: 'openai', tier: 'flagship', source: 'live' },
    { id: 'claude-opus-5-5', label: 'Live Opus', provider: 'anthropic', tier: 'simple', source: 'live' },
  ];

  it('merges live models with bundled catalog', () => {
    const merged = mergeCatalog(live);
    expect(merged.find((x) => x.id === 'gpt-9-ultra')?.source).toBe('live');
    expect(merged.find((x) => x.id === 'gpt-6-astra')).toBeTruthy();
  });

  it('keeps curated bundled tiers for known ids', () => {
    const merged = mergeCatalog(live);
    // Live fetch guessed 'simple' for opus, but bundled tier is 'complex'.
    expect(merged.find((x) => x.id === 'claude-opus-5-5')?.tier).toBe('complex');
    expect(merged.find((x) => x.id === 'gpt-6.1-terra')?.tier).toBe('medium');
  });

  it('reads cached catalog and known ids from settings', () => {
    const store = new Map<string, string>([
      ['models.catalog', JSON.stringify({ models: live, providers: ['openai'] })],
      ['models.catalogAt', new Date().toISOString()],
    ]);
    const settings = {
      getSetting: (k: string) => store.get(k),
      setSetting: (k: string, v: string) => store.set(k, v),
    };
    const cat = getCachedCatalog(settings);
    expect(cat.liveProviders).toContain('openai');
    expect(cat.updatedAt).toBeTruthy();
    expect(knownModelIds(settings).has('gpt-9-ultra')).toBe(true);
  });

  it('falls back to bundled catalog with no cache', () => {
    const settings = { getSetting: () => undefined, setSetting: () => {} };
    const cat = getCachedCatalog(settings);
    expect(cat.models.length).toBe(MODEL_CATALOG.length);
    expect(cat.updatedAt).toBeNull();
  });
});

describe('defaults', () => {
  it('default models exist in the catalog', () => {
    for (const id of Object.values(DEFAULT_MODEL)) {
      expect(MODEL_CATALOG.some((x) => x.id === id)).toBe(true);
    }
  });

  it('modelsForProvider groups correctly', () => {
    const openai = modelsForProvider(MODEL_CATALOG, 'openai');
    const anthropic = modelsForProvider(MODEL_CATALOG, 'anthropic');
    expect(openai.every((x) => x.provider === 'openai')).toBe(true);
    expect(anthropic.every((x) => x.provider === 'anthropic')).toBe(true);
    expect(openai.length + anthropic.length).toBe(MODEL_CATALOG.length);
  });
});
