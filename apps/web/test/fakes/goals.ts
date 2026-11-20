/**
 * Test fake — workspace goals ("Metas", OKR).
 * Mirrors `GET/POST/PATCH /api/app/organizations/{orgId}/goals[/{goalId}]`:
 * the list answers `state.goals`, a create appends one (owner looked up in
 * `state.agents` by `ownerAgentId`), a patch merges and bumps `updatedAt`.
 */
import type { ApiClient, Goal, GoalInput, GoalPatch } from "@keepmind/client";
import type { FakeState } from "../fake-api";
import { clone } from "./context";

const ownerOf = (state: FakeState, goal: Goal): Goal["owner"] => {
  if (!goal.ownerAgentId) return null;
  const agent = state.agents.find((a) => a.id === goal.ownerAgentId);
  return agent ? { id: agent.id, handle: agent.handle, name: agent.name } : null;
};

export function createFakeGoals(
  state: FakeState,
  log?: (method: string, ...args: unknown[]) => void,
): ApiClient["goals"] {
  const goals = () => (state.goals ??= []);
  const view = (goal: Goal): Goal => ({ ...clone(goal), owner: ownerOf(state, goal) });
  return {
    list: async (_orgId, status) => {
      const all = goals();
      return { goals: clone(status ? all.filter((g) => g.status === status) : all).map((g) => view(g)) };
    },
    create: async (orgId, input: GoalInput) => {
      log?.("goals.create", orgId, input);
      const now = new Date().toISOString();
      const goal: Goal = {
        id: crypto.randomUUID(),
        orgId,
        title: input.title,
        metric: input.metric ?? "",
        target: input.target ?? null,
        current: input.current ?? 0,
        unit: input.unit ?? "",
        period: input.period ?? "monthly",
        ownerAgentId: input.ownerAgentId ?? null,
        status: input.status ?? "active",
        progressNote: input.progressNote ?? "",
        createdByUserId: null,
        createdByAgentId: null,
        createdAt: now,
        updatedAt: now,
        owner: null,
      };
      goals().push(goal);
      return view(goal);
    },
    update: async (orgId, goalId, patch: GoalPatch) => {
      log?.("goals.update", orgId, goalId, patch);
      const goal = goals().find((g) => g.id === goalId);
      if (!goal) throw new Error(`no goal ${goalId}`);
      Object.assign(goal, patch, { updatedAt: new Date().toISOString() });
      return view(goal);
    },
  };
}
