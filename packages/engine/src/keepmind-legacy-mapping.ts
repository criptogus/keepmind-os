import type { KeepMindLegacySnapshot } from "./keepmind-legacy";

const record = (value: unknown): Record<string, unknown> => {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid legacy mapping object");
  return parsed as Record<string, unknown>;
};
const id = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("Missing mapping reference");
  return value;
};
const ids = (value: unknown): string[] => {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error("Invalid mapping references");
  return parsed.map(id);
};
const optionalLimit = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid legacy limit");
  return value;
};
export interface LegacyCondition {
  path: string[];
  op: string;
  value: unknown;
}
export function parseLegacyCondition(source: string): LegacyCondition {
  const match = source.match(/^\s*([\w.]+)\s*(===|!==|>=|<=|>|<)\s*(.+?)\s*$/);
  if (!match) throw new Error("Unsupported legacy condition");
  const path = (match[1] as string).split(".");
  if (path.some((p) => !p || ["__proto__", "constructor", "prototype"].includes(p)))
    throw new Error("Unsafe condition path");
  const raw = match[3] as string;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    if (!/^'[^']*'$/.test(raw)) throw new Error("Condition requires a literal");
    value = raw.slice(1, -1);
  }
  return { path, op: match[2] as string, value };
}
export function conditionHolds(condition: LegacyCondition, context: Record<string, unknown>) {
  const left = condition.path.reduce<unknown>(
    (v, k) => (v && typeof v === "object" && Object.hasOwn(v, k) ? (v as Record<string, unknown>)[k] : undefined),
    context,
  );
  if (condition.op === "===") return left === condition.value;
  if (condition.op === "!==") return left !== condition.value;
  if (typeof left !== "number" || typeof condition.value !== "number")
    throw new Error("Ordered condition requires numbers");
  switch (condition.op) {
    case ">":
      return left > condition.value;
    case "<":
      return left < condition.value;
    case ">=":
      return left >= condition.value;
    case "<=":
      return left <= condition.value;
    default:
      throw new Error("Invalid condition operator");
  }
}
export interface MappedLegacyWorkflow {
  teamId: string;
  mode: "sequential" | "parallel" | "conditional";
  state: "draft";
  steps: {
    id: string;
    agentId: string;
    inputs: Record<string, unknown>;
    dependsOn: string[];
    condition: LegacyCondition | null;
  }[];
}

/** Structural equivalence, never model-generated instructions or an executable script. */
export function mapLegacyWorkflows(snapshot: KeepMindLegacySnapshot): MappedLegacyWorkflow[] {
  const agents = new Set(snapshot.agents.map((a) => id(a.id)));
  return snapshot.teams.map((team) => {
    const workflow = record(team.workflow);
    const members = new Set(ids(team.agent_ids));
    if (
      !["sequential", "parallel", "conditional"].includes(String(workflow.executionMode)) ||
      !Array.isArray(workflow.steps)
    )
      throw new Error("Unsupported workflow mode or steps");
    const steps = workflow.steps.map((value) => {
      const step = record(value);
      const agentId = id(step.agentId);
      if (!agents.has(agentId) || !members.has(agentId)) throw new Error("Workflow agent outside team");
      if (step.condition !== undefined && typeof step.condition !== "string")
        throw new Error("Invalid workflow condition");
      return {
        id: id(step.id),
        agentId,
        inputs: record(step.inputs),
        dependsOn: ids(step.dependsOn ?? []),
        condition: step.condition ? parseLegacyCondition(step.condition) : null,
      };
    });
    const byId = new Map(steps.map((s) => [s.id, s]));
    if (byId.size !== steps.length) throw new Error("Duplicate workflow step");
    const done = new Set<string>(),
      visiting = new Set<string>();
    const visit = (key: string) => {
      const step = byId.get(key);
      if (!step) throw new Error("Missing workflow dependency");
      if (visiting.has(key)) throw new Error("Cyclic workflow dependency");
      if (done.has(key)) return;
      visiting.add(key);
      step.dependsOn.forEach(visit);
      visiting.delete(key);
      done.add(key);
    };
    for (const step of steps) visit(step.id);
    return { teamId: id(team.id), mode: workflow.executionMode as MappedLegacyWorkflow["mode"], state: "draft", steps };
  });
}

