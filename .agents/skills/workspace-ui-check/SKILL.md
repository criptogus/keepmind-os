---
name: workspace-ui-check
description: Validate KeepMind request, delivery, onboarding and theme changes with the existing isolated Electron smoke.
---

Use after changes to the workspace UX. Run from the repository root:

```sh
npm run verify:ux
```

This reuses typecheck, unit/integration tests, build, the headless runner and
`scripts/smoke-electron.mjs`, followed by the secret scan and pinned production-dependency/package policy check. Any failed stage exits
nonzero. The smoke creates fresh temporary SQLite data, seeds a synthetic delivery,
disables CLI credential import and must complete at least twenty checks. It writes
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

Also verify a revision starts with one action, preserves earlier deliveries, and identifies the replacement version. Check the chat composer and inline approval controls. Export PDF and PPTX through the real Electron bridge, validate binary signatures, and inspect the material preview. Do not equate a model claiming a file exists with a verified export.

OAuth regressions use the production MCP SDK with controlled HTTP fixtures: PKCE, state, replay, cancellation, refresh and revocation. They do not prove a real account login. Check the disconnected Skills card and lime approval/version label in the smoke. For live login, confirm the browser is actually visible; OS acknowledgement alone is insufficient. Use the explicit Safari recovery option on macOS when default-browser dispatch fails. Never terminate unrelated browser processes. Record live discovery, login-page, account callback, search and install separately.

Legacy feature adaptations must keep the current application identity and request/delivery flow. Verify compatible provider selection cannot fall through to a native OAuth account, declared prices enforce per-run limits, and keys never enter ordinary settings. Company-bound context must fail closed without falling back to global memory. Use synthetic multi-company fixtures for path, metadata and content isolation. The packaging gate compares the checked-in dependency inventory and rejects restricted SDKs; refreshing the inventory requires explicit dependency review, not automatic acceptance. Run `npm run check:bundle` for its aggregate report; packaging additionally runs the afterPack gate against ASAR and unpacked paths.
