import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageManager } from '../src/main/storage/StorageManager';
import { WorkManager } from '../src/main/work/WorkManager';
import { createBusinessTeam } from '../src/main/work/BusinessTeamSetup';
import { TEAM_STARTERS, type BusinessTeamInput } from '../src/shared/businessTeams';
const dirs: string[] = []; const stores: StorageManager[] = [];
afterEach(() => { vi.restoreAllMocks(); stores.forEach(s => s.close()); stores.length = 0; dirs.forEach(d => rmSync(d, { recursive: true, force: true })); dirs.length = 0; });
function setup() { const dir = mkdtempSync(join(tmpdir(), 'business-team-')); dirs.push(dir); const storage = new StorageManager(dir); stores.push(storage); return { storage, work: new WorkManager(storage) }; }
function input(id = 'marketing'): BusinessTeamInput { const t = TEAM_STARTERS.find(t => t.id === id)!; return { requestId: 'test-request-123', problem: t.example || 'Quero ajuda com meu negócio', priority: t.id, name: t.name, roles: t.roles.map(r => ({ ...r })), firstRequest: t.first, provider: 'openai' }; }
it.each(['consulting', 'marketing', 'operations', 'general'])('creates a real %s team and a draft with no execution', priority => {
  const { storage, work } = setup(); const data = input(priority); const r = createBusinessTeam(storage, work, data, 'owner');
  const team = storage.getTeam(r.teamId)!;
  expect(team.agentIds).toHaveLength(3);
  expect(team.agentIds[0]).toBe(r.coordinatorId);
  expect(storage.getAgent(team.agentIds[1])?.managerId).toBe(r.coordinatorId);
  expect(storage.getAgent(team.agentIds[1])?.config.tools).toEqual([]);
  expect(storage.getAgent(r.coordinatorId)?.config.systemPrompt).toContain(team.agentIds[1]);
  expect(work.get(r.taskId)).toMatchObject({ status: 'backlog', ownerId: 'owner', reviewRequired: true, agentId: r.coordinatorId, goal: data.firstRequest });
  expect(work.get(r.taskId).executionId).toBeUndefined();
  expect(createBusinessTeam(storage, work, data, 'owner')).toEqual(r);
  expect(storage.getAllAgents()).toHaveLength(3);
  expect(new WorkManager(storage).get(r.taskId).status).toBe('backlog');
  expect(() => createBusinessTeam(storage, work, { ...data, problem: 'Outro problema' }, 'owner')).toThrow('outras informações');
});
it('rolls back agents, team and in-memory draft when the final write fails, then retries', () => {
  const { storage, work } = setup(); const original = storage.setSetting.bind(storage);
  const spy = vi.spyOn(storage, 'setSetting').mockImplementation((key, value) => { if (key.startsWith('guidedTeam.')) throw new Error('disk failure'); original(key, value); });
  expect(() => createBusinessTeam(storage, work, input(), 'owner')).toThrow('disk failure');
  expect(storage.getAllAgents()).toHaveLength(0); expect(storage.getAllTeams()).toHaveLength(0); expect(work.snapshot().tasks).toHaveLength(0);
  spy.mockRestore(); const result = createBusinessTeam(storage, work, input(), 'owner'); expect(work.get(result.taskId).status).toBe('backlog');
});
it('rejects invalid roles before persisting', () => { const { storage, work } = setup(); expect(() => createBusinessTeam(storage, work, { ...input(), roles: [] }, 'owner')).toThrow(); expect(storage.getAllAgents()).toHaveLength(0); });
