import { describe, expect, test } from "bun:test";
import { type TraceStep, traceRun } from "../src/run-trace";

const at = (sec: number) => new Date(sec * 1000);

function step(seq: number, kind: string, sec: number, data: Record<string, unknown> = {}): TraceStep {
  return { seq, kind, data, createdAt: at(sec) };
}

describe("traceRun", () => {
  test("attributes gaps to the step that ended them and totals the model calls", () => {
    const run = { createdAt: at(0), finishedAt: at(100) };
    const steps = [
      step(1, "context", 2),
      step(2, "model_call", 12, { model: "m1", inputTokens: 1000, outputTokens: 100, costNanoUsd: 5 }),
      step(3, "tool_call", 13, { toolUseId: "t1", name: "bash" }),
      step(4, "tool_result", 15, { toolUseId: "t1", name: "bash", isError: false }),
      step(5, "model_call", 25, { model: "m1", inputTokens: 3000, outputTokens: 200, costNanoUsd: 9 }),
      step(6, "message", 26),
    ];
    const t = traceRun(steps, run);

    expect(t.durationMs).toBe(100_000);
    expect(t.stepsByKind).toEqual({ context: 1, model_call: 2, tool_call: 1, tool_result: 1, message: 1 });
    // Gaps: 0→2 context(2s), 2→12 model(10s), 12→13 tool_call(1s), 13→15 tool_result(2s), 15→25 model(10s), 25→26 message(1s), 26→100 tail(74s)
    expect(t.kindMs.context).toBe(2000);
    expect(t.kindMs.model_call).toBe(20_000);
    expect(t.kindMs.tool_call).toBe(1000);
    expect(t.kindMs.tool_result).toBe(2000);
    expect(t.kindMs.message).toBe(1000);
    expect(t.kindMs.tail).toBe(74_000);

    expect(t.model.calls).toBe(2);
    expect(t.model.inputTokens).toBe(4000);
    expect(t.model.outputTokens).toBe(300);
    expect(t.model.maxInputTokens).toBe(3000);
    expect(t.model.costNanoUsd).toBe(14);
    expect(t.model.totalMs).toBe(20_000);
    expect(t.model.avgMs).toBe(10_000);

    expect(t.tools.calls).toBe(1);
    expect(t.tools.errors).toBe(0);
    expect(t.tools.byName).toEqual([{ name: "bash", calls: 1, errors: 0, totalMs: 2000, maxMs: 2000 }]);
    expect(t.stalls).toEqual([{ seq: 7, kind: "tail", ms: 74_000 }]);
  });

  test("pairs tool calls to results by toolUseId across interleaved steps", () => {
    const run = { createdAt: at(0), finishedAt: at(30) };
    const steps = [
      step(1, "tool_call", 1, { toolUseId: "a", name: "read" }),
      step(2, "tool_call", 2, { toolUseId: "b", name: "bash" }),
      step(3, "tool_result", 5, { toolUseId: "a", name: "read" }),
      step(4, "tool_result", 20, { toolUseId: "b", name: "bash", isError: true }),
    ];
    const t = traceRun(steps, run);
    const read = t.tools.byName.find((x) => x.name === "read")!;
    const bash = t.tools.byName.find((x) => x.name === "bash")!;
    expect(read).toMatchObject({ calls: 1, totalMs: 4000 });
    expect(bash).toMatchObject({ calls: 1, errors: 1, totalMs: 18_000 });
    expect(t.tools.errors).toBe(1);
    expect(t.tools.calls).toBe(2);
    // Sorted by totalMs desc: bash first.
    expect(t.tools.byName[0]!.name).toBe("bash");
  });

  test("a live run has no duration and no tail", () => {
    const run = { createdAt: at(0), finishedAt: null };
    const t = traceRun([step(1, "model_call", 5, { inputTokens: 10 })], run);
    expect(t.durationMs).toBeNull();
    expect(t.kindMs.tail).toBeUndefined();
    expect(t.model.calls).toBe(1);
  });

  test("empty run traces clean", () => {
    const t = traceRun([], { createdAt: at(0), finishedAt: at(10) });
    expect(t.durationMs).toBe(10_000);
    expect(t.kindMs.tail).toBe(10_000);
    expect(t.model.calls).toBe(0);
    expect(t.tools.byName).toEqual([]);
  });
});
