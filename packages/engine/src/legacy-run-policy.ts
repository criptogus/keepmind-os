import { and, type Database, type Executor, eq, gte, schema } from "@keepmind/db";

/** Applies to every native run of a migrated agent, including chat, schedules and retries. */
export async function admitLegacyRun(db: Database, runId: string, now = new Date()): Promise<Date | null> {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    if (!run || ["done", "failed", "canceled"].includes(run.status)) return null;
    const [policy] = await tx
      .select()
      .from(schema.legacyAgentPolicies)
      .where(eq(schema.legacyAgentPolicies.agentId, run.agentId))
      .for("update");
    if (!policy) return null;
    const [trigger] = await tx
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.id, run.triggerMessageId), eq(schema.messages.orgId, run.orgId)));
    if (typeof trigger?.meta.legacyWorkflowRunId === "string") {
      const [parent] = await tx
        .select()
        .from(schema.legacyWorkflowRuns)
        .where(
          and(
            eq(schema.legacyWorkflowRuns.id, trigger.meta.legacyWorkflowRunId),
            eq(schema.legacyWorkflowRuns.orgId, run.orgId),
          ),
        );
      const [workflow] = parent
        ? await tx
            .select()
            .from(schema.legacyWorkflows)
            .where(and(eq(schema.legacyWorkflows.id, parent.workflowId), eq(schema.legacyWorkflows.orgId, run.orgId)))
        : [];
      if (
        parent?.status !== "running" ||
        !workflow?.enabled ||
        !parent.states.some((s) => s.runId === runId) ||
        parent.actorId !== policy.ownerUserId
      )
        throw new Error("legacy.workflow_revoked");
    }
    const [agent] = await tx
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, run.agentId), eq(schema.agents.orgId, run.orgId)));
    const [message] = await tx
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.id, run.triggerMessageId), eq(schema.messages.orgId, run.orgId)));
    const [member] = await tx
      .select()
      .from(schema.organizationMembers)
      .where(
        and(eq(schema.organizationMembers.orgId, run.orgId), eq(schema.organizationMembers.userId, policy.ownerUserId)),
      );
    if (
      !policy.enabled ||
      !policy.historyCaptured ||
      policy.orgId !== run.orgId ||
      !agent ||
      agent.operatorHoldAt ||
      agent.archivedAt ||
      agent.brain !== "model" ||
      agent.ownerUserId !== policy.ownerUserId ||
      !member ||
      message?.authorUserId !== policy.ownerUserId ||
      message.authorType !== "person"
    )
      throw new Error("legacy.policy_blocked");
    if (
      !Number.isInteger(policy.timeoutSeconds) ||
      policy.timeoutSeconds < 1 ||
      policy.timeoutSeconds > 86400 ||
      (policy.monthlyRunCap !== null && (!Number.isInteger(policy.monthlyRunCap) || policy.monthlyRunCap < 0))
    )
      throw new Error("legacy.invalid_limits");
    const [prior] = await tx
      .select()
      .from(schema.legacyRunAdmissions)
      .where(eq(schema.legacyRunAdmissions.runId, runId));
    if (prior) {
      const tighter = new Date(
        Math.min(prior.deadline.getTime(), prior.admittedAt.getTime() + policy.timeoutSeconds * 1000),
      );
      if (tighter.getTime() !== prior.deadline.getTime())
        await tx
          .update(schema.legacyRunAdmissions)
          .set({ deadline: tighter })
          .where(eq(schema.legacyRunAdmissions.runId, runId));
      prior.deadline = tighter;
      if (prior.orgId !== run.orgId || prior.agentId !== run.agentId || prior.deadline <= now)
        throw new Error("legacy.deadline_exceeded");
      return prior.deadline;
    }
    if (policy.monthlyRunCap !== null) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const admissions = await tx
        .select({ id: schema.legacyRunAdmissions.runId })
        .from(schema.legacyRunAdmissions)
        .where(
          and(eq(schema.legacyRunAdmissions.agentId, run.agentId), gte(schema.legacyRunAdmissions.admittedAt, month)),
        );
      const carried = policy.priorRunsByMonth[month.toISOString().slice(0, 10)] ?? 0;
      if (!Number.isSafeInteger(carried) || carried < 0) throw new Error("legacy.invalid_usage_history");
      if (admissions.length + carried >= policy.monthlyRunCap) throw new Error("legacy.monthly_run_cap");
    }
    const deadline = new Date(now.getTime() + policy.timeoutSeconds * 1000);
    await tx
      .insert(schema.legacyRunAdmissions)
      .values({ runId, orgId: run.orgId, agentId: run.agentId, admittedAt: now, deadline });
    return deadline;
  });
}

/** No file/network/code tools in the first adapter, even if a scope or old approval grants them. */
export async function legacyToolsBlocked(db: Executor, _orgId: string, agentId: string) {
  const [policy] = await db
    .select({ id: schema.legacyAgentPolicies.agentId })
    .from(schema.legacyAgentPolicies)
    .where(eq(schema.legacyAgentPolicies.agentId, agentId));
  return Boolean(policy);
}
