import { afterEach, expect, test } from "bun:test";
import { createMemoryBlobStore, singleStoreResolver } from "@keepmind/adapters";
import { eq, schema } from "@keepmind/db";
import { type KeepMindLegacySnapshot, planKeepMindLegacy, stageKeepMindLegacy } from "../src/keepmind-legacy";
import { type Fixture, setup } from "./fixtures";

const MONTH = `${new Date().toISOString().slice(0, 7)}-01`;
let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});
const snapshot = (): KeepMindLegacySnapshot => ({
  sourceRef: "synthetic-legacy",
  usage: [{ agentId: "a1", month: MONTH, runs: 7, costNanoUsd: 500_000_000 }],
  timezone: "America/Sao_Paulo",
  agents: [
    {
      id: "a1",
      name: "Redator",
      description: "Marketing",
      config: JSON.stringify({ systemPrompt: "Escreva propostas", monthlyBudgetUsd: 1.25, skillIds: ["s1"] }),
      permissions: JSON.stringify({
        canAccessNetwork: false,
        canAccessFileSystem: false,
        canExecuteCode: false,
        maxExecutionTime: 120,
      }),
    },
  ],
  skills: [
    {
      id: "s1",
      name: "Palestras",
      description: "Preparar propostas",
      prompt: "Não invente preços.",
      tags: '["vendas"]',
    },
  ],
  teams: [{ id: "t1", name: "Marketing", agent_ids: '["a1"]', workflow: '{"executionMode":"sequential","steps":[]}' }],
  triggers: [
    {
      id: "c1",
      agentId: "a1",
      kind: "daily",
      timeOfDay: "09:30",
      daysOfWeek: [1, 3],
      name: "Resumo",
      prompt: "Resuma novidades",
      enabled: true,
    },
  ],
  memory_items: [
    { id: "m1", kind: "fact", content: "Nota privada", related_ids: '["m2"]', superseded_by: "m2" },
    { id: "m2", kind: "fact", content: "Nota corrigida" },
  ],
});
test("legacy conversion rejects broken relationships and preserves unsupported schedules for review", () => {
  const s = snapshot();
  s.triggers.push({ id: "c2", agentId: "a1", kind: "interval", intervalMinutes: 90 });
  const p = planKeepMindLegacy(s);
  expect(p.bundle.routines).toHaveLength(1);
  expect(p.bundle.routines[0]?.trigger).toEqual({ cron: "30 9 * * 1,3", timezone: "America/Sao_Paulo" });
  expect(p.review.some((r) => r.key === "c2")).toBe(true);
  (s.teams[0] as Record<string, unknown>).agent_ids = '["missing"]';
  expect(() => planKeepMindLegacy(s)).toThrow("Dangling");
});
test("staging is private, inert, relationship-preserving and repeatable", async () => {
  f = await setup();
  await f.db.delete(schema.agents).where(eq(schema.agents.orgId, f.org.id));
  const deps = { db: f.db, blobs: singleStoreResolver(createMemoryBlobStore()), pubsub: f.pubsub };
  const first = await stageKeepMindLegacy(deps, f.owner.id, f.org.id, snapshot());
  expect(first.items.every((i) => i.action === "create")).toBe(true);
  const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.orgId, f.org.id));
  expect(agent?.operatorHoldAt).not.toBeNull();
  expect(agent?.audienceMode).toBe("owner");
  expect(agent?.monthlyBudgetNanoUsd).toBe(1_250_000_000);
  expect(first.preparation.readyForCutover).toBe(false);
  expect(agent?.consultable).toBe(false);
  expect(await f.db.select().from(schema.agentScopes)).toHaveLength(0);
  const [routine] = await f.db.select().from(schema.routines);
  expect(routine?.active).toBe(false);
  expect(routine?.nextRunAt).toBeNull();
  const [skill] = await f.db.select().from(schema.skills).where(eq(schema.skills.ownerUserId, f.owner.id));
  expect(skill?.ownerUserId).toBe(f.owner.id);
  expect(skill?.body).toContain("Não invente preços.");
  expect(await f.db.select().from(schema.agentSkills)).toHaveLength(1);
  const team = first.items.find((i) => i.kind === "channel");
  if (!team?.targetId) throw new Error("Missing imported room");
  const [room] = await f.db.select().from(schema.channels).where(eq(schema.channels.id, team.targetId));
  expect(room?.visibility).toBe("private");
  const memories = await f.db.select().from(schema.contextItems);
  expect(memories).toHaveLength(2);
  expect(memories.every((m) => m.status === "archived" && !m.verified && m.channelIds.length === 1)).toBe(true);
  expect(memories.some((m) => m.supersededBy !== null)).toBe(true);
  const second = await stageKeepMindLegacy(deps, f.owner.id, f.org.id, snapshot());
  expect(second.items.every((i) => i.action === "unchanged")).toBe(true);
  expect(await f.db.select().from(schema.agents)).toHaveLength(1);
  expect((await f.db.select().from(schema.legacyAgentPolicies))[0]?.priorRunsByMonth[MONTH]).toBe(7);
  const budgets = await f.db.select().from(schema.agentBudgetPeriods);
  expect(budgets).toHaveLength(1);
  expect(budgets[0]?.spentNanoUsd).toBe(500_000_000);
}, 120_000);
test("staging refuses a live workspace and rolls back truncation", async () => {
  f = await setup();
  const deps = { db: f.db, blobs: singleStoreResolver(createMemoryBlobStore()), pubsub: f.pubsub };
  await expect(stageKeepMindLegacy(deps, f.owner.id, f.org.id, snapshot())).rejects.toThrow("unrelated agents");
  await f.db.delete(schema.agents).where(eq(schema.agents.orgId, f.org.id));
  const s = snapshot();
  (s.agents[0] as Record<string, unknown>).name = "a".repeat(100);
  await expect(stageKeepMindLegacy(deps, f.owner.id, f.org.id, s)).rejects.toThrow("truncate");
  expect(await f.db.select().from(schema.agents)).toHaveLength(0);
  expect(await f.db.select().from(schema.importItems)).toHaveLength(0);
}, 120_000);

test("unknown caller cannot import and corrupt memory links roll back every entity", async () => {
  f = await setup();
  const deps = { db: f.db, blobs: singleStoreResolver(createMemoryBlobStore()), pubsub: f.pubsub };
  await expect(stageKeepMindLegacy(deps, "unknown-user", f.org.id, snapshot())).rejects.toThrow();
  await f.db.delete(schema.agents).where(eq(schema.agents.orgId, f.org.id));
  const s = snapshot();
  (s.memory_items[0] as Record<string, unknown>).superseded_by = "missing";
  await expect(stageKeepMindLegacy(deps, f.owner.id, f.org.id, s)).rejects.toThrow("Dangling memory");
  expect(await f.db.select().from(schema.contextItems)).toHaveLength(0);
  expect(await f.db.select().from(schema.agents)).toHaveLength(0);
  expect(await f.db.select().from(schema.importItems)).toHaveLength(0);
});
test("cyclic managers are refused before writes", () => {
  const s = snapshot();
  (s.agents[0] as Record<string, unknown>).manager_id = "a1";
  expect(() => planKeepMindLegacy(s)).toThrow("Cyclic");
});

test("readable generated handles fit the native limit without truncating source names", () => {
  const s = snapshot();
  (s.agents[0] as Record<string, unknown>).name = "Agente de marketing para palestras e eventos";
  const agent = planKeepMindLegacy(s).bundle.agents[0];
  expect(agent?.handle.length).toBeLessThanOrEqual(32);
  expect(agent?.name).toBe("Agente de marketing para palestras e eventos");
});
