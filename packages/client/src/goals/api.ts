import { enc, type Requester } from "../api/http";
import type { Goal, GoalInput, GoalPatch, GoalStatus } from "./types";

/** The workspace's goals (OKRs), `/api/app/organizations/{orgId}/goals`. */
export interface GoalsApi {
  list(orgId: string, status?: GoalStatus): Promise<{ goals: Goal[] }>;
  create(orgId: string, input: GoalInput): Promise<Goal>;
  update(orgId: string, goalId: string, patch: GoalPatch): Promise<Goal>;
}

const org = (orgId: string) => `/api/app/organizations/${enc(orgId)}`;

export function createGoalsApi(request: Requester): GoalsApi {
  return {
    list: (orgId, status) => request<{ goals: Goal[] }>(`${org(orgId)}/goals`, { query: status ? { status } : {} }),
    create: (orgId, input) => request<Goal>(`${org(orgId)}/goals`, { method: "POST", json: input }),
    update: (orgId, goalId, patch) =>
      request<Goal>(`${org(orgId)}/goals/${enc(goalId)}`, { method: "PATCH", json: patch }),
  };
}
