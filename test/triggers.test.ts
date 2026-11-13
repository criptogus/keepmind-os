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

  it('webhook dispatch fires the matching trigger and rejects bad tokens', async () => {
    ctx.tm.create({
      agentId: 'a1', name: 'hook', kind: 'webhook',
      webhookToken: 'sekret-token', prompt: 'process webhook', enabled: true,
    });
    const bad = await ctx.tm.dispatchWebhook('wrong-token', {});
    expect(bad).toBe(false);
    expect(ctx.ran).toHaveLength(0);

    const ok = await ctx.tm.dispatchWebhook('sekret-token', { hello: 'world' });
    expect(ok).toBe(true);
    expect(ctx.ran).toHaveLength(1);
    expect(ctx.ran[0].input.channel).toBe('webhook');
    expect((ctx.ran[0].input.webhookPayload as any).hello).toBe('world');
    expect(ctx.tm.list()[0].lastRunAt).toBeTruthy();

    // webhook rules never fire on the polling tick
    ctx.ran.length = 0;
    await (ctx.tm as any).tick();
    expect(ctx.ran).toHaveLength(0);
  });

  it('disabled webhook trigger does not dispatch', async () => {
    ctx.tm.create({
      agentId: 'a1', name: 'hook', kind: 'webhook',
      webhookToken: 'tok', prompt: 'p', enabled: false,
    });
    expect(await ctx.tm.dispatchWebhook('tok', {})).toBe(false);
  });

  it('daily trigger respects daysOfWeek', async () => {
    const today = new Date().getDay();
    const otherDay = (today + 1) % 7;
    const pastTime = '00:01'; // already past today, so a matching day would fire

    ctx.tm.create({
      agentId: 'a1', name: 'weekdays-only', kind: 'daily',
      timeOfDay: pastTime, daysOfWeek: [otherDay], prompt: 'no', enabled: true,
    });
    ctx.tm.create({
      agentId: 'a1', name: 'today-only', kind: 'daily',
      timeOfDay: pastTime, daysOfWeek: [today], prompt: 'yes', enabled: true,
    });
    await (ctx.tm as any).tick();
    expect(ctx.ran).toHaveLength(1);
    expect(ctx.ran[0].input.task).toBe('yes');
  });

  it('daily trigger without daysOfWeek fires every day', async () => {
    ctx.tm.create({
      agentId: 'a1', name: 'everyday', kind: 'daily',
      timeOfDay: '00:01', prompt: 'daily', enabled: true,
    });
    await (ctx.tm as any).tick();
    expect(ctx.ran).toHaveLength(1);
  });

  it('update and delete', () => {
    const t = ctx.tm.create({ agentId: 'a1', name: 't', kind: 'daily', timeOfDay: '08:00', prompt: 'p', enabled: true });
    ctx.tm.update(t.id, { enabled: false });
    expect(ctx.tm.list()[0].enabled).toBe(false);
    expect(ctx.tm.delete(t.id)).toBe(true);
    expect(ctx.tm.list()).toHaveLength(0);
  });
});
