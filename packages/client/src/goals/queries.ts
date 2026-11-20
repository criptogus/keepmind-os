import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../api/context";
import { keys } from "../api/keys";
import type { GoalInput, GoalPatch, GoalStatus } from "./types";

/** The Goals page's list; `status` narrows it (proposed waits for a person). */
export function useGoals(orgId: string, status?: GoalStatus) {
  const api = useApi();
  return useQuery({
    queryKey: [...keys.goals(orgId), status ?? "all"],
    queryFn: () => api.goals.list(orgId, status),
    staleTime: 15_000,
  });
}

export function useCreateGoal(orgId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GoalInput) => api.goals.create(orgId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.goals(orgId) }),
  });
}

export function useUpdateGoal(orgId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, patch }: { goalId: string; patch: GoalPatch }) => api.goals.update(orgId, goalId, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.goals(orgId) }),
  });
}
