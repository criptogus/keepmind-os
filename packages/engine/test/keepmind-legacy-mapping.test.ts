import { expect, test } from "bun:test";
import type { KeepMindLegacySnapshot } from "../src/keepmind-legacy";
import {
  mapLegacyPermissions,
  mapLegacyWorkflows,
  parseLegacyCondition,
  simulateLegacyWorkflow,
} from "../src/keepmind-legacy-mapping";

const snapshot = (mode = "parallel", steps: unknown[] = []): KeepMindLegacySnapshot => ({
  sourceRef: "synthetic",
  timezone: "America/Sao_Paulo",
  skills: [],
  memory_items: [],
  triggers: [],
  agents: [
    {
      id: "a",
      is_shared: 1,
      config: {
        tools: [{ name: "file_read", config: { secret: "never-copied" } }],
        monthlyBudgetUsd: 1.25,
        monthlyRunCap: 10,
      },
      permissions: { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 120 },
    },
  ],
  teams: [{ id: "t", agent_ids: ["a"], workflow: { executionMode: mode, steps } }],
});
const step = (id: string, extra = {}) => ({ id, agentId: "a", inputs: {}, ...extra });
function workflow(mode: string, steps: unknown[]) {
  const [w] = mapLegacyWorkflows(snapshot(mode, steps));
  if (!w) throw new Error("Missing workflow");
  return w;
}
test("permission mapping preserves limits but never converts broad legacy flags to grants", () => {
  const s = snapshot();
  const [p] = mapLegacyPermissions(s);
  expect(p?.monthlyBudgetNanoUsd).toBe(1_250_000_000);
  expect(p?.grantedScopes).toEqual([]);
  expect(p?.audience).toBe("owner");
  expect(p?.effectiveTimeoutSeconds).toBe(300);
  expect(p?.declaredMaxExecutionTime).toBe(120);
  expect(p?.sharingRequiresIdentityMapping).toBe(true);
  expect(p?.runtimeControls.admission).toBe("native_monthly_cap");
  expect(JSON.stringify(p)).not.toContain("never-copied");
  (s.agents[0] as Record<string, unknown>).permissions = {};
  expect(() => mapLegacyPermissions(s)).toThrow("permission");
});
test("invalid budgets are refused; zero remains an explicit zero ceiling", () => {
  const s = snapshot();
  const a = s.agents[0] as Record<string, unknown>;
  a.config = { monthlyBudgetUsd: 0 };
  expect(mapLegacyPermissions(s)[0]?.monthlyBudgetNanoUsd).toBe(0);
  a.config = { monthlyBudgetUsd: -1 };
  expect(() => mapLegacyPermissions(s)).toThrow("limit");
  a.config = { monthlyBudgetUsd: 1e20 };
  expect(() => mapLegacyPermissions(s)).toThrow("range");
});
test("parallel batches retain shared context and deterministic output merge; dependencies wait", () => {
  const w = workflow("parallel", [
    step("one"),
    step("two"),
    step("three", { dependsOn: ["one", "two"], inputs: { overridden: true } }),
  ]);
  const run = simulateLegacyWorkflow(
    w,
    { original: true },
    { one: { output: { winner: "one" } }, two: { output: { winner: "two" } }, three: { output: {} } },
  );
  expect(run.trace[1]?.input).toEqual({ original: true });
  expect(run.trace[2]?.input).toEqual({ original: true, winner: "two", overridden: true });
  expect(run.notRun).toEqual([]);
});
test("sequential failure stops later steps; conditional skip blocks dependents but keeps independent steps", () => {
  const seq = simulateLegacyWorkflow(
    workflow("sequential", [step("one"), step("two")]),
    {},
    { one: { failed: true }, two: {} },
  );
  expect(seq.notRun).toEqual(["two"]);
  const conditional = simulateLegacyWorkflow(
    workflow("conditional", [
      step("one", { condition: "score >= 5" }),
      step("two", { dependsOn: ["one"] }),
      step("three"),
    ]),
    { score: 1 },
    { one: {}, two: {}, three: {} },
  );
  expect(conditional.trace.map((t) => t.status)).toEqual(["skipped", "blocked", "completed"]);
});
test("unsafe expressions, cycles, nonmembers and absent dependencies fail before simulation", () => {
  for (const value of ["process.exit()", "__proto__.x === true", "score > doThing()", "a..b === 1"])
    expect(() => parseLegacyCondition(value)).toThrow();
  expect(() =>
    workflow("parallel", [step("one", { dependsOn: ["two"] }), step("two", { dependsOn: ["one"] })]),
  ).toThrow("Cyclic");
  expect(() => workflow("parallel", [step("one", { agentId: "outside" })])).toThrow("outside");
  expect(() => workflow("parallel", [step("one", { dependsOn: ["missing"] })])).toThrow("Missing");
  expect(() => workflow("parallel", [step("one"), step("one")])).toThrow("Duplicate");
});
test("empty workflows remain empty and mocks must be explicit", () => {
  expect(simulateLegacyWorkflow(workflow("sequential", []), {}, {}).trace).toEqual([]);
  expect(simulateLegacyWorkflow(workflow("sequential", [step("one")]), {}, {}).trace[0]?.status).toBe("failed");
});

test("omitted monthly cap retains legacy default; invalid caps never become unlimited", () => {
  const s = snapshot();
  const agent = s.agents[0] as Record<string, unknown>;
  agent.config = {};
  expect(mapLegacyPermissions(s)[0]?.monthlyRunCap).toBe(1000);
  for (const cap of [null, 0, -1, 1.5, 100001]) {
    agent.config = { monthlyRunCap: cap };
    expect(() => mapLegacyPermissions(s)).toThrow("monthly run cap");
  }
});
