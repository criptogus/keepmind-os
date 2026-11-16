import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@keepmind/db";
import { executeRun } from "../src/executor";
import { admitLegacyRun } from "../src/legacy-run-policy";
import { advanceLegacyWorkflow, startLegacyWorkflow } from "../src/legacy-workflows";
import { insertMessageWithRuns } from "../src/messages";
import { enqueueRunJob } from "../src/mission-runs";
import { actionHash } from "../src/tools/gateway";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});
async function prepare(cap: number | null = 10, reply = '{"answer":"validated"}') {
  f = await setup({
    contextTools: true,
    reply: () => ({ chunks: [reply], usage: { inputTokens: 5, outputTokens: 5 } }),
  });
  await f.db.update(schema.channels).set({ visibility: "private" }).where(eq(schema.channels.id, f.general.id));
  await f.db.insert(schema.legacyAgentPolicies).values({
    orgId: f.org.id,
    agentId: f.agent.id,
    ownerUserId: f.owner.id,
    enabled: true,
    historyCaptured: true,
    monthlyRunCap: cap,
    timeoutSeconds: 60,
    sourceDigest: "synthetic",
  });
  const [workflow] = await f.db
    .insert(schema.legacyWorkflows)
    .values({
      orgId: f.org.id,
      ownerUserId: f.owner.id,
      channelId: f.general.id,
      sourceRef: "fixture",
      sourceTeamId: "team",
      sourceDigest: "synthetic",
      mode: "sequential",
      enabled: true,
      steps: [
        { id: "one", agentId: f.agent.id, inputs: { task: "one" }, dependsOn: [], condition: null },
        { id: "two", agentId: f.agent.id, inputs: { task: "two" }, dependsOn: ["one"], condition: null },
      ],
    })
    .returning();
  if (!workflow) throw new Error("no workflow");
  return workflow;
}
async function queueNative() {
  const { message } = await insertMessageWithRuns(
    f.db,
    { orgId: f.org.id, channelId: f.general.id, author: { type: "person", userId: f.owner.id }, body: "test" },
    { startRuns: false, deliver: false },
  );
  const queued = await enqueueRunJob(f.db, message, f.agent.id);
  if (!queued.run) throw new Error("no run");
  return queued.run;
}
test("native workflow executes sequential steps through real executor with fake provider and survives repeated advancement", async () => {
  const w = await prepare();
  const run = await startLegacyWorkflow(f.db, f.owner.id, f.org.id, w.id, "request-1", { goal: "test" });
  expect((await startLegacyWorkflow(f.db, f.owner.id, f.org.id, w.id, "request-1", { goal: "test" })).id).toBe(run.id);
  await expect(
    startLegacyWorkflow(f.db, f.owner.id, f.org.id, w.id, "request-1", { goal: "different" }),
  ).rejects.toThrow("conflict");
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(1);
  const [queuedNative] = await f.db.select().from(schema.agentRuns);
  const [posted] = await f.db
    .select()
    .from(schema.outbox)
    .where(eq(schema.outbox.dedupeKey, `message.posted:${queuedNative?.triggerMessageId}`));
  const handler = f.handlers["message.posted"];
  if (!posted || !handler) throw new Error("Missing native message job");
  await handler(posted, { finalAttempt: true });
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(1);
  for (let index = 0; index < 2; index++) {
    const [state] = await f.db.select().from(schema.legacyWorkflowRuns).where(eq(schema.legacyWorkflowRuns.id, run.id));
    const nativeId = state?.states[index]?.runId;
    if (!nativeId) throw new Error("step missing");
    await executeRun(f.jobDeps, nativeId, { finalAttempt: true });
    const [native] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, nativeId));
    expect(native?.status).toBe("done");
    await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  }
  const [done] = await f.db.select().from(schema.legacyWorkflowRuns).where(eq(schema.legacyWorkflowRuns.id, run.id));
  expect(done?.status).toBe("done");
  expect(done?.context.answer).toBe("validated");
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(2);
  expect(await f.db.select().from(schema.legacyRunAdmissions)).toHaveLength(2);
}, 120_000);
test("concurrent admission respects monthly cap, retries do not consume it, expired admissions cannot resume", async () => {
  await prepare(1);
  const a = await queueNative(),
    b = await queueNative();
  const result = await Promise.allSettled([admitLegacyRun(f.db, a.id), admitLegacyRun(f.db, b.id)]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const [admission] = await f.db.select().from(schema.legacyRunAdmissions);
  if (!admission) throw new Error("missing admission");
  expect(await admitLegacyRun(f.db, admission.runId)).toEqual(admission.deadline);
  await expect(admitLegacyRun(f.db, admission.runId, new Date(admission.deadline.getTime() + 1))).rejects.toThrow(
    "deadline",
  );
  expect(await f.db.select().from(schema.legacyRunAdmissions)).toHaveLength(1);
});
test("disabled policy and computer brain cannot execute; broad existing scopes do not expose tools", async () => {
  const w = await prepare();
  await f.db.update(schema.legacyWorkflows).set({ enabled: false }).where(eq(schema.legacyWorkflows.id, w.id));
  await expect(startLegacyWorkflow(f.db, f.owner.id, f.org.id, w.id, "blocked", {})).rejects.toThrow("not_enabled");
  const run = await queueNative();
  await f.db
    .update(schema.legacyAgentPolicies)
    .set({ enabled: false })
    .where(eq(schema.legacyAgentPolicies.agentId, f.agent.id));
  await executeRun(f.jobDeps, run.id, { finalAttempt: true });
  expect((await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id)))[0]?.status).toBe("failed");
  await f.db
    .update(schema.legacyAgentPolicies)
    .set({ enabled: true })
    .where(eq(schema.legacyAgentPolicies.agentId, f.agent.id));
  await f.db.update(schema.agents).set({ brain: "codex" }).where(eq(schema.agents.id, f.agent.id));
  const computer = await queueNative();
  await expect(admitLegacyRun(f.db, computer.id)).rejects.toThrow("blocked");
  const ctx = {
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: computer.id,
    channelId: f.general.id,
    threadRootId: computer.threadRootId,
    triggerMessageId: computer.triggerMessageId,
  };
  if (!f.tools) throw new Error("No tools");
  expect(await f.tools.list(ctx)).toEqual([]);
  const call = await f.tools.invoke(ctx, {
    name: "remember",
    input: { content: "must not save" },
    toolUseId: "denied",
  });
  expect(call.type).toBe("result");
  if (call.type === "result") expect(call.output.isError).toBe(true);
  const params = { content: "Approved before migration", kind: "fact", basis: "person_said" };
  const [approval] = await f.db
    .insert(schema.approvals)
    .values({
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: computer.id,
      channelId: f.general.id,
      threadRootId: computer.threadRootId,
      toolUseId: "old-approval",
      tool: "remember",
      scope: "memory:write",
      params,
      title: "Save note",
      expiresAt: new Date(Date.now() + 60_000),
      status: "approved",
      ownerUserId: f.owner.id,
      actionHash: actionHash({ tool: "remember", scope: "memory:write", connectionId: null, params }),
    })
    .returning();
  if (!approval) throw new Error("Missing approval");
  expect((await f.tools.executeApproved(ctx, approval)).isError).toBe(true);
  expect(await f.db.select().from(schema.contextItems)).toHaveLength(0);
});

