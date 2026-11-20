import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@keepmind/db";
import { createGoal, createGoalToolSource, getGoal, listGoals, updateGoal } from "../src";
import type { ToolContext } from "../src/tools/types";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
beforeEach(async () => {
  f = await setup();
});
afterEach(() => f.close());

const tools = async () => {
  const src = createGoalToolSource();
  const ctx = ctxOf();
  const list = await src.tools(ctx);
  return Object.fromEntries(list.map((t) => [t.name, t])) as Record<
    "list_goals" | "propose_goal" | "update_goal",
    (typeof list)[number]
  >;
};

const ctxOf = (): ToolContext => ({
  db: f.db,
  orgId: f.org.id,
  agentId: f.agent.id,
  runId: "run_test",
  channelId: "chan_test",
  threadRootId: "msg_test",
  triggerMessageId: "msg_test",
});

describe("goals", () => {
  test("a person sets a goal active; an agent's lands proposed until a person activates it", async () => {
    const mine = await createGoal(f.db, {
      orgId: f.org.id,
      title: "100 leads this month",
      metric: "qualified leads",
      target: 100,
      unit: "leads",
      period: "monthly",
      createdByUserId: f.owner.id,
    });
    expect(mine.status).toBe("active");

    const theirs = await createGoal(f.db, {
      orgId: f.org.id,
      title: "99.9% uptime",
      target: 99.9,
      unit: "%",
      createdByAgentId: f.agent.id,
    });
    expect(theirs.status).toBe("proposed");
    expect(theirs.createdByAgentId).toBe(f.agent.id);

    const activated = await updateGoal(f.db, f.org.id, theirs.id, { status: "active" }, { userId: f.owner.id });
    expect(activated?.status).toBe("active");
  });

  test("update moves current and the review note; org isolation holds", async () => {
    const g = await createGoal(f.db, {
      orgId: f.org.id,
      title: "Ship v2",
      target: 10,
      createdByUserId: f.owner.id,
    });
    const moved = await updateGoal(
      f.db,
      f.org.id,
      g.id,
      { current: 4, progressNote: "on track" },
      { userId: f.owner.id },
    );
    expect(moved?.current).toBe(4);
    expect(moved?.progressNote).toBe("on track");
    expect(await updateGoal(f.db, crypto.randomUUID(), g.id, { current: 9 })).toBeNull();
    expect((await getGoal(f.db, f.org.id, g.id))?.current).toBe(4);
  });

  test("listGoals returns owner names and filters by status", async () => {
    await createGoal(f.db, { orgId: f.org.id, title: "Active one", createdByUserId: f.owner.id });
    await createGoal(f.db, {
      orgId: f.org.id,
      title: "Proposed one",
      createdByAgentId: f.agent.id,
      ownerAgentId: f.agent.id,
    });
    const all = await listGoals(f.db, f.org.id);
    expect(all).toHaveLength(2);
    const proposed = await listGoals(f.db, f.org.id, "proposed");
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.title).toBe("Proposed one");
    const withOwner = all.find((g) => g.title === "Proposed one");
    expect(withOwner?.owner?.handle).toBe(f.agent.handle);
  });

  test("rejects bad input: unknown period, negative target, foreign owner", async () => {
    await expect(
      createGoal(f.db, { orgId: f.org.id, title: "x", period: "hourly" as never, createdByUserId: f.owner.id }),
    ).rejects.toThrow();
    await expect(
      createGoal(f.db, { orgId: f.org.id, title: "x", target: -1, createdByUserId: f.owner.id }),
    ).rejects.toThrow();
    await expect(
      createGoal(f.db, { orgId: f.org.id, title: "x", ownerAgentId: crypto.randomUUID(), createdByUserId: f.owner.id }),
    ).rejects.toThrow();
  });
});

describe("goal tools", () => {
  test("propose_goal lands proposed with an owner; list_goals shows it; update_goal moves it", async () => {
    const t = await tools();
    const ctx = ctxOf();

    const proposed = await t.propose_goal.execute(
      {
        title: "50 signups this week",
        metric: "new accounts",
        target: 50,
        unit: "signups",
        period: "weekly",
        owner: f.agent.handle,
      },
      ctx,
    );
    expect(proposed.isError).not.toBe(true);
    expect(proposed.content).toContain("activates");
    const goalId = (proposed.data as { goalId: string }).goalId;

    const [row] = await f.db.select().from(schema.goals).where(eq(schema.goals.id, goalId));
    expect(row?.status).toBe("proposed");
    expect(row?.ownerAgentId).toBe(f.agent.id);

    // Still proposed: update_goal refuses.
    const early = await t.update_goal.execute({ goal: goalId, current: 3 }, ctx);
    expect(early.isError).toBe(true);

    await updateGoal(f.db, f.org.id, goalId, { status: "active" }, { userId: f.owner.id });
    const moved = await t.update_goal.execute({ goal: goalId.slice(0, 8), current: 12, note: "ads live" }, ctx);
    expect(moved.isError).not.toBe(true);
    expect(moved.content).toContain("12");

    const listed = await t.list_goals.execute({ status: "active" }, ctx);
    expect(listed.content).toContain("50 signups this week");
  });

  test("propose_goal with an unknown owner errors; update_goal with a bad ref errors", async () => {
    const t = await tools();
    const ctx = ctxOf();
    const bad = await t.propose_goal.execute({ title: "x", owner: "ghost" }, ctx);
    expect(bad.isError).toBe(true);
    const noGoal = await t.update_goal.execute({ goal: "zzzzzzzz", current: 1 }, ctx);
    expect(noGoal.isError).toBe(true);
  });

  test("a goal of another org is invisible", async () => {
    const t = await tools();
    const ctx = { ...ctxOf(), orgId: crypto.randomUUID() };
    const listed = await t.list_goals.execute({}, ctx);
    expect(listed.content).toBe("No goals yet.");
  });
});
