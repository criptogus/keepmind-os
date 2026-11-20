/**
 * A run's trace: where its time, tokens and tool calls went, aggregated from its `agent_run_steps` rows.
 * Pure (no db): `getRun` feeds it the run's steps; the app shows it under `GET …/runs/{runId}`.
 *
 * Timing model: a step is written when the work that produced it finished, so the gap between two steps is
 * attributed to the later step's kind — the wait before a `model_call` is model latency, the wait before a
 * `tool_result` is the tool running (approvals and queues included: their `approval`/`error` steps mark them).
 * Tool calls pair `tool_call`→`tool_result` by `toolUseId` for exact per-tool durations.
 */

export interface TraceStep {
  seq: number;
  kind: string;
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface TraceToolStat {
  name: string;
  calls: number;
  errors: number;
  /** Sum of paired call→result durations; calls never paired count in `calls` only. */
  totalMs: number;
  maxMs: number;
}

export interface RunTrace {
  /** First step (or run start) to finish/cancel; null while the run has no steps yet. */
  durationMs: number | null;
  /** Steps by kind. */
  stepsByKind: Record<string, number>;
  /** Time attributed to each step kind, plus `tail` (last step → run end: queues, deliveries, idle). */
  kindMs: Record<string, number>;
  model: {
    calls: number;
    models: string[];
    inputTokens: number;
    outputTokens: number;
    /** Largest single call's input: the worst context size the run paid for. */
    maxInputTokens: number;
    costNanoUsd: number;
    totalMs: number;
    avgMs: number;
  };
  tools: {
    calls: number;
    errors: number;
    totalMs: number;
    byName: TraceToolStat[];
  };
  /** The biggest gaps (≥ `STALL_MS`), newest order irrelevant: `seq` is the step that ended the gap. */
  stalls: { seq: number; kind: string; ms: number }[];
}

/** A gap this long is a stall worth naming (machine asleep, approval wait, provider outage). */
export const TRACE_STALL_MS = 60_000;
const MAX_STALLS = 5;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function traceRun(steps: TraceStep[], run: { createdAt: Date; finishedAt: Date | null }): RunTrace {
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  const stepsByKind: Record<string, number> = {};
  const kindMs: Record<string, number> = {};
  const model = {
    calls: 0,
    models: [] as string[],
    inputTokens: 0,
    outputTokens: 0,
    maxInputTokens: 0,
    costNanoUsd: 0,
    totalMs: 0,
    avgMs: 0,
  };
  const tools = new Map<string, TraceToolStat>();
  const openCalls = new Map<string, Date>();
  let toolCalls = 0;
  let toolErrors = 0;
  let toolMs = 0;
  const stalls: { seq: number; kind: string; ms: number }[] = [];

  let prev = run.createdAt;
  for (let i = 0; i < ordered.length; i++) {
    const step = ordered[i]!;
    const gap = Math.max(0, step.createdAt.getTime() - prev.getTime());
    kindMs[step.kind] = (kindMs[step.kind] ?? 0) + gap;
    stepsByKind[step.kind] = (stepsByKind[step.kind] ?? 0) + 1;
    if (gap >= TRACE_STALL_MS) stalls.push({ seq: step.seq, kind: step.kind, ms: gap });
    prev = step.createdAt;

    if (step.kind === "model_call") {
      model.calls += 1;
      const m = str(step.data.model);
      if (m && !model.models.includes(m)) model.models.push(m);
      const input = num(step.data.inputTokens);
      model.inputTokens += input;
      model.outputTokens += num(step.data.outputTokens);
      model.maxInputTokens = Math.max(model.maxInputTokens, input);
      model.costNanoUsd += num(step.data.costNanoUsd);
    } else if (step.kind === "tool_call") {
      toolCalls += 1;
      const name = str(step.data.name) ?? "unknown";
      const id = str(step.data.toolUseId);
      if (id) openCalls.set(id, step.createdAt);
      let stat = tools.get(name);
      if (!stat) {
        stat = { name, calls: 0, errors: 0, totalMs: 0, maxMs: 0 };
        tools.set(name, stat);
      }
      stat.calls += 1;
    } else if (step.kind === "tool_result") {
      const name = str(step.data.name) ?? "unknown";
      if (step.data.isError === true) toolErrors += 1;
      const id = str(step.data.toolUseId);
      const callAt = id ? openCalls.get(id) : undefined;
      if (id) openCalls.delete(id);
      const at = callAt ?? (i > 0 ? ordered[i - 1]!.createdAt : undefined);
      const ms = at ? Math.max(0, step.createdAt.getTime() - at.getTime()) : 0;
      toolMs += ms;
      let stat = tools.get(name);
      if (!stat) {
        stat = { name, calls: 0, errors: 0, totalMs: 0, maxMs: 0 };
        tools.set(name, stat);
      }
      if (step.data.isError === true) stat.errors += 1;
      stat.totalMs += ms;
      stat.maxMs = Math.max(stat.maxMs, ms);
    }
  }

  // The run's tail: last step → finishedAt (or now-ish bound: nothing follows a live run's last step).
  const lastAt = ordered.length ? ordered[ordered.length - 1]!.createdAt : run.createdAt;
  const end = run.finishedAt ?? null;
  if (end) {
    const tail = Math.max(0, end.getTime() - lastAt.getTime());
    kindMs.tail = (kindMs.tail ?? 0) + tail;
    if (tail >= TRACE_STALL_MS)
      stalls.push({ seq: (ordered[ordered.length - 1]?.seq ?? 0) + 1, kind: "tail", ms: tail });
  }

  model.totalMs = kindMs.model_call ?? 0;
  model.avgMs = model.calls ? Math.round(model.totalMs / model.calls) : 0;
  stalls.sort((a, b) => b.ms - a.ms);

  return {
    durationMs: end ? Math.max(0, end.getTime() - run.createdAt.getTime()) : null,
    stepsByKind,
    kindMs,
    model,
    tools: {
      calls: toolCalls,
      errors: toolErrors,
      totalMs: toolMs,
      byName: [...tools.values()]
        .map(({ name, calls, errors, totalMs, maxMs }) => ({ name, calls, errors, totalMs, maxMs }))
        .sort((a, b) => b.totalMs - a.totalMs || b.calls - a.calls),
    },
    stalls: stalls.slice(0, MAX_STALLS),
  };
}
