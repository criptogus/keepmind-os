# Request and delivery UX

Based on PR #9 (`957cc3a`); target branch is `codex/workspace-reliability`.
PR #10 contributes the direction for theme consistency and quick actions, adapted
rather than merged. Its packs, marketplace, remote approvals and backend changes
are outside this UI change.

The home now keeps the request composer visible, defaults to all work including
completed deliveries, and moves project/criteria/dependencies, filters, project
rules, connection setup and export into disclosures or workspace options. The
sidebar retains work, approvals and routines, with other tools still accessible.

Deliveries render Markdown headings, lists, tables and sources before operational
details. Copy, download and request-a-change sit beside the result. Raw HTML is
skipped, remote images are not fetched, executable/local links are not enabled,
and explicitly clicked HTTP(S) sources open in the system browser. Artifacts remain
proposals: downloads never apply patches or execute files.

Onboarding allows personal/team choice and optional provider credentials. Its
completion label explicitly saves a draft, without running it. Retrying within
the mounted onboarding reuses the created agent/task. It does not claim credentials
have been tested. Portuguese templates now insert Portuguese request/criteria.

Theme preferences have a single renderer source of truth. Mantine resolves the
system theme, including live changes. Semantic surface/text/focus tokens replace
mixed light and dark assumptions. Settings changes update the same theme store.

## Validation

Run `npm run verify:ux` from the repository root. The reusable workflow is in
`.agents/skills/workspace-ui-check/SKILL.md`; it extends the existing Electron smoke
rather than adding a second browser harness. `--evidence-dir` accepts an explicit
output directory for the smoke. Its JSON report rejects partial/no-op success.

Local result: TypeScript, 154 unit tests, one HTTP integration test, production build,
runner build and Electron smoke passed. Ten smoke checks cover credential-free
onboarding, formatted delivery, title contrast >= 4.5:1 in both themes, persisted
dark and automatic system themes, one-shot quick actions, approvals navigation,
narrow layout, shared-workspace isolation, checkpoint recovery and task search.
The aggregate report is `evidence/ux-report.json`.

Before: `evidence/workspace-before-pr9.png` was captured from the unmodified PR #9.
After: `workspace-pt.png`, `delivery-pt.png`, `focus-dark.png`, `focus-narrow.png`,
`onboarding-request.png` and `onboarding-connection.png` were captured in this run
and visually inspected. Fixtures are synthetic. No live provider validation or
full accessibility certification is claimed. The native window minimum size is
unchanged; narrow screenshots use viewport emulation.

The old smoke could import local Codex credentials at startup. It now explicitly
sets `KEEPMIND_DISABLE_CLI_AUTH=1` and uses temporary app data. Product behavior is
unchanged unless that opt-out is set. No authorization, budget or execution-policy
gates were relaxed.

## Standards review

One finding: source links needed an Electron external-browser handler. Fixed by
denying child windows and allowing only explicit HTTP(S) navigation externally.

## Spec review

Two findings: new-request and create-agent commands persisted across remounts.
Fixed by consuming each request; both regressions now have Electron checks.

Jev advisory verification: three requirements checked by jev-1.14.0, 683 input and
132 output tokens. Probabilities: truthful draft wording .98, approval controls
preserved 1.00, delivery-first ordering 1.00. The minimal request and complete
result are retained under `evidence/semantic/`; these support review, not authority.

## OAuth recovery follow-up

A manual test reported that clicking provider login opened no visible browser. The OS accepted the previous open command, which does not prove browser visibility or successful authentication. Use Electron shell.openExternal, expose the pending authorization link and copy action, and allow cancellation/retry in onboarding and Advanced settings. Cancelled flows cannot install credentials after a delayed token response. Authentication IPC returns status rather than token data.

Validation: regression reproduced missing cancellation before the fix and passed afterwards, including retry; typecheck, build, verify:ux (unit/integration/smoke/secret scan) passed. The Advanced settings recovery UI was added afterwards and typechecked/built. Real provider login and request → delivery → revision remain pending user authentication. No merge performed.

## Business-first journey

The entry point now asks for the customer's business problem and priority. Examples cover consultancy deliveries, marketing for speaking services, and business operations. An editable initial team suggestion explains coordination and specialist responsibilities. The customer reviews the first request, then explicitly creates the real team and saves a draft. Existing local workspaces without teams receive the same guide; returning customers can create another team or send a request to their existing team.

Suggestions currently use curated roles selected by the customer's explicit priority, not AI interpretation of arbitrary text. The business problem is retained in each agent's instructions. The coordinator delegates using specialist IDs and consolidates a delivery; creation itself makes no model calls. The first request requires review, and missing credentials show a connection next step before execution. Provider connections include pending login link/copy/cancel recovery.

Creation is atomic across agents, team and work draft, with in-memory rollback and request-key deduplication. Unit tests cover four business contexts, retry, invalid roles, and a failed final database write. The existing verification skill/script was extended instead of creating another runner.

Validation: `npm run verify:ux` passed: 161 unit tests, 1 integration test, build/typecheck/runner, 13 Electron smoke checks, secret scan (201 files; no findings). Screenshots reviewed for the business problem, editable team proposal and first request. These automated flows use synthetic data with no provider calls. The earlier live single-assistant request reached done, but the new multi-agent delivery/revision flow has not yet been validated with a live provider. Jev semantic check: jev-1.14.0, 536 input / 61 output tokens; guidance clear=1.0, curated flow cannot claim AI interpretation=0.91. Evidence retained in evidence/semantic/business-journey-*.json.
