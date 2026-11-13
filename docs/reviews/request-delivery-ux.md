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
