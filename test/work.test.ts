import { describe, it, expect } from 'vitest';
import { WorkManager } from '../src/main/work/WorkManager';
import { evaluateCondition, TeamExecutionEngine } from '../src/main/agent/TeamExecutionEngine';

function setup() {
  const data = new Map<string, string>();
  const storage = { getSetting: (key: string) => data.get(key), setSetting: (key: string, value: string) => { data.set(key, value); } };
  return { storage, manager: new WorkManager(storage) };
}
const execution = { id: 'run-1', agentId: 'agent', status: 'completed' as const, input: {}, progress: 100, output: { content: 'A result with evidence' } };

describe('Outcome workspace', () => {
  it('requires human acceptance, persists history and prevents concurrent duplicate execution', async () => {
    const { manager, storage } = setup();
    const task = manager.create({ goal: 'Review code', agentId: 'agent', reviewRequired: true }, 'alice');
    let finish!: (value: typeof execution) => void;
    const run = manager.run(task.id, () => new Promise(resolve => { finish = resolve; }));
    await expect(manager.run(task.id, async () => execution)).rejects.toThrow('not ready');
    finish(execution); await run;
    expect(manager.get(task.id).status).toBe('review');
    manager.change(task.id, 'accept');
    expect(new WorkManager(storage).get(task.id).status).toBe('done');
    expect(manager.get(task.id).events.map(e => e.kind)).toEqual(['created','started','delivered','accepted']);
  });
  it('blocks dependencies until results have been accepted', async () => {
    const { manager } = setup(); const parent = manager.create({ goal: 'Research', agentId: 'agent', reviewRequired: true }, 'alice');
    const child = manager.create({ goal: 'Implement', agentId: 'agent', reviewRequired: true, dependencies: [parent.id] }, 'alice');
    await manager.run(parent.id, async () => execution);
    await expect(manager.run(child.id, async () => execution)).rejects.toThrow('accepted');
    manager.change(parent.id, 'accept'); await manager.run(child.id, async () => execution);
    expect(manager.get(child.id).status).toBe('review');
  });
  it('does not overwrite cancellation with a late result', async () => {
    const { manager } = setup(); const task = manager.create({ goal: 'Review', agentId: 'agent' }, 'alice');
    let finish!: (value: typeof execution) => void;
    const run = manager.run(task.id, () => new Promise(resolve => { finish = resolve; }));
    manager.change(task.id, 'cancel'); finish(execution); await run;
    expect(manager.get(task.id).status).toBe('cancelled');
  });
  it('recovers interrupted tasks without replaying external actions', () => {
    const { manager, storage } = setup(); const task = manager.create({ goal: 'Send', agentId: 'agent' }, 'alice');
    void manager.run(task.id, () => new Promise(() => {}));
    expect(new WorkManager(storage).get(task.id).status).toBe('blocked');
  });
  it('scopes learned rules to their owner and requires explicit activation', async () => {
    const { manager } = setup(); const task = manager.create({ goal: 'Review', agentId: 'agent', project: 'app' }, 'alice');
    manager.change(task.id, 'propose-rule', 'Use integration tests');
    const rule = manager.snapshot().rules[0];
    expect(manager.snapshot('bob').rules).toHaveLength(0);
    let input: any;
    await manager.run(task.id, async (_, i) => { input = i; return execution; });
    expect(input.projectRules).toHaveLength(0);
    manager.reviewRule(rule.id, true); manager.change(task.id, 'revise', 'Try again');
    await manager.run(task.id, async (_, i) => { input = i; return execution; });
    expect(input.projectRules[0].text).toBe('Use integration tests');
  });
});

describe('Typed workflow conditions', () => {
  it('compares typed values and rejects unknown syntax', () => {
    expect(evaluateCondition('count >= 3', { count: 4 })).toBe(true);
    expect(evaluateCondition('ready === true', { ready: true })).toBe(true);
    expect(evaluateCondition('count === "4"', { count: 4 })).toBe(false);
    expect(() => evaluateCondition('process.exit()', {})).toThrow();
    expect(() => evaluateCondition('x > 2', { x: '3' })).toThrow();
  });
  it('detects dependency cycles before running any agent', async () => {
    let calls = 0;
    const team: any = { id: 'team', agentIds: ['agent'], workflow: { executionMode: 'parallel', steps: [{ id: 'a', agentId: 'agent', dependsOn: ['b'] }, { id: 'b', agentId: 'agent', dependsOn: ['a'] }] } };
    await expect(new TeamExecutionEngine().executeTeam(team, [], {}, async () => { calls++; return execution; })).rejects.toThrow('Cyclic');
    expect(calls).toBe(0);
  });
});

it('starts a requested revision immediately, passes prior delivery, and keeps both versions', async () => {
  const { manager } = setup(); const t = manager.create({ goal: 'Plano comercial', agentId: 'a', reviewRequired: true }, 'owner');
  await manager.run(t.id, async () => execution);
  let finish!: (value: typeof execution) => void; let received: any;
  const revision = manager.reviseAndRun(t.id, 'Reduza para três ações', async (_, input) => { received = input; return new Promise(resolve => { finish = resolve; }); });
  expect(manager.get(t.id).status).toBe('running');
  expect(received.previousDelivery).toBe('A result with evidence');
  expect(received.corrections).toEqual(['Reduza para três ações']);
  expect(() => manager.reviseAndRun(t.id, 'duplicate', async () => execution)).toThrow();
  finish({ ...execution, id: 'version-2', output: { content: 'Três ações' } }); await revision;
  expect(manager.get(t.id).status).toBe('review');
  expect(manager.get(t.id).deliveries?.map(d => [d.version,d.content])).toEqual([[1,'A result with evidence'],[2,'Três ações']]);
});
it('preserves the previous version when a revision fails and permits retry', async () => {
  const { manager } = setup(); const t = manager.create({ goal: 'Plano', agentId: 'a' }, 'owner'); await manager.run(t.id, async () => execution);
  await manager.reviseAndRun(t.id, 'Ajustar', async () => { throw new Error('Provider unavailable'); });
  expect(manager.get(t.id)).toMatchObject({ status: 'blocked', output: 'A result with evidence' });
  await manager.run(t.id, async () => ({ ...execution, output: { content: 'Updated' } }));
  expect(manager.get(t.id).deliveries?.map(d => d.version)).toEqual([1,2]);
});
