import { describe, it, expect, beforeEach } from 'vitest';
import { TriggerManager } from '../src/main/agent/TriggerManager.js';
import type { AgentTrigger } from '../src/shared/types.js';

function makeManager() {
  const store = new Map<string, string>();
  const ran: Array<{ agentId: string; input: Record<string, unknown> }> = [];
  const tm = new TriggerManager(
    (k) => store.get(k) ?? null,
    (k, v) => store.set(k, v)
  );
  tm.attach({
    runAgent: async (agentId, input) => { ran.push({ agentId, input }); },
    getAgentName: () => 'Test Agent',
  });
  return { tm, store, ran };
}

describe('TriggerManager', () => {
  let ctx: ReturnType<typeof makeManager>;
  beforeEach(() => { ctx = makeManager(); });

  it('creates and lists triggers', () => {
    const t = ctx.tm.create({
      agentId: 'a1', name: ' hourly ', kind: 'interval',
      intervalMinutes: 30, prompt: 'do thing', enabled: true,
    });
    expect(t.id).toBeTruthy();
    expect(ctx.tm.list()).toHaveLength(1);
  });

  it('persists rules across instances', () => {
    ctx.tm.create({ agentId: 'a1', name: 't', kind: 'interval', intervalMinutes: 5, prompt: 'p', enabled: true });
    const tm2 = new TriggerManager((k) => ctx.store.get(k) ?? null, (k, v) => ctx.store.set(k, v));
    expect(tm2.list()).toHaveLength(1);
  });

  it('interval trigger fires when due', async () => {
    const t = ctx.tm.create({
      agentId: 'a1', name: 't', kind: 'interval',
      intervalMinutes: 1, prompt: 'ping', enabled: true,
      lastRunAt: new Date(Date.now() - 120_000).toISOString(),
    } as any);
    // force lastRunAt via update path: create stores without lastRunAt; simulate by direct list check
    // Instead: create with lastRunAt undefined fires immediately on first tick — test via private tick indirectly is complex;
    // verify isDue logic via a manual run: lastRunAt absent => due
    await (ctx.tm as any).tick();
    expect(ctx.ran.length).toBe(1);
    expect(ctx.ran[0].input.task).toBe('ping');
    expect(ctx.ran[0].agentId).toBe('a1');
  });

  it('disabled trigger does not fire', async () => {
    ctx.tm.create({ agentId: 'a1', name: 't', kind: 'interval', intervalMinutes: 1, prompt: 'p', enabled: false });
    await (ctx.tm as any).tick();
    expect(ctx.ran).toHaveLength(0);
  });

  it('whatsapp agent id round-trips', () => {
    ctx.tm.setWhatsAppAgentId('agent-9');
    expect(ctx.tm.getWhatsAppAgentId()).toBe('agent-9');
  });

  it('update and delete', () => {
    const t = ctx.tm.create({ agentId: 'a1', name: 't', kind: 'daily', timeOfDay: '08:00', prompt: 'p', enabled: true });
    ctx.tm.update(t.id, { enabled: false });
    expect(ctx.tm.list()[0].enabled).toBe(false);
    expect(ctx.tm.delete(t.id)).toBe(true);
    expect(ctx.tm.list()).toHaveLength(0);
  });
});
