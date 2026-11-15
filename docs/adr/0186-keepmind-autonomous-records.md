# 0186. Bounded autonomous records

- Status: Accepted
- Date: 2026-11-15

## Decision

A plugin manifest may select `autonomy: records`. Absent means `assisted`, preserving
existing grants. A manager must approve the exact manifest digest, revision and
agent assignments once. The approval describes unattended internal operations.
Management remains manager-only. Generated record operations recheck organization,
manifest digest, enabled state, agent assignment, active agent and a matching
persisted execution. Revocation takes effect on the next call, including held tool
handles. No person is impersonated by a background run.

The existing gateway still checks scopes, budgets, run policy and approval level.
At risky, internal records need no per-record approval; always remains always.
External sends, deletion, permissions, arbitrary code and commitments are not added.
Assisted records continue to require a manager behind every call. The autonomous
mode is suitable for team records visible to the assigned agents, not row-level
personal privacy: use separate workspaces for personal and corporate data.

The autonomous CRM template adds contact source, email, opportunity amount/currency
and last-contact fields. A deterministic review operation returns overdue/today,
missing/invalid next contact, missing source and potential duplicate signals.
Dates are ISO calendar days compared in UTC and explicitly labeled. The tool does
not infer dates, merge contacts, send messages or create a schedule. Existing native
routines can run it. Internal attention signals are not critical approval requests.

Record updates retain the previous 50 versions with agent/run identity. The plugin's
existing transactional size limit includes history. Disabled plugins retain data.
Contact interactions are append-only, source-bearing events with separate occurrence
and recording timestamps, actor/run identity and idempotent request IDs. Each record
holds up to 100 events; exceeding the cap fails explicitly instead of dropping history.
History is not an unlimited event archive; contact events from outside the app
still need explicit sources. Old schemas are not silently changed on populated
plugins; the new template uses a separate slug.

## Verification

Tests cover manager-only setup, explicit activation, background calls through the
real gateway, tenant/assignment/run identity, revocation, stale revisions, retries,
history and deterministic triage. Existing shared permissions and budgets remain
engine responsibilities, not new plugin bypasses.
