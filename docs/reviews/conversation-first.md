# Conversation-first workspace and consistent interface language

## Spec and scope

User request: implement the UX audit improvements, starting with the main flow and simpler navigation. Make conversation the center of the app, test, and open a PR for review without merging. Follow-up: offer language selection and keep interface language consistent everywhere.

This change replaces the delivery drawer with a persistent conversation workspace, keeps the request list visible, opens materials in an adjacent panel, preserves unsent request/adjustment text across navigation and conversations, and offers provider authentication without leaving a request. New requests request delivery review by default. Sensitive action authorization and checkpoint reconciliation remain unchanged.

Navigation has Conversations, My team, Approvals and Settings. Team members and skills sit under My team. Connections sit under Settings; routines/history remain reachable under Organize and command search. Old dashboard links lead to Conversations, without a second execution composer.

The onboarding team is presented before optional editing. It remains an explicit curated starter selected by category, not an AI-generated bespoke team. The customer's free text is included in the initial request and agent context. This PR does not claim semantic generation of roles or a pixel-identical PDF preview.

Language selection is available from onboarding and the app header/settings. English and Brazilian Portuguese are supported; the prior Spanish option that silently rendered English is removed. One saved preference drives interface labels, document language, native menu/tray, business starters, built-in catalog metadata and material controls. Custom names, customer messages, historical deliveries, external catalog content and original technical instructions are not rewritten. Technical diagnostic details may retain their source language. A member can change only the presentation language without gaining administrative settings access or receiving raw settings in that response.

## Verification plan

Reuse `npm run verify:ux`: types, unit/integration tests, build, runner, isolated Electron smoke, secret scan and package policy. The smoke must complete at least 32 checks. New scenarios cover live language switch/reload, contextual connection and draft preservation, isolated drafts per conversation, and request → delivery → single-send revision → version 2 → acceptance through real IPC and a deterministic local OpenAI-compatible HTTP fixture. No real provider account is charged.

Inspect light/dark screenshots, narrow layout, Portuguese and English controls, current/prior versions, material panel, and keyboard focus. Do not treat automated assertions as full accessibility certification. OAuth uses the existing connection handlers and recovery controls; a real account authorization is not claimed by this fixture.

## Review

Fixed point: main merge f7b45e3b03d2fef28f4e622298daddea60a9a371. Standards: CONTRIBUTING.md, existing workspace-ui-check skill. Final results and any unresolved limitations are recorded below before PR handoff.

## Review results

### Standards

One P2 was found: a connection made in Settings did not refresh provider readiness in the still-mounted conversation. The workspace now rechecks readiness when activated; inline key removal/logout also notify it. The `settings-provider-readiness` smoke covers returning from Settings after configuring a controlled compatible provider. The reviewer confirmed the fix by source inspection.

### Spec

Three P2 findings were fixed: contextual authentication disappeared on narrow screens; switching conversations discarded the team-setup draft; and completion of an async send could clear text entered after submission. Explicit responsive connection state, a mounted guide with scoped resets, and snapshot-based draft clearing address these. The reviewer confirmed all three fixes by source inspection. The smoke covers narrow authentication and guide draft preservation.

### Semantic language check

Jev `jev-1.14.0` checked 23 stock skill descriptions (4,899 input / 1,028 output tokens). The exact input, distributions and result are in `evidence/language-semantic-*.json`. This advisory check highlighted wording that obscured capabilities, particularly WhatsApp sending and local command execution. Descriptions were corrected against their original source; lower-confidence findings about harmless brevity were assessed manually. No credentials or customer content were submitted. This is a semantic sample, not certification of all translations.

## Validation results

`npm run verify:ux` passed: 220 unit tests in 33 files, one integration test, TypeScript, production build, runner, 32 Electron scenarios, secret scan and the 462-package inventory policy. The final presentation-only adjustments were rechecked with TypeScript, build and the complete Electron smoke.

The first full local run stopped at the secret scanner because linked `node_modules` was not ignored by the trailing-slash directory pattern. The ignore rule now also covers dependency-directory symlinks; the scanner itself is unchanged and the successful run found zero possible secrets.

Screenshots under `evidence/` show the conversation workspace in light/dark mode, Portuguese controls, narrow layout, version 2, and adjacent material preview. Visual inspection led to neutral connection notices in dark mode and scrolling to the current delivery's heading when opening a conversation.

Limits: synthetic local provider, no live OAuth login or paid model invocation; drafts persist during navigation, not across app restarts; historical/customer/external content retains its original language. Material preview shows content, not final PDF pagination. No data migration or merge is performed.