/** Offline trace only. Supplied mock outputs replace agent execution; no callbacks, tools or model calls. */
export function simulateLegacyWorkflow(
  workflow: MappedLegacyWorkflow,
  input: Record<string, unknown>,
  mocks: Record<string, { failed?: boolean; output?: Record<string, unknown> }>,
) {
  const context = { ...input };
  const done = new Set<string>(),
    failed = new Set<string>();
  const trace: {
    stepId: string;
    status: "completed" | "failed" | "skipped" | "blocked";
    input?: Record<string, unknown>;
  }[] = [];
  while (done.size < workflow.steps.length) {
    const ready = workflow.steps.filter((s) => !done.has(s.id) && s.dependsOn.every((d) => done.has(d)));
    const batch = workflow.mode === "parallel" ? ready : ready.slice(0, 1);
    if (!batch.length) throw new Error("Invalid workflow graph");
    const outputs: Record<string, unknown>[] = [];
    for (const step of batch) {
      let status: (typeof trace)[number]["status"] = "completed";
      let stepInput: Record<string, unknown> | undefined;
      try {
        if (step.dependsOn.some((d) => failed.has(d))) status = "blocked";
        else if (step.condition && !conditionHolds(step.condition, context)) status = "skipped";
        else {
          stepInput = { ...context, ...step.inputs };
          if (!Object.hasOwn(mocks, step.id) || mocks[step.id]?.failed) status = "failed";
          else outputs.push(mocks[step.id]?.output ?? {});
        }
      } catch {
        status = "failed";
      }
      if (status !== "completed") failed.add(step.id);
      done.add(step.id);
      trace.push({ stepId: step.id, status, ...(stepInput ? { input: stepInput } : {}) });
    }
    // Spread avoids prototype mutation and retains deterministic source-order conflict resolution.
    for (const output of outputs)
      for (const [key, value] of Object.entries(output))
        Object.defineProperty(context, key, { value, enumerable: true, writable: true, configurable: true });
    if (workflow.mode === "sequential" && batch.some((s) => failed.has(s.id))) break;
  }
  return {
    trace,
    context,
    notRun: workflow.steps.filter((s) => !done.has(s.id)).map((s) => s.id),
    simulated: true as const,
  };
}

/** Candidate API names are NOT grants: each needs resource/identity and approval equivalence. */
const TOOL_CANDIDATES: Record<string, { target: string; boundary: string }> = {
  create_agent: { target: "create_agent", boundary: "app-management permission and actor identity" },
  app_channel_create: { target: "create_channel", boundary: "app-management permission and private membership" },
  app_automation_create: {
    target: "create_routine",
    boundary: "schedule:write plus inactive routine and actor identity",
  },
  app_automations_list: { target: "list_routines", boundary: "native routine visibility" },
  app_automation_delete: { target: "delete_routine", boundary: "schedule:write plus approval and ownership" },
  personalbrain_search: {
    target: "search_context",
    boundary: "different store: private legacy memory must not become shared context",
  },
  secondbrain_search: { target: "sb_search", boundary: "external vault bridge and separate connection authorization" },
};

export function mapLegacyPermissions(snapshot: KeepMindLegacySnapshot) {
  return snapshot.agents.map((agent) => {
    const permissions = record(agent.permissions),
      config = record(agent.config);
    const flags = ["canAccessNetwork", "canAccessFileSystem", "canExecuteCode"] as const;
    for (const flag of flags)
      if (typeof permissions[flag] !== "boolean") throw new Error("Missing or invalid legacy permission");
    if (
      config.monthlyRunCap !== undefined &&
      (typeof config.monthlyRunCap !== "number" ||
        !Number.isSafeInteger(config.monthlyRunCap) ||
        config.monthlyRunCap < 1 ||
        config.monthlyRunCap > 100_000)
    )
      throw new Error("Invalid legacy monthly run cap");
    const usd = optionalLimit(config.monthlyBudgetUsd);
    const nano = usd === null ? null : Math.floor(usd * 1e9);
    if (nano !== null && !Number.isSafeInteger(nano)) throw new Error("Legacy budget exceeds exact native range");
    const tools = config.tools ?? [];
    if (!Array.isArray(tools)) throw new Error("Invalid legacy tool assignments");
    return {
      agentId: id(agent.id),
      state: "held" as const,
      grantedScopes: [] as string[],
      controls: flags.map((flag) => ({
        source: flag,
        allowed: permissions[flag] as boolean,
        status: permissions[flag] ? "requires_tool_mapping" : "denied_while_held",
      })),
      monthlyBudgetNanoUsd: nano,
      budgetStatus: nano === null ? "unspecified_no_default_inference" : "mapped_conservatively",
      monthlyRunCap: optionalLimit(config.monthlyRunCap) ?? 1000,
      declaredMaxExecutionTime: optionalLimit(permissions.maxExecutionTime),
      // Legacy execution uses config.executionTimeoutSeconds, not permissions.maxExecutionTime.
      effectiveTimeoutSeconds: optionalLimit(config.executionTimeoutSeconds) ?? 300,
      audience: "owner" as const,
      sharingRequiresIdentityMapping: agent.is_shared === 1 || agent.is_shared === true,
      toolNames: tools.map((t) => id(record(t).name)),
      tools: tools.map((t) => {
        const name = id(record(t).name);
        const candidate = TOOL_CANDIDATES[name];
        return {
          source: name,
          candidate: candidate?.target ?? null,
          status: candidate ? "candidate_requires_review" : "no_equivalent_verified",
          boundary: candidate?.boundary ?? "keep blocked until a resource-specific adapter exists",
          granted: false,
        };
      }),
      computerAccess: typeof config.computerAccess === "string" ? config.computerAccess : null,
      autoSkills: typeof config.autoSkills === "boolean" ? config.autoSkills : null,
      runtimeControls: {
        admission: "native_monthly_cap",
        deadline: "persistent_wall_clock",
        historyRequired: true,
        tools: "text_only",
      },
      blockers: [
        "model_and_credential_mapping",
        "tool_and_resource_boundaries",
        "governance_mapping",
        ...(agent.is_shared ? ["sharing_identity_mapping"] : []),
      ],
    };
  });
}
