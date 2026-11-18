# Self-improvement (SIM): what Hermes Agent teaches us

Date: 2026-11-18. Status: research synthesis. No code.

## Context

SIM (structured self-improvement history) was evaluated earlier; the open question was a
concrete reference implementation. `NousResearch/hermes-agent` (MIT) is the closest public
implementation of the loop we sketched.

## What Hermes does that maps to us

| Hermes mechanism | KeepMind equivalent today | Gap |
|---|---|---|
| Creates skills from experience after complex tasks | `learned-skills.ts`, `context/learn.ts`, skill proposals | We record lessons; we don't yet auto-draft reusable skills from runs |
| Skills self-improve during use | `skill-updates` flow exists (settings-proposals) | Improvement is human-approved; no autonomous revision loop |
| FTS5 session search + LLM summarization for cross-session recall | transcript/context store, wiki | No agent-facing "search my past sessions" tool |
| Scheduled automations (cron → any platform) | routines exist | Delivery targets narrower |
| Subagents with isolated context + RPC tool scripts | `ask_agent`, delegation | No "script that calls tools via RPC" zero-context-cost pattern |
| Honcho dialectic user modeling | — | Out of scope for now |

## Recommended SIM v1 (smallest honest loop)

1. **Capture**: at run end, the reflect step (`context/reflect.ts`) already produces
   judgments/outcomes — extend it to emit a *skill candidate* when a run shows a reusable
   procedure (pattern already exists for lessons).
2. **Draft**: a `draft_skill` proposal card in chat (same proposal machinery as agent
   creation) containing a SKILL.md draft + the runs that motivated it.
3. **Approve/edit**: human approves → becomes a team skill (`source: "learned"`), exactly
   like built-in skills distribution.
4. **Improve**: when a skill is loaded N times with corrections, propose a revision diff —
   again a proposal card, never silent mutation.

This is deliberately proposal-driven (matches our approval/audit model) rather than
Hermes' fully autonomous loop. The autonomous version is a later flag for trusted orgs.

## What NOT to copy

- Hermes' memory nudges and personality modeling — different product surface.
- Its gateway multi-platform plumbing — we already have WhatsApp/Slack-style channels.
- Trajectory compression for training data — not our roadmap.

## References

- `NousResearch/hermes-agent` (MIT): learning loop, skill self-improvement, session search.
- `packages/engine/src/context/` (learn, reflect, learned-skills, outcomes).
- Earlier SIM evaluation notes (conversation history).
EOF
cd "/Users/gustavocaetano/Documents/ChatGPT/keepmind-os" && git add docs/superpowers/specs/2026-11-18-self-improvement-sim-design.md && git commit -q -m "docs: self-improvement (SIM) design from Hermes Agent study

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>" && git push -q && echo ok && git log --oneline -5