import { and, type Database, desc, type Executor, eq, schema } from "@keepmind/db";
import { recordAudit } from "./audit";
import { ConflictError, ValidationError } from "./errors";
import { can, getMembership, requireActiveMembership } from "./organizations";
import type { ToolDefinition, ToolOutput, ToolSource } from "./tools/types";

const { agents, goals } = schema;

export type Goal = typeof goals.$inferSelect;
export const GOAL_PERIODS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];
export const GOAL_STATUSES = ["proposed", "active", "paused", "achieved", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const isGoalPeriod = (v: unknown): v is GoalPeriod => GOAL_PERIODS.includes(v as GoalPeriod);
export const isGoalStatus = (v: unknown): v is GoalStatus => GOAL_STATUSES.includes(v as GoalStatus);

/** A goal with its owner agent's names for the apps. */
export interface GoalView extends Goal {
  owner: { id: string; handle: string; name: string } | null;
}

const GOAL_COLS = {
  id: goals.id,
  orgId: goals.orgId,
  title: goals.title,
  metric: goals.metric,
  target: goals.target,
  current: goals.current,
  unit: goals.unit,
  period: goals.period,
  ownerAgentId: goals.ownerAgentId,
  status: goals.status,
  progressNote: goals.progressNote,
  createdByUserId: goals.createdByUserId,
  createdByAgentId: goals.createdByAgentId,
  createdAt: goals.createdAt,
  updatedAt: goals.updatedAt,
};

/** Every goal of the workspace, newest first; `status` narrows to one state. */
export async function listGoals(db: Executor, orgId: string, status?: GoalStatus): Promise<GoalView[]> {
  const rows = await db
    .select({ ...GOAL_COLS, ownerHandle: agents.handle, ownerName: agents.name })
    .from(goals)
    .leftJoin(agents, eq(agents.id, goals.ownerAgentId))
    .where(and(eq(goals.orgId, orgId), status ? eq(goals.status, status) : undefined))
    .orderBy(desc(goals.createdAt));
  return rows.map(({ ownerHandle, ownerName, ...g }) => ({
    ...g,
    owner: g.ownerAgentId ? { id: g.ownerAgentId, handle: ownerHandle ?? "", name: ownerName ?? "" } : null,
  }));
}

export async function getGoal(db: Executor, orgId: string, id: string): Promise<GoalView | null> {
  const [row] = await db
    .select({ ...GOAL_COLS, ownerHandle: agents.handle, ownerName: agents.name })
    .from(goals)
    .leftJoin(agents, eq(agents.id, goals.ownerAgentId))
    .where(and(eq(goals.orgId, orgId), eq(goals.id, id)));
  if (!row) return null;
  const { ownerHandle, ownerName, ...g } = row;
  return {
    ...g,
    owner: g.ownerAgentId ? { id: g.ownerAgentId, handle: ownerHandle ?? "", name: ownerName ?? "" } : null,
  };
}

export interface GoalInput {
  title: string;
  metric?: string;
  /** Null clears it (a goal can be re-scoped from a number to a judgment call). */
  target?: number | null;
  current?: number;
  unit?: string;
  period?: GoalPeriod;
  ownerAgentId?: string | null;
  status?: GoalStatus;
  progressNote?: string;
}

async function checkGoalFields(db: Executor, orgId: string, input: Partial<GoalInput>) {
  if (input.period !== undefined && !isGoalPeriod(input.period)) throw new ValidationError("Unknown period");
  if (input.status !== undefined && !isGoalStatus(input.status)) throw new ValidationError("Unknown status");
  if (input.target != null && (!Number.isFinite(input.target) || input.target < 0))
    throw new ValidationError("Target must be a non-negative number");
  if (input.current != null && (!Number.isFinite(input.current) || input.current < 0))
    throw new ValidationError("Current must be a non-negative number");
  if (input.ownerAgentId) {
    const [owner] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.orgId, orgId), eq(agents.id, input.ownerAgentId)));
    if (!owner) throw new ValidationError("Owner agent not found in this workspace");
  }
}

/**
 * Creates a goal. A person sets it `active` (the default for them); an agent's proposal lands
 * `proposed` until a person activates it — the plan-then-approve flow the company template
 * expects. Returns the row.
 */
