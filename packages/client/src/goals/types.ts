/** A workspace goal (OKR): mirror of the server's `GoalView` (`/api/app/organizations/{orgId}/goals`). */
export type GoalPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
export type GoalStatus = "proposed" | "active" | "paused" | "achieved" | "dropped";

export const GOAL_PERIODS: readonly GoalPeriod[] = ["daily", "weekly", "monthly", "quarterly", "yearly"];
export const GOAL_STATUSES: readonly GoalStatus[] = ["proposed", "active", "paused", "achieved", "dropped"];

export interface GoalOwner {
  id: string;
  handle: string;
  name: string;
}

export interface Goal {
  id: string;
  orgId: string;
  title: string;
  metric: string;
  target: number | null;
  current: number;
  unit: string;
  period: GoalPeriod;
  ownerAgentId: string | null;
  status: GoalStatus;
  progressNote: string;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: GoalOwner | null;
}

export interface GoalInput {
  title: string;
  metric?: string;
  target?: number | null;
  current?: number;
  unit?: string;
  period?: GoalPeriod;
  ownerAgentId?: string | null;
  status?: GoalStatus;
  progressNote?: string;
}

export type GoalPatch = Partial<GoalInput>;

/** 0–100 when the goal has a numeric target, else null (a judgment-call goal shows no bar). */
export function goalPercent(g: Pick<Goal, "current" | "target">): number | null {
  if (g.target == null || g.target <= 0) return null;
  return Math.min(100, Math.round((g.current / g.target) * 100));
}
