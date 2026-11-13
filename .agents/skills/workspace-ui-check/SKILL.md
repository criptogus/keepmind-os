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
disables CLI credential import and must complete at least forty-two checks. It writes
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

Inspect Home, Agents, Approvals and Settings screenshots in both themes. The shared brand accent is #c4ff3d; glow belongs to primary actions, not warning/destructive controls. Verify reduced-motion disables text/message entry effects and the native app uses the KeepMind icon in development and packaged builds. Monochrome avatars use names/initials consistently across the agent list, selectors and conversation.

Conversation-first changes must preserve unsent text across Settings and team navigation, isolate adjustment drafts by conversation, and retain the same conversation after connecting a provider. Verify the main workspace contains no delivery drawer and the material panel does not stack a modal on it. The smoke uses a loopback provider fixture to exercise a real first execution, a single-send revision, v1 history, v2 and acceptance. It must not call live providers.

Switch the visible language picker between PT-BR and English, verify the saved setting and reload, and inspect onboarding, skills and material controls in both languages. Do not translate user-authored content or external catalog instructions. Built-in metadata is localized only when it still matches the stock description. `test/interface-language.test.ts` validates literal dictionary coverage and catalog/native-menu contracts.

For intent changes, test clarification → brief → explicit start, questions that preserve the delivery, local thanks, ambiguous-message decisions, and immediate explicit revisions. Check persisted choices, stale decisions, cancellation and provider failures. Conversation inference must expose no tools or skills and must still record usage. Capture the clarification card and inspect focus and narrow layout.

Search changes must check keyboard selection without losing the query focus, Enter navigation, multi-word/accent matching, empty/narrow layouts, and real remote loading/error/retry using a loopback workspace fixture. Do not monkey-patch the immutable Electron bridge. Preserve before/after captures and scope results to authorized work.

Table/feedback changes must inspect History at desktop and 390px in light/dark themes, open a payload disclosure, and verify headers/actions remain readable rather than merely testing document overflow. Check Markdown table alignment and keyboard access. Preserve old content on reload failures. A routine mutation may succeed before its refresh fails: recovery copy must not promise that nothing changed. Webhook fixtures must use an isolated port and exercise payload retention, duplicate keys, conflicting payloads and malformed paths through HTTP. macOS window closure must leave workspace services alive; only actual quit performs cleanup.

On macOS, run `node_modules/.bin/electron scripts/smoke-lifecycle.cjs` after the build. It closes and reopens a production window against an isolated profile, checks SQLite access and writes `evidence/lifecycle-report.json`. It deliberately fails on other platforms; use the platform-neutral lifecycle unit tests there.

Configuration chat must use a fixed tool-free planner and typed action catalog; execution receives a persisted plan ID rather than caller-supplied parameters. Test missing-details clarification, explicit preview/apply, actor isolation, stale plans, duplicate apply and interrupted auth. Authentication credentials belong only in dedicated secure fields, never plan arguments or AI context. Confirm language changes in the destination language and resolve entity names in action previews; never translate user-authored names/instructions as enums. Granola callback tests use PKCE/state validation, browser recovery, cancellation and controlled token exchange; live account login is a separate result. Inspect the configuration conversation after repeated messages and approval, since effect cleanup can fail only on a subsequent render.

### Project and company boundaries

Run `npm run verify:ux` for the aggregate project/account checks as well. Use synthetic separate projects/accounts; never authenticate a real account merely to make a fixture pass. Verify cloned agents/skills, foreign-agent and dependency rejection, account identity pinning, no fallback to global memory/accounts, company inheritance opt-in and override behavior, authenticated-session restoration, and OAuth completion after closing its UI. Check project objectives, 12-item conversation pagination, accordion keyboard interaction, and access dialogs at desktop and narrow widths. Keep server-scoped Second Brain authorization distinct from a connection label. Record live-auth limitations separately from simulated SDK/loopback checks.