test("wall-clock deadline aborts a native provider stream and expired resume calls no provider", async () => {
  f = await setup({
    reply: () => ({ chunks: ['{"answer":"late"}'], hold: new Promise((resolve) => setTimeout(resolve, 1500)) }),
  });
  await f.db.insert(schema.legacyAgentPolicies).values({
    orgId: f.org.id,
    agentId: f.agent.id,
    ownerUserId: f.owner.id,
    enabled: true,
    historyCaptured: true,
    timeoutSeconds: 1,
    sourceDigest: "timeout-test",
  });
  const run = await queueNative();
  await executeRun(f.jobDeps, run.id, { finalAttempt: true });
  const [row] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
  expect(row?.status).not.toBe("done");
  expect(f.provider.calls).toHaveLength(1);
  await executeRun(f.jobDeps, run.id, { finalAttempt: true });
  expect(f.provider.calls).toHaveLength(1);
});
test("revoked permission prevents downstream dispatch and a different organization cannot start it", async () => {
  const w = await prepare();
  await expect(startLegacyWorkflow(f.db, f.owner.id, crypto.randomUUID(), w.id, "cross-org", {})).rejects.toThrow();
  const run = await startLegacyWorkflow(f.db, f.owner.id, f.org.id, w.id, "revoke", {});
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  const [first] = await f.db.select().from(schema.agentRuns);
  if (!first) throw new Error("No native run");
  await executeRun(f.jobDeps, first.id, { finalAttempt: true });
  await f.db
    .update(schema.legacyAgentPolicies)
    .set({ enabled: false })
    .where(eq(schema.legacyAgentPolicies.agentId, f.agent.id));
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(1);
  expect((await f.db.select().from(schema.legacyWorkflowRuns))[0]?.status).toBe("failed");
});

