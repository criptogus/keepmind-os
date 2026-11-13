---
name: workspace-ui-check
description: Validate KeepMind request, delivery, onboarding and theme changes with the existing isolated Electron smoke.
---

Use after changes to the workspace UX. Run from the repository root:

```sh
npm run verify:ux
```

This reuses typecheck, unit/integration tests, build, the headless runner and
`scripts/smoke-electron.mjs`, followed by the secret scan. Any failed stage exits
nonzero. The smoke creates fresh temporary SQLite data, seeds a synthetic delivery,
disables CLI credential import and must complete at least thirteen checks. It writes
`evidence/ux-report.json` plus screenshots. Never use production data or credentials.

For only the smoke after a current build and runner build:

```sh
npm run smoke:electron -- --evidence-dir /absolute/output/path
```

Inspect the report and open the generated light/dark, narrow, Portuguese,
business-problem, team-proposal, first-request and delivery screenshots. Check readable text, layout, request priority,
result formatting and truthful actions. Automation does not replace visual judgment
or prove full accessibility compliance. Preserve action approvals and owner spending
authority. Record actual test results and limitations in the PR; never report a
partial run as success. Do not merge or publish without user authorization.

The business guide must not persist a team before confirmation or execute a model call during setup. Verify that confirmation creates three agents, a real team, and a draft assigned to its coordinator. Domain tests must cover deduplicated retry and atomic rollback of both SQLite and in-memory work state.