export async function createGoal(
  db: Database,
  input: GoalInput & {
    orgId: string;
    createdByUserId?: string | null;
    createdByAgentId?: string | null;
  },
): Promise<Goal> {
  await checkGoalFields(db, input.orgId, input);
  const byAgent = input.createdByAgentId != null;
  const [row] = await db
    .insert(goals)
    .values({
      orgId: input.orgId,
      title: input.title.trim(),
      metric: input.metric?.trim() ?? "",
      target: input.target ?? null,
      current: input.current ?? 0,
      unit: input.unit?.trim() ?? "",
      period: input.period ?? "monthly",
      ownerAgentId: input.ownerAgentId ?? null,
      status: input.status ?? (byAgent ? "proposed" : "active"),
      progressNote: input.progressNote?.trim() ?? "",
      createdByUserId: input.createdByUserId ?? null,
      createdByAgentId: input.createdByAgentId ?? null,
    })
    .returning();
  if (!row) throw new Error("goal insert returned nothing");
  await recordAudit(db, {
    orgId: input.orgId,
    actor: input.createdByAgentId
      ? { type: "agent", id: input.createdByAgentId }
      : { type: "person", id: input.createdByUserId ?? null },
    action: "goal.create",
    target: { type: "goal", id: row.id },
    details: { title: row.title, status: row.status },
  }).catch(() => {});
  return row;
}

/** Changes a goal; `undefined` fields stay, `target: null` clears the number. Null when missing. */
export async function updateGoal(
  db: Database,
  orgId: string,
  id: string,
  patch: Partial<GoalInput>,
  actor: { userId?: string | null; agentId?: string | null } = {},
): Promise<Goal | null> {
  await checkGoalFields(db, orgId, patch);
  const [row] = await db
    .update(goals)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.metric !== undefined ? { metric: patch.metric.trim() } : {}),
      ...(patch.target !== undefined ? { target: patch.target } : {}),
      ...(patch.current !== undefined ? { current: patch.current } : {}),
      ...(patch.unit !== undefined ? { unit: patch.unit.trim() } : {}),
      ...(patch.period !== undefined ? { period: patch.period } : {}),
      ...(patch.ownerAgentId !== undefined ? { ownerAgentId: patch.ownerAgentId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.progressNote !== undefined ? { progressNote: patch.progressNote.trim() } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(goals.orgId, orgId), eq(goals.id, id)))
    .returning();
  if (!row) return null;
  await recordAudit(db, {
    orgId,
    actor: actor.agentId ? { type: "agent", id: actor.agentId } : { type: "person", id: actor.userId ?? null },
    action: "goal.update",
    target: { type: "goal", id: row.id },
    details: { status: row.status, current: row.current },
  }).catch(() => {});
  return row;
}

/** Who may change goals in the workspace UI: anyone who can assign work. */
export async function mayWriteGoals(db: Executor, userId: string, orgId: string) {
  const membership = await getMembership(db, userId, orgId);
  return membership != null && (can(membership, "assign_work") || can(membership, "administrator"));
}

export async function requireGoalWriter(db: Executor, userId: string, orgId: string) {
  const membership = await requireActiveMembership(db, userId, orgId);
  if (!can(membership, "assign_work") && !can(membership, "administrator"))
    throw new ConflictError("Your role can't set goals here", "goal.forbidden");
  return membership;
}

/* ---------- The agents' side: propose and track ---------- */

export const LIST_GOALS_TOOL = "list_goals";
export const PROPOSE_GOAL_TOOL = "propose_goal";
export const UPDATE_GOAL_TOOL = "update_goal";

const GOAL_STATUS_TEXT: Record<GoalStatus, string> = {
  proposed: "proposed (waiting for a person to activate)",
  active: "active",
  paused: "paused",
  achieved: "achieved",
  dropped: "dropped",
};

const goalLine = (g: GoalView) =>
  `- ${g.id.slice(0, 8)} "${g.title}" — ${g.current}${g.unit ? ` ${g.unit}` : ""}` +
  `${g.target != null ? ` of ${g.target}` : ""} (${g.period}, ${GOAL_STATUS_TEXT[g.status as GoalStatus] ?? g.status})` +
  `${g.owner ? `, owner @${g.owner.handle}` : ""}${g.progressNote ? ` — ${g.progressNote}` : ""}`;

/**
 * `list_goals`, `propose_goal`, `update_goal`: how the leadership tracks OKRs. An agent's
 * proposal waits as `proposed` for a person; on an active goal it moves `current` and leaves
 * the review `progressNote` — status changes stay with people.
 */
