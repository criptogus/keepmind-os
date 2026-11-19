# KeepMind OS: roadmap and acceptance

Updated 2026-11-15. This is an implementation ledger, not a claim that the new
architecture is running at keepmind.io or that a new desktop release is available.

| Stage | Implemented in source | Remaining acceptance |
| --- | --- | --- |
| Consolidate | New team architecture, isolated legacy importer, fork Compose, developer quickstart, narrowly scoped historical secret-scan exclusions, smaller history-search fixture retaining pagination assertions | Full CI on this revision; restore drill; actual legacy-data rehearsal and cutover |
| Bounded autonomy | Explicit per-agent records grant, persistent native routines, scopes/budgets/run policy, revalidation on each call and immediate next-call revocation | Real provider creating and executing a routine across server restart |
| Useful CRM | Separate autonomous template; source and contact fields; deterministic follow-up review; duplicate candidates; revision history; source-bearing, idempotent interactions | Real source connectors; production workload and storage limits; record import |
| Simple experience and release | Chat setup with one activation card; existing Today view for decisions, blockers and work; routine digests; developer quickstart | Complete provider-backed user journey on desktop/mobile viewports; signed native distribution; deployment verification |

## Product contract

The person gives a goal. The system chooses internal steps within its granted
scope and budget, records what happened, and reports outcomes. Routine data cleanup
is not a stream of approval cards. Ask for a decision when the action exceeds the
granted authority or has consequential external effects. Existing `always` and
`never` policy settings are not silently rewritten.

CRM review returns evidence-based signals, not invented next-contact dates or
promises. Duplicate candidates are not automatically merged. Review is read-only;
only a persisted native routine establishes a schedule. An interaction records an
actual event and source, never a message the system merely drafted. Priorities
use ISO calendar days in UTC and report that basis explicitly.

The initial storage envelope remains 2,000 records and 5 MB per plugin, including
50 prior value versions per record and at most 100 interaction events per record.
Limits fail visibly; they are not silent data eviction. Expansion to dedicated
contact/event tables should follow measured need, with a migration and export path.

## Release acceptance sequence

1. CI passes on the exact commit, including policy/tenant regressions and container
   startup. Do not equate a successful build with working external integrations.
2. Install in a fresh staging environment. Claim the owner, configure a real model
   and create separate personal and company workspaces.
3. Ask for a CRM and daily follow-up. Confirm one explicit template/agent grant,
   saved routine and next-run time. Seed synthetic contacts with source references.
4. Run the routine, restart the server, and verify the next execution resumes
   through the durable scheduler. Verify retries do not duplicate records/events,
   histories retain attribution, and overdue contacts appear in the digest.
5. Revoke the plugin assignment and prove an already-held tool cannot write.
   Verify an unrelated agent/workspace cannot access the records. Verify external
   sends still follow their own native policy and authority.
6. At narrow and wide viewports, complete setup, review a critical decision,
   recover a failed routine, search a contact and inspect its history. Inspect
   keyboard access and loading/error states; no false “all done” on partial data.
7. Back up and restore the database, files and encryption configuration into an
   isolated target with schedules/external execution disabled. Compare record
   counts and source IDs; rehearse legacy import without modifying the original.
8. Deploy the verified source/image, run health and provider-backed smoke tests,
   then publish versioned distribution instructions. Native installers require
   platform builds, signing and updater verification; do not reuse upstream assets.

These final checks require the deployment environment, provider account and native
signing setup. No release should be marked complete based only on mock providers.
