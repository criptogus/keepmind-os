# Headroom sidecar: context compression for agent runs

Date: 2026-11-18. Status: design spike, no code.

## Why

Run analysis (2026-11-18, local DB): slow runs are serial tool-call loops where each step
grows slower as the transcript grows (Vetor 97 calls/40min, Farol 117 calls/2h). Input-token
volume per step is the lever Headroom pulls: 21-57% fewer input tokens on agent workloads,
local-only compression (Apache-2.0, `headroom-ai` PyPI + npm client).

## Constraint discovered

Headroom is a **Python proxy/library**, not an embeddable TS compressor: the npm package
`headroom-ai` is a thin client that talks to a local proxy (`pip install "headroom-ai[proxy]"`).
So integration is a sidecar, same pattern as `whatsapp-bridge` and `rea`.

## Where the bytes actually are

Two brain families, very different hook points:

1. **`brain: "model"`** (server-side): `ModelBrain.request` in
   `packages/engine/src/brains/model.ts` assembles `system` + `messages` per turn, already
   passes through `cutOldToolSteps` (`context-budget.ts`). A compression stage slots in
   right after trimming, before `turnNotes`/gateway. Feasible and clean: we own the payload.
   Caveat: messages must stay valid for prompt cache (`cacheTtl: "1h"`) and transcript resume
   — compression must be deterministic per transcript revision and only touch old tool
   results, never user/assistant text.

2. **CLI brains** (`claude_code`, `codex`, `opencode`, `cursor`, `grok`, `antigravity` —
   where the slow runs live): the harness on the machine owns the context. We cannot rewrite
   its transcript. The only interception point is **provider-level**: run a Headroom proxy on
   the machine and point the CLI's base URL at it. OpenCode supports custom providers; Claude
   Code supports `ANTHROPIC_BASE_URL`; Codex similar. But our agents mostly ride managed
   endpoints (OpenCode Go/Zen, Claude subscription) whose base URLs are not ours to repoint
   reliably — this path is fragile and per-brain.

## Recommendation

Phase 1 (cheap, honest): apply compression only on the `model` brain path, behind an org/agent
flag, measuring tokens/step and run duration before/after. This covers `brain: "model"`
agents and any future server-side brain.

Phase 2 (only if Phase 1 proves the win): evaluate per-brain proxy injection on the runner
for brains whose provider config we control (custom endpoints first, managed subscriptions
never — repointing a user's Claude/ChatGPT subscription traffic through a local proxy is a
trust problem we should not create).

## Open questions

- Does Headroom's compressor preserve tool-call/tool-result pairing and provider block
  types (thinking blocks) that our transcript requires verbatim? Needs a spike against real
  transcripts before any flag ships.
- Cost: Python sidecar per server (not per machine for Phase 1) — packaging story same as
  whatsapp-bridge (`server-bundles`).
- Interaction with `cutOldToolSteps`: compression and cutting may double-dip; decide
  precedence (compress old results, then cut what remains oversized).

## Measurement plan

Baseline already exists: `agent_run_steps` durations + token usage in the local DB. Add a
per-run `compressed_tokens` counter on `model_call` steps when the flag is on.
