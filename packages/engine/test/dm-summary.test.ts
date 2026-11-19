import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@keepmind/db";
import { buildRunContext, createAgent, insertMessage, openAgentDm } from "../src";
import { DM_VERBATIM } from "../src/context";
import { currentDmSummary, ensureDmSummary } from "../src/context/summaries";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

/** An agents' DM with `count` agent-authored messages and a run of `agentId` triggered by the last one. */
async function longDm(count: number) {
  f = await setup();
  const infra = await createAgent(
    f.db,
    f.owner.id,
    f.org.id,
    { name: "Infra", handle: "infra", role: "Payroll", instructions: "Answer.", credentialId: f.credential.id },
    { model: "claude-sonnet-5-5" },
  );
  const dm = await openAgentDm(f.db, f.org.id, f.agent.id, infra.id);
  const placeholder = crypto.randomUUID();
  const [made] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: infra.id,
      channelId: dm.id,
      threadRootId: placeholder,
      triggerMessageId: placeholder,
      trigger: "mention",
      hop: 1,
      status: "running",
    })
    .returning();
  if (!made) throw new Error("no run");
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const m = await insertMessage(f.db, {
      orgId: f.org.id,
      channelId: dm.id,
      author: { type: "agent", agentId: i % 2 ? infra.id : f.agent.id, runId: made.id, hop: 1 },
      body: `exchange ${i}: payroll figure ${i * 100} confirmed`,
    });
    ids.push(m.id);
  }
  const triggerId = ids.at(-1);
  if (!triggerId) throw new Error("no trigger");
  const [run] = await f.db
    .update(schema.agentRuns)
    .set({ threadRootId: triggerId, triggerMessageId: triggerId })
    .where(eq(schema.agentRuns.id, made.id))
    .returning();
  if (!run) throw new Error("no run");
  return { infra, dm, run, ids };
}

describe("agents' DM context reduction", () => {
  test("history keeps the newest DM_VERBATIM and reports the older slice for summarizing", async () => {
    const { infra, run, ids } = await longDm(DM_VERBATIM + 16);
    const ctx = await buildRunContext(f.db, run, infra, { maxMessages: 30 });
    expect(ctx.dmOlder?.messages.length).toBe(16);
    expect(ctx.dmOlder?.messages[0]?.id).toBe(ids[0]);
    const said = JSON.stringify(ctx.messages);
    // The verbatim window is the newest DM_VERBATIM (exchanges 16–39); the trigger is the agent's own last
    // message, which toTurns leaves out as a trailing assistant turn.
    expect(said).toContain(`exchange ${DM_VERBATIM}:`);
    expect(said).not.toContain("exchange 15:");
    expect(said).not.toContain("exchange 0:");
  });

  test("a DM within the verbatim window is untouched", async () => {
    const { infra, run } = await longDm(DM_VERBATIM);
    const ctx = await buildRunContext(f.db, run, infra, { maxMessages: 30 });
    expect(ctx.dmOlder).toBeNull();
  });

  test("ensureDmSummary stores a reader-scoped summary and reuses it until newer messages arrive", async () => {
    const { dm, ids } = await longDm(DM_VERBATIM + 10);
    const byId = new Map(ids.map((id, i) => [id, i]));
    const messages = (await f.db.select().from(schema.messages).where(eq(schema.messages.channelId, dm.id))).sort(
      (a, b) => (byId.get(a.id) ?? 0) - (byId.get(b.id) ?? 0),
    );
    const slice = messages.slice(0, 10);
    const first = await ensureDmSummary(f.context, f.org.id, dm.id, { reader: null, messages: slice });
    expect(first?.kind).toBe("thread_summary");
    expect(first?.scopeId).toBe(`${dm.id}:agent`);
    expect(first?.channelIds).toEqual([dm.id]);
    expect(first?.sourceIds.length).toBe(slice.length);
    const current = await currentDmSummary(f.db, f.org.id, `${dm.id}:agent`);
    expect(current?.id).toBe(first?.id);
    // Same slice: the stored summary still covers it, no new item.
    const again = await ensureDmSummary(f.context, f.org.id, dm.id, { reader: null, messages: slice });
    expect(again?.id).toBe(first?.id);
  });
});