test("parallel native batch waits for every result before dispatching dependent conditional step", async () => {
  const w = await prepare();
  await f.db
    .update(schema.legacyWorkflows)
    .set({
      mode: "parallel",
      steps: [
        { id: "one", agentId: f.agent.id, inputs: { task: "one" }, dependsOn: [], condition: null },
        { id: "two", agentId: f.agent.id, inputs: { task: "two" }, dependsOn: [], condition: null },
        {
          id: "three",
          agentId: f.agent.id,
          inputs: { task: "three" },
          dependsOn: ["one", "two"],
          condition: { path: ["answer"], op: "===", value: "validated" },
        },
      ],
    })
    .where(eq(schema.legacyWorkflows.id, w.id));
  const run = await startLegacyWorkflow(f.db, f.owner.id, f.org.id, w.id, "parallel", {});
  await Promise.all([advanceLegacyWorkflow(f.db, f.org.id, run.id), advanceLegacyWorkflow(f.db, f.org.id, run.id)]);
  const natives = await f.db.select().from(schema.agentRuns);
  expect(natives).toHaveLength(2);
  const first = natives[0],
    second = natives[1];
  if (!first || !second) throw new Error("No parallel runs");
  await executeRun(f.jobDeps, second.id, { finalAttempt: true });
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(2);
  await executeRun(f.jobDeps, first.id, { finalAttempt: true });
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  const [parent] = await f.db.select().from(schema.legacyWorkflowRuns).where(eq(schema.legacyWorkflowRuns.id, run.id));
  const third = parent?.states[2]?.runId;
  if (!third) throw new Error("Missing dependent");
  await executeRun(f.jobDeps, third, { finalAttempt: true });
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  expect((await f.db.select().from(schema.legacyWorkflowRuns))[0]?.status).toBe("done");
});
test("historical usage consumes monthly cap and missing history blocks release", async () => {
  await prepare(1);
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  await f.db
    .update(schema.legacyAgentPolicies)
    .set({ priorRunsByMonth: { [month]: 1 } })
    .where(eq(schema.legacyAgentPolicies.agentId, f.agent.id));
  const run = await queueNative();
  await expect(admitLegacyRun(f.db, run.id)).rejects.toThrow("monthly_run_cap");
  await f.db
    .update(schema.legacyAgentPolicies)
    .set({ priorRunsByMonth: {}, historyCaptured: false })
    .where(eq(schema.legacyAgentPolicies.agentId, f.agent.id));
  await expect(admitLegacyRun(f.db, run.id)).rejects.toThrow("policy_blocked");
  expect(f.provider.calls).toHaveLength(0);
});
test("disabling workflow revokes already-queued native steps", async () => {
  const w = await prepare();
  const run = await startLegacyWorkflow(f.db, f.owner.id, f.org.id, w.id, "disable", {});
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  const [native] = await f.db.select().from(schema.agentRuns);
  if (!native) throw new Error("Missing native");
  await f.db.update(schema.legacyWorkflows).set({ enabled: false }).where(eq(schema.legacyWorkflows.id, w.id));
  await executeRun(f.jobDeps, native.id, { finalAttempt: true });
  expect(f.provider.calls).toHaveLength(0);
  expect((await f.db.select().from(schema.agentRuns))[0]?.error).toBe("legacy.workflow_revoked");
});

test("plain-text model reply fails the structured step without inventing output or running dependents", async () => {
  const w = await prepare(10, "I finished the task");
  const run = await startLegacyWorkflow(f.db, f.owner.id, f.org.id, w.id, "invalid-output", {});
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  const [native] = await f.db.select().from(schema.agentRuns);
  if (!native) throw new Error("Missing native");
  await executeRun(f.jobDeps, native.id, { finalAttempt: true });
  await advanceLegacyWorkflow(f.db, f.org.id, run.id);
  const [parent] = await f.db.select().from(schema.legacyWorkflowRuns);
  expect(parent?.status).toBe("failed");
  expect(parent?.states.map((s) => s.status)).toEqual(["failed", "blocked"]);
  expect(await f.db.select().from(schema.agentRuns)).toHaveLength(1);
});
