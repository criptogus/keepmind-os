# 0186. Agents' DM history past the verbatim window is summarized

- Status: Accepted
- Date: 2026-11-17

## Context

Every person's consultations between two agents land in the one agents' DM (ADR 0053 §9), and a run there read only
`AGENT_CONTEXT_MESSAGES` (default 30) messages: past that, the exchange was simply forgotten on every run. Widening
the window verbatim would cost the whole conversation's tokens on every turn; leaving it at 30 loses what earlier
agents agreed.

## Decision

An agents' DM run fetches a wider window (`DM_SUMMARY_FETCH`, 160 messages) of the same-reader exchanges
(`forSamePerson`, unchanged), keeps the newest `DM_VERBATIM` (24) whole in the turns, and hands the older slice to
`ensureDmSummary` (`context/summaries.ts`). That summarizes it with the org's summary model — same machinery and
usage kind `summary` as thread summaries (ADR 0017) — into a `thread_summary` item scoped `channel` / `channelId:reader`,
covering up to the newest older message (`coversUntil`). The executor injects it as a system block, "# Earlier in this
agents' conversation (summary)", only when the verbatim window actually cut something, and only after the same
`agentsDmReads.item` check thread summaries get: every `sourceId` must belong to the run's reader, so one person's
summary never reaches another's run.

A summary that already covers the slice is reused without a model call; a run with nothing cut injects nothing. Other
channels, threads and routine rooms are unchanged.

## Consequences

- A long agents' DM costs ~24 verbatim messages plus one ≤200-word summary per run instead of the whole exchange.
- Each run that adds messages before the verbatim window re-summarizes the older slice (cheap model, ≤60k chars in,
  cached by `coversUntil` when nothing new arrived) — the same cost profile thread summaries already have.
- If the summary model is unavailable the older exchanges are absent from context (as they were beyond 30 messages
  before); explicit reads (`search_context`, `expand`) still reach them.
