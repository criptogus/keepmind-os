# Projects and account scope — PR 12

## User requirements
Projects must isolate agents, teams, skills, tone, guardrails, tools and authenticated accounts. Different projects may use Gmail vs Outlook or different WhatsApp numbers. Projects within a company may explicitly inherit common accounts, skills and rules. Objectives (leads, CAC, etc.) guide work and proactive reports. Conversation lists must scale and offer accordion navigation. Provider sign-in must persist and display clear connected state. Keep configuration accessible through chat and do not merge this PR.

## Implemented model
New project creation copies a team's agents and assigned skills into independent identities. Existing task labels remain in the previous workspace; they are not silently claimed as isolated projects. Project work rejects foreign agents/dependencies. Delegation stays inside the project. Automatic global skill routing is disabled for scoped agents; company/library skills require explicit selection. Filesystem, global personal memory and unbound integration tools are unavailable in scoped execution.

Named connection instances isolate Gmail/Outlook session identities, WhatsApp auth directories and messages, and Second Brain endpoint/token settings. Company standards may explicitly share those identities and library skills; turning inheritance off selects the project's own connections. Company guardrail text remains additive. Critical action approval still follows the existing enforced policy. Textual rules are guidance, not a replacement for enforced access restrictions.

Second Brain isolation depends on a server account/token restricted to the intended context. A friendly connection name is not an authorization boundary. The interface states this. No live account authentication has been verified in this change.

Daily reports use the existing durable trigger/task execution path, only while the app runs, normal budget/approval gates, scoped project progress, and missing-data questions. No invented business metrics. Reports are delivered as conversations in the project.

## Validation
`npm run verify:ux` passed: 271 unit tests (44 files), one integration test, 51 Electron scenarios, typecheck, build, runner, secret scan and bundle dependency policy. Desktop and 390px project/access screenshots were inspected. Account isolation, partial policy edits, restoration intent, OAuth pending refresh/pinning and browser failure recovery have focused tests.

UI reference retrieval for accordion/pagination was irrelevant, then zero on one narrow retry. Implementation uses existing Mantine controls and native details semantics as general fallback guidance, not a claimed reference match.

## Scope and rollout limits

- New scoped projects are local-desktop features. Existing labeled tasks remain in the previous workspace; this does not silently migrate or reassign historical teams/accounts. Remote workspace authorization continues using its existing model.
- Scoped account adapters currently cover Gmail and Outlook through the configured Composio service, separate WhatsApp identities, and read-only Second Brain contexts. Granola, general MCP and other global integrations are not silently inherited into a project.
- Daily updates require the app to stay open and access to useful evidence. This is not a guarantee of unattended campaign optimization or metric improvement. Cadence is optional and uses ordinary usage budgets and sensitive-action approvals.
- Pagination limits rendered conversation cards, not the complete persisted document/IPC snapshot.
- OAuth persistence now waits for encrypted writes and shutdown drains pending writes; the data path is pinned independently of display-name changes. A deliberately isolated development/test profile remains a different workspace. Existing credentials in such profiles are not automatically copied into the installed app.

## Independent reviews

Spec and Standards reviewers found account restoration, pending OAuth refresh, private-skill picker filtering, symmetric dependency scope, shutdown during reconnect and destructive whole-policy replacement. These were corrected. Policy edits are now partial and preserve omitted account, skill and rule fields; removing a company requires explicit null. SDK session construction pins exact account IDs and disables automatic connection management. Browser-open failure preserves pending account identity and returns a recovery URL.

Jev 1.14.0 reviewed a minimal synthetic design description (574 input / 81 output tokens): explicit inheritance was compatible with the requirement (probability 0.82); claiming client labels alone enforce server memory isolation was an overclaim (1.0). These are advisory semantic checks, not authorization or security proof.
