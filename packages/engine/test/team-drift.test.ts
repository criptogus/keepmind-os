import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@keepmind/db";
import { createChannel, RIGHT_HAND, rightHandPrompt, teamDrift } from "../src";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const DAY = 24 * 3600_000;
const WEEK = 7 * DAY;

const lodiOf = async (fx: Fixture) => {
  const [lodi] = await fx.db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, fx.org.id), eq(schema.agents.builtin, RIGHT_HAND)));
  if (!lodi) throw new Error("no right hand");
  return lodi;
};

/** `n` failed runs for `agentId` ending now (one trigger each: (trigger_message_id, agent_id) is unique). */
async function failedRuns(fx: Fixture, agentId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const triggerId = crypto.randomUUID();
    await fx.db.insert(schema.agentRuns).values({
      orgId: fx.org.id,
      agentId,
      channelId: fx.general.id,
      threadRootId: triggerId,
      triggerMessageId: triggerId,
      trigger: "mention",
      hop: 1,
      status: "failed",
    });
  }
}

const seenOf = (fx: Fixture, extra: Partial<Parameters<typeof teamDrift>[1]["seen"][number]> = {}) => [
  { id: fx.agent.id, handle: fx.agent.handle, name: fx.agent.name, createdAt: fx.agent.createdAt, ...extra },
];
const channelsOf = (fx: Fixture) => [{ id: fx.general.id, name: "general", createdAt: fx.general.createdAt }];

const drift = (fx: Fixture, seen = seenOf(fx), channels = channelsOf(fx), personId = fx.owner.id) =>
  teamDrift(fx.db, { orgId: fx.org.id, personId, seen, channels });

describe("teamDrift", () => {
  test("a fresh team says nothing", async () => {
    f = await setup({ rightHand: true });
    expect(await drift(f)).toEqual([]);
  });

  test("three failed runs in a day names the agent and the fix", async () => {
    f = await setup({ rightHand: true });
    await failedRuns(f, f.agent.id, 3);
    const lines = await drift(f);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("@dev");
    expect(lines[0]).toContain("failed runs");
    expect(lines[0]).toContain("propose_settings_change");
  });

  test("the same day is said once per person", async () => {
    f = await setup({ rightHand: true });
    await failedRuns(f, f.agent.id, 3);
    expect(await drift(f)).toHaveLength(1);
    expect(await drift(f)).toEqual([]);
  });

  test("agents the person can't see never leak", async () => {
    f = await setup({ rightHand: true });
    await failedRuns(f, f.agent.id, 3);
    // `seen` empty: the failing agent isn't theirs to hear about.
    expect(await drift(f, [])).toEqual([]);
    // And the day's key wasn't spent on the empty read.
    expect(await drift(f)).toHaveLength(1);
  });

  test("an agent with a routine that hasn't run in a week is drift", async () => {
    f = await setup({ rightHand: true });
    const old = new Date(Date.now() - WEEK - DAY);
    await f.db.update(schema.agents).set({ createdAt: old }).where(eq(schema.agents.id, f.agent.id));
    await f.db.insert(schema.routines).values({
      orgId: f.org.id,
      agentId: f.agent.id,
      name: "Resumo",
      prompt: "Resuma o dia",
      target: { type: "dm" },
      triggerType: "schedule",
      cron: "0 9 * * *",
      timezone: "UTC",
      nextRunAt: new Date(Date.now() + DAY),
      createdByUserId: f.owner.id,
    });
    const lines = await drift(f, seenOf(f, { createdAt: old }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hasn't run in over a week");
  });

  test("a channel silent for two weeks is drift", async () => {
    f = await setup({ rightHand: true });
    const old = new Date(Date.now() - 20 * DAY);
    const lines = await drift(f, seenOf(f), [{ id: crypto.randomUUID(), name: "velho", createdAt: old }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("#velho");
    expect(lines[0]).toContain("no messages in two weeks");
  });

  test("a channel past the checked slice that is active isn't drift", async () => {
    f = await setup({ rightHand: true });
    const old = new Date(Date.now() - 20 * DAY);
    // 20 fresh channels fill the checked slice without being silence candidates; the 21st is real,
    // old, and has a message from today — its activity must be seen, or it reads as silent.
    const fresh = Array.from({ length: 20 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `fresco-${i}`,
      createdAt: new Date(),
    }));
    const room = await createChannel(f.db, f.owner.id, f.org.id, { name: "movimento" });
    await f.db.update(schema.channels).set({ createdAt: old }).where(eq(schema.channels.id, room.id));
    await f.db.insert(schema.messages).values({
      orgId: f.org.id,
      channelId: room.id,
      authorType: "person",
      authorUserId: f.owner.id,
      body: "oi",
    });
    const lines = await drift(f, seenOf(f), [...fresh, { id: room.id, name: room.name, createdAt: old }]);
    expect(lines).toEqual([]);
  });

  test("a new channel isn't drift for being quiet", async () => {
    f = await setup({ rightHand: true });
    const lines = await drift(f, seenOf(f), [{ id: crypto.randomUUID(), name: "novo", createdAt: new Date() }]);
    expect(lines).toEqual([]);
  });

  test("five pending approvals suggest a rule", async () => {
    f = await setup({ rightHand: true });
    const root = (await f.db.select({ id: schema.messages.id }).from(schema.messages).limit(1))[0]?.id;
    for (let i = 0; i < 5; i++)
      await f.db.insert(schema.approvals).values({
        orgId: f.org.id,
        agentId: f.agent.id,
        channelId: f.general.id,
        threadRootId: root ?? f.general.id,
        toolUseId: `tu_${i}`,
        tool: "send_message",
        scope: "app",
        params: {},
        actionHash: `h${i}`,
        title: "Enviar mensagem",
        expiresAt: new Date(Date.now() + DAY),
      });
    const lines = await drift(f);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("approvals");
    expect(lines[0]).toContain("approval rules");
  });
});

describe("rightHandPrompt team drift", () => {
  const prompt = async (fx: Fixture, inDm = true, personId = fx.owner.id) => {
    const lodi = await lodiOf(fx);
    return rightHandPrompt({ db: fx.db }, { orgId: fx.org.id, agent: lodi, personId, inDm });
  };

  test("a DM with drift gets the section; a channel doesn't", async () => {
    f = await setup({ rightHand: true });
    await failedRuns(f, f.agent.id, 3);
    // The first-run card would suppress nudges: clear the right hand's setup so `cardOpen` is false.
    const lodi = await lodiOf(f);
    await f.db.update(schema.agents).set({ setup: null }).where(eq(schema.agents.id, lodi.id));
    const dm = await prompt(f, true);
    expect(dm).toContain("# Team drift");
    expect(dm).toContain("@dev");
    const channel = await prompt(f, false);
    expect(channel).not.toContain("# Team drift");
  });

  test("no drift section while the first-run card is open", async () => {
    f = await setup({ rightHand: true });
    await failedRuns(f, f.agent.id, 3);
    // lodi.setup stays: the checklist card is open, drift must not fight it.
    const p = await prompt(f, true);
    expect(p).not.toContain("# Team drift");
  });
});
