import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StorageManager } from '../src/main/storage/StorageManager';
import { MemoryManager } from '../src/main/integrations/MemoryManager';

it('recovers unfinished executions and retains failures for inspection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-recovery-')); const storage = new StorageManager(dir);
  try {
    storage.saveAgentExecution({ id: 'unfinished', agentId: 'a', status: 'running', progress: 20, input: {} });
    storage.recoverInterruptedExecutions();
    expect(storage.getAgentExecution('unfinished')?.status).toBe('failed');
    expect(storage.getAgentExecution('unfinished')?.error).toContain('Review external effects');
  } finally { storage.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
it('recalls important memories older than the most recent 500 items with provenance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-recall-')); const storage = new StorageManager(dir);
  try {
    for (let i = 0; i < 510; i++) storage.saveMemoryItem({ id: `m${i}`, kind: 'fact', content: i === 0 ? 'The project codename is iguana' : `Other information ${i}`, validFrom: '2020-01-01', uses: 0, good: 0, bad: 0, createdAt: '2020-01-01', updatedAt: new Date(2020,0,1,0,i).toISOString() });
    const result = new MemoryManager(storage).search('iguana');
    expect(result.ids).toContain('m0'); expect(result.text).toContain('[memory:m0;');
  } finally { storage.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

it('finds a semantic match without keyword overlap and falls back when embeddings fail', async () => {
  const { HybridMemory } = await import('../src/main/integrations/HybridMemory');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-hybrid-')); const storage = new StorageManager(dir);
  try {
    storage.saveMemoryItem({ id: 'car', kind: 'fact', content: 'automobile repair', validFrom: '2020', uses: 0, good: 0, bad: 0, createdAt: '2020', updatedAt: '2020' });
    const hybrid = new HybridMemory(storage, new MemoryManager(storage));
    const result = await hybrid.search('vehicle maintenance',5, async texts => texts.map(() => [1,0]));
    expect(result.ids).toContain('car'); expect(result.mode).toBe('hybrid');
    const fallback = await hybrid.search('automobile',5, async () => { throw new Error('offline'); });
    expect(fallback.ids).toContain('car'); expect(fallback.mode).toBe('lexical-fallback');
  } finally { storage.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
