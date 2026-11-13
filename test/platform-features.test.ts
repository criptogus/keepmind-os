import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageManager } from '../src/main/storage/StorageManager.js';
import { MemoryManager } from '../src/main/integrations/MemoryManager.js';
import { presetAvatarFor, parseAvatarDefinition, avatarForAgent, avatarJson, AVATAR_PRESETS } from '../src/shared/avatars.js';
import { costFromUsage, estimateCallCost, pricingForModel } from '../src/shared/models.js';
import { examples } from 'open-bot-avatar';

describe('Agent avatars', () => {
  it('preset assignment is deterministic per seed', () => {
    expect(presetAvatarFor('agent-1').id).toBe(presetAvatarFor('agent-1').id);
    expect(AVATAR_PRESETS.length).toBe(examples.length);
  });

  it('valid stored definition wins over preset', () => {
    const agent = { id: 'x', avatar: avatarJson(AVATAR_PRESETS[2]) };
    expect(avatarForAgent(agent).id).toBe(AVATAR_PRESETS[2].id);
  });

  it('invalid stored JSON falls back to preset', () => {
    expect(avatarForAgent({ id: 'abc', avatar: '{"broken"' })).toBeTruthy();
    expect(avatarForAgent({ id: 'abc', avatar: '{"version":2}' })).toBeTruthy();
  });

  it('parseAvatarDefinition rejects garbage', () => {
    expect(parseAvatarDefinition('not json')).toBeNull();
    expect(parseAvatarDefinition(JSON.stringify({ version: 99 }))).toBeNull();
    expect(parseAvatarDefinition(avatarJson(examples[0]))?.id).toBe(examples[0].id);
  });
});

describe('Model pricing', () => {
  it('prices known models and falls back for unknown', () => {
    const known = pricingForModel('gpt-6.1-sol');
    expect(known.input).toBeGreaterThan(0);
    const unknown = pricingForModel('totally-unknown-model');
    expect(unknown.input).toBeGreaterThan(0); // conservative fallback
  });

  it('costFromUsage scales with tokens', () => {
    const c1 = costFromUsage('gpt-4o', 1_000_000, 0);
    const c2 = costFromUsage('gpt-4o', 500_000, 0);
    expect(c1).toBeCloseTo(c2 * 2, 6);
    expect(costFromUsage('gpt-4o', 0, 0)).toBe(0);
  });

  it('estimateCallCost is positive and bounded', () => {
    const est = estimateCallCost('gpt-4o', 10_000, 2048);
    expect(est).toBeGreaterThan(0);
    expect(est).toBeLessThan(1);
  });
});

describe('Usage ledger + routing decisions', () => {
  let storage: StorageManager;
  beforeEach(() => {
    storage = new StorageManager(fs.mkdtempSync(path.join(os.tmpdir(), 'km-feat-')));
  });

  it('records usage and computes monthly spend per agent', () => {
    const now = new Date().toISOString();
    storage.saveLlmUsage({ agentId: 'a1', model: 'gpt-4o', provider: 'openai', promptTokens: 1000, completionTokens: 500, costUsd: 0.01, partial: false });
    storage.saveLlmUsage({ agentId: 'a1', model: 'gpt-4o', provider: 'openai', promptTokens: 2000, completionTokens: 500, costUsd: 0.02, partial: false });
    storage.saveLlmUsage({ agentId: 'a2', model: 'claude-x', provider: 'anthropic', promptTokens: 100, completionTokens: 50, costUsd: 0.005, partial: false });

    expect(storage.getAgentSpendSince('a1', '2000-01-01')).toBeCloseTo(0.03, 6);
    const monthly = storage.getMonthlySpendByAgent();
    expect(monthly.find((m) => m.agentId === 'a1')?.costUsd).toBeCloseTo(0.03, 6);
    expect(monthly.find((m) => m.agentId === 'a2')?.calls).toBe(1);
    expect(storage.getLlmUsage(10)).toHaveLength(3);
    void now;
  });

  it('routing decisions round-trip with candidates and reason', () => {
    storage.saveRoutingDecision({
      kind: 'skill', agentId: 'a1', subject: 'task about pdf',
      candidates: [{ id: 'pdf-tools', score: 3 }, { id: 'other', score: 0 }],
      decision: ['pdf-tools'], reason: 'heuristic',
    });
    const list = storage.getRoutingDecisions(10);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('skill');
    expect(list[0].candidates[0].id).toBe('pdf-tools');
    expect(list[0].decision).toEqual(['pdf-tools']);
  });
});

describe('MemoryManager', () => {
  let storage: StorageManager;
  let mem: MemoryManager;
  beforeEach(() => {
    storage = new StorageManager(fs.mkdtempSync(path.join(os.tmpdir(), 'km-mem-')));
    mem = new MemoryManager(storage);
  });

  it('stores a memory and recalls it with ids', async () => {
    const res = await mem.remember('deploys happen on railway every friday');
    expect(res).toContain('Remembered');
    const hit = mem.search('railway deploy friday', 5);
    expect(hit.text).toContain('railway');
    expect(hit.ids).toHaveLength(1);
  });

  it('dedupes exact repeats without a judge', async () => {
    await mem.remember('the office wifi password rotation is monthly');
    const res = await mem.remember('the office wifi password rotation is monthly');
    expect(res).toContain('Already known');
    expect(storage.getAllMemoryItems(10)).toHaveLength(1);
  });

  it('judge verdict "updates" supersedes with temporal validity', async () => {
    await mem.remember('we host the application on vercel today');
    mem.setJudge(async () => [{ candidateId: storage.getAllMemoryItems(10)[0].id, action: 'updates', confidence: 0.9 }]);
    await mem.remember('we now host the application on railway instead');
    const items = storage.getAllMemoryItems(10);
    expect(items).toHaveLength(2);
    const old = items.find((i) => i.content.includes('vercel'))!;
    const neu = items.find((i) => i.content.includes('railway'))!;
    expect(old.validUntil).toBeTruthy();
    expect(old.supersededBy).toBe(neu.id);
    // superseded item leaves active recall
    expect(mem.search('vercel hosting', 5).text).not.toContain('vercel');
  });

  it('rejects credential-looking content', async () => {
    const fakeKey = 'sk-' + 'a'.repeat(30); // built dynamically so secret scanners don't flag the fixture
    await expect(mem.remember(`api_key: ${fakeKey}`)).rejects.toThrow(/secret|credential/i);
  });

  it('outcome weighting demotes consistently bad memories', async () => {
    await mem.remember('always check the staging deploy first before production');
    const id = storage.getAllMemoryItems(10)[0].id;
    for (let i = 0; i < 9; i++) mem.recordOutcome([id], false);
    mem.recordOutcome([id], true);
    // force evaluation via a search
    mem.search('staging deploy production', 5);
    const item = storage.getMemoryItem(id)!;
    expect(item.uses).toBe(10);
    expect(item.demoted).toBe(true);
    // demoted items are excluded from recall
    expect(mem.search('staging deploy production', 5).ids).not.toContain(id);
  });

  it('retire removes item from active recall but keeps history', async () => {
    await mem.remember('temporary note about the migration window');
    const id = storage.getAllMemoryItems(10)[0].id;
    expect(mem.retire(id)).toBe(true);
    expect(mem.search('migration window', 5).text).toBe('');
    expect(storage.getAllMemoryItems(10)).toHaveLength(1); // history preserved
  });
});
