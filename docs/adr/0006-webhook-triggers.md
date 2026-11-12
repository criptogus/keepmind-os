# ADR-0006: Event-driven (webhook) triggers alongside interval/daily

Date: 2026-11-12 · Status: accepted

Inspired by agentes.chat's routine/event trigger model.

## Context

Triggers only supported polling (`interval`, `daily HH:MM`). Real workflows
need event entry points — "when the ERP webhook fires, run the analyst".

## Decision

- `AgentTrigger.kind` gains `'webhook'`; the trigger stores a random
  `webhookToken` (generated server-side on create).
- `TriggerManager` starts a tiny `node:http` server bound to **127.0.0.1**
  (default port 47821, configurable via `webhook.port`).
  `POST /webhook/<token>` with a JSON or text body (≤256 KB) dispatches to
  `dispatchWebhook`, which matches the enabled rule by token, stamps
  `lastRunAt` and fires the agent with `{ channel: 'webhook', triggerId,
  task, webhookPayload }`. Unknown/disabled tokens → 404.
- Webhook rules are excluded from the 30s polling tick (`isDue` returns
  false) — they are purely event-driven.
- Existing interval/daily rules and the WhatsApp retry queue are unchanged.

## Consequences

- Loopback-only binding means external systems need a tunnel (ngrok,
  Tailscale) or must run on the same machine — deliberate: no unauthenticated
  LAN exposure. The 128-bit token is the only auth; treat the URL as a
  secret (it is shown in Advanced → Triggers).
- Runs go through the same `runAgent` path, so governance gates, budgets and
  audit apply identically.