export function createGoalToolSource(): ToolSource {
  const list: ToolDefinition = {
    name: LIST_GOALS_TOOL,
    description:
      "List the workspace's goals (OKRs): title, metric, current of target, period, status and owner. Call before proposing or updating one.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...GOAL_STATUSES], description: "Only goals in this state." },
      },
      additionalProperties: false,
    },
    describe: () => ({ title: "List goals" }),
    async execute(input, ctx) {
      const status = typeof input.status === "string" && isGoalStatus(input.status) ? input.status : undefined;
      const rows = await listGoals(ctx.db, ctx.orgId, status);
      return {
        content: rows.length ? rows.map(goalLine).join("\n") : "No goals yet.",
      } satisfies ToolOutput;
    },
  };

  const propose: ToolDefinition = {
    name: PROPOSE_GOAL_TOOL,
    description:
      "Propose a goal (OKR) for the workspace: a metric, a target and a period, owned by a leader. It lands as 'proposed' — a person activates it. Use for company or team targets (leads per month, uptime, hires), not one-off tasks.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short name, e.g. '100 qualified leads this month'" },
        metric: { type: "string", description: "What is measured and how" },
        target: { type: "number", description: "The number that means done" },
        unit: { type: "string", description: "leads, %, hours…" },
        period: { type: "string", enum: [...GOAL_PERIODS] },
        owner: { type: "string", description: "Handle of the leader accountable (optional)" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Propose goal: ${String(input.title ?? "").slice(0, 60)}` }),
    async execute(input, ctx) {
      let ownerAgentId: string | null = null;
      if (typeof input.owner === "string" && input.owner.trim()) {
        const handle = input.owner.trim().replace(/^@/, "").toLowerCase();
        const [owner] = await ctx.db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.orgId, ctx.orgId), eq(agents.handle, handle)));
        if (!owner) return { content: `No agent @${handle} in this workspace.`, isError: true };
        ownerAgentId = owner.id;
      }
      const row = await createGoal(ctx.db, {
        orgId: ctx.orgId,
        title: String(input.title ?? "").slice(0, 300),
        metric: typeof input.metric === "string" ? input.metric.slice(0, 500) : "",
        target: typeof input.target === "number" ? input.target : null,
        unit: typeof input.unit === "string" ? input.unit.slice(0, 40) : "",
        period: isGoalPeriod(input.period) ? input.period : "monthly",
        ownerAgentId,
        createdByAgentId: ctx.agentId,
      });
      return {
        content: `Proposed "${row.title}" (${row.id.slice(0, 8)}) — a person activates it.`,
        data: { goalId: row.id },
      } satisfies ToolOutput;
    },
  };

  const update: ToolDefinition = {
    name: UPDATE_GOAL_TOOL,
    description:
      "Move an active goal: its current value and a review note (what's working, what's not, the plan). Find the goal with list_goals first. Status changes are for people.",
    scope: "",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The goal's id (or its first 8 chars, from list_goals)" },
        current: { type: "number", description: "Where it stands now" },
        note: { type: "string", description: "The review line: progress, blocker, next step" },
      },
      required: ["goal"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: `Update goal ${String(input.goal ?? "").slice(0, 12)}` }),
    async execute(input, ctx) {
      const ref = String(input.goal ?? "").trim();
      const rows = await listGoals(ctx.db, ctx.orgId);
      const goal = rows.find((g) => g.id === ref || g.id.startsWith(ref));
      if (!goal) return { content: `No goal matches "${ref}". Call list_goals first.`, isError: true };
      if (goal.status !== "active")
        return { content: `"${goal.title}" is ${goal.status} — only active goals take updates.`, isError: true };
      const row = await updateGoal(
        ctx.db,
        ctx.orgId,
        goal.id,
        {
          ...(typeof input.current === "number" ? { current: input.current } : {}),
          ...(typeof input.note === "string" ? { progressNote: input.note.slice(0, 500) } : {}),
        },
        { agentId: ctx.agentId },
      );
      if (!row) return { content: "Goal not found.", isError: true };
      const pct = row.target ? Math.round((row.current / row.target) * 100) : null;
      return {
        content: `"${row.title}": ${row.current}${row.unit ? ` ${row.unit}` : ""}${pct != null ? ` (${pct}%)` : ""}${row.progressNote ? ` — ${row.progressNote}` : ""}`,
        data: { goalId: row.id },
      } satisfies ToolOutput;
    },
  };

  return { name: "goals", tools: async () => [list, propose, update] };
}
