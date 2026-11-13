# ADR-0004: Memory consolidation, temporal validity, outcome weighting

Date: 2026-11-12 · Status: accepted

Inspired by agentes.chat ADR-0028 (memory judgments).

## Context

The personal brain accumulated markdown notes with no dedup, no notion of
"this fact replaced that fact", and no feedback loop — a bad memory was
recalled forever. PII must never reach the **corporate** brain; the personal
vault is local-only by design.

## Decision

New `MemoryManager` + `memory_items` table (SQLite index; the markdown vault
remains the human-readable archive):

- **Consolidation**: on `remember`, lexical candidates (token overlap ≥ 0.34,
  top 5) go to an optional LLM judge (`MemoryJudge`, cheapest configured
  provider, fails open). Verdicts drive ADD / same-merge / refines-update
  (old item gets `valid_until` + `superseded_by`, history preserved) /
  contradict (cross-linked, both kept) / related.
- **Temporal validity**: `valid_from`/`valid_until`; only active items
  (`valid_until IS NULL`) enter recall.
- **Outcome weighting**: `personalBrainSearch` returns memory ids via
  `ToolContext.memoryUsage`; when the execution settles,
  `recordOutcome(ids, succeeded)` increments uses/good/bad. Recall score =
  relevance × Beta-posterior outcome weight; items with ≥8 uses and mean
  < 0.3 are `demoted` (never deleted). `memory:retire` gives humans an
  erasure path.
- **Secrets**: content matching credential patterns is rejected outright.
  Semantic PII stays allowed in the personal brain (it never leaves the
  machine); the corporate `SecondBrainManager` keeps its own PII guard.

## Consequences

- Without a judge (no API key), behavior degrades to lexical dedup + plain
  adds — strictly better than before, never worse.
- Outcome attribution is correlational: memories returned in a failed run
  get `bad++` even if unrelated to the failure. Demotion is reversible by
  design (flag, not delete).
