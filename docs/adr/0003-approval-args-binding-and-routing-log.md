# ADR-0003: Approval bound to exact tool arguments + routing decision log

Date: 2026-11-12 · Status: accepted

Inspired by agentes.chat's "approval runs once, exactly as approved" and
ADR-0013 (router).

## Context

The governance gate created an `Approval` with **sanitized** args for display.
Sanitization truncates long strings — the reviewer could approve a payload
different from what would execute (TOCTOU-adjacent), and there was no way to
audit *why* the skill/model routers picked what they picked.

## Decision

- Every gated tool call stores `argsHash` = sha256 of the **canonical** args
  (recursive key sort) plus `argsTruncated` when the display copy differs
  from the real payload. The hash makes the approved-vs-executed binding
  verifiable in the audit trail.
- New `routing_decisions` table + `RoutingDecision` type records every
  auto-route: kind (`skill`/`model`), agent, task excerpt, scored candidates,
  decision and reason. Written by the auto-skill selector and model router in
  `main.ts`; surfaced read-only in Audit Logs.
- Routing remains heuristic and **cannot grant permissions** — it only picks
  among skills/models the agent is already allowed to use; tool gating and
  role policies stay in code.

## Consequences

- Approvals remain single-shot: the gate polls for a decision then the same
  `args` object executes — there is no second mutation point. The hash is the
  integrity proof, not a re-check.
- Routing log grows unboundedly for now (capped reads at 50); retention
  policy can come later.
