import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StorageManager } from '../src/main/storage/StorageManager.js';
import { GranolaManager } from '../src/main/integrations/GranolaManager.js';
import { importSkillsFromFolder } from '../src/main/integrations/SkillImporter.js';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, shell: { openExternal: vi.fn() } }));
const dirs: string[] = [];
async function temp() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'km-pr10-')); dirs.push(dir); return dir; }
afterEach(async () => { vi.useRealTimers(); await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

describe('integration review regressions', () => {
  it('imports only manifest-declared markdown and rejects traversal atomically', async () => {
    const dir = await temp();
    await fs.writeFile(path.join(dir, 'research.md'), '# Research\nRead sources.');
    await fs.writeFile(path.join(dir, 'SKILL.md'), '# Unlisted\nIgnore.');
    const manifest = { name: 'Pack', version: '1.0', description: 'Research', skills: [{ file: 'research.md' }] };
    await fs.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest));
    const result = await importSkillsFromFolder(dir);
    expect(result.skills.map(s => s.name)).toEqual(['Research']);
    manifest.skills.push({ file: '../outside.md' });
    await fs.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest));
    await expect(importSkillsFromFolder(dir)).rejects.toThrow('path');
  });

  it('counts executions once, excluding simulations, other agents and unrelated tasks', async () => {
    const storage = new StorageManager(await temp());
    const input = { task: 'Prepare customer proposal' };
    for (const [id, agentId, dryRun, task] of [
      ['real', 'a', false, input.task], ['simulation', 'a', true, input.task],
      ['other-agent', 'b', false, input.task], ['unrelated', 'a', false, 'Summarize financial accounts'],
    ] as const) {
      storage.saveAgentExecution({ id, agentId, dryRun, input: { task }, activatedSkillIds: ['writing'], status: 'completed', progress: 100 });
      for (let i = 0; i < 4; i++) storage.saveLlmUsage({ agentId, executionId: id, model: 'gpt-4o', provider: 'openai', promptTokens: 10, completionTokens: 10, costUsd: 0.01 });
    }
    const simulation = storage.getAgentExecution('simulation')!;
    expect(simulation.dryRun).toBe(true);
    expect(simulation.activatedSkillIds).toEqual(['writing']);
    storage.saveAgentExecution({ ...simulation, status: 'failed' });
    expect(storage.getOutcomeStats('a', input, 'model')['gpt-4o'].total).toBe(1);
    expect(storage.getOutcomeStats('a', input, 'skill').writing.total).toBe(1);
    storage.close();
  });

  it('preserves notes on empty/invalid lists and separates identical meeting titles', async () => {
    const dir = await temp();
    const settings = new Map<string, string>();
    const manager = new GranolaManager({ getSetting: (k: string) => settings.get(k), setSetting: (k: string, v: string) => settings.set(k, v), saveAuditLog: vi.fn() } as any, {} as any, { getDir: () => dir, ensureDir: async () => {} } as any);
    vi.spyOn(manager, 'isConnected').mockReturnValue(true);
    vi.spyOn(manager, 'getMeeting').mockImplementation(async id => ({ note: { title: 'Weekly', content: id } }));
    const list = vi.spyOn(manager, 'listMeetings').mockResolvedValue([{ id: 'one', title: 'Weekly', updated_at: '1' }, { id: 'two', title: 'Weekly', updated_at: '1' }]);
    expect((await manager.syncNow()).synced).toBe(2);
    const files = await fs.readdir(dir);
    expect(files).toHaveLength(2);
    list.mockResolvedValue([]);
    await manager.syncNow();
    expect(await fs.readdir(dir)).toEqual(files);
    expect(() => (manager as any).extractItems({ unexpected: [] })).toThrow('Invalid');
    settings.set('granola.enabled', 'true');
    settings.set('granola.syncMinutes', '60');
    settings.set('granola.lastSync', new Date().toISOString());
    vi.useFakeTimers();
    const sync = vi.spyOn(manager, 'syncNow').mockResolvedValue({ synced: 0, skipped: 0 });
    manager.ensureScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(55 * 60_000);
    expect(sync).toHaveBeenCalledTimes(1);
    manager.stop();
  });
});

it('counts running and failed monthly requests before allowing another run', async () => {
  const storage = new StorageManager(await temp());
  storage.saveAgentExecution({ id: 'limit-1', agentId: 'a', input: {}, status: 'failed', startedAt: new Date().toISOString(), progress: 0 });
  expect(() => storage.assertMonthlyRunCap('a', 1)).toThrow('Monthly execution');
  expect(() => storage.assertMonthlyRunCap('b', 1)).not.toThrow();
  expect(() => storage.assertMonthlyRunCap('a', 0)).toThrow('Invalid');
  storage.close();
});
