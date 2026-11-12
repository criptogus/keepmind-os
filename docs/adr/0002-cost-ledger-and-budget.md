# ADR-0002: Per-agent LLM cost ledger and monthly budget cap

Date: 2026-11-12 · Status: accepted

Inspired by agentes.chat ADR-0012 (budget reservation and usage).

## Context

KeepMind had no cost visibility: N employees × autonomous agents could burn
provider spend with no per-agent accounting or cap. Pricing is estimate-based
(model catalog rates), not provider-billed truth.

## Decision

- `llm_usage` table records one row per provider call: agent, execution,
  model, provider, prompt/completion tokens, `cost_usd` computed from
  `pricingForModel`/`costFromUsage` in `shared/models.ts`.
- `AgentManager` normalizes usage across all three provider paths
  (OpenAI chat, OpenAI Codex responses, Anthropic) and accumulates it over
  tool-loop iterations.
- Before each execution, if `agent.config.monthlyBudgetUsd` is set, the
  budget checker compares month-to-date spend (`getAgentSpendSince`) plus a
  worst-case estimate (`estimateCallCost` from prompt size + maxTokens)
  against the cap and throws before any call is billed.
- The dashboard shows per-agent monthly spend with cap progress bars.

## Consequences

- Costs are **estimates** from catalog pricing — unknown models price at a
  conservative fallback; OAuth/Codex calls may not be billed the same way.
- The check runs once per execution, not per tool-loop iteration — a run
  with many iterations can overshoot the cap within that run. Acceptable v1;
  per-iteration reservation is future work.
- Usage is recorded only on successful executions today; a stream that dies
  mid-flight is not metered (providers may still bill it).
