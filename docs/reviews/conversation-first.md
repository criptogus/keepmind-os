# Conversation-first workspace and consistent interface language

## Spec and scope

User request: implement the UX audit improvements, starting with the main flow and simpler navigation. Make conversation the center of the app, test, and open a PR for review without merging. Follow-up: offer language selection and keep interface language consistent everywhere.

This change replaces the delivery drawer with a persistent conversation workspace, keeps the request list visible, opens materials in an adjacent panel, preserves unsent request/adjustment text across navigation and conversations, and offers provider authentication without leaving a request. New requests request delivery review by default. Sensitive action authorization and checkpoint reconciliation remain unchanged.

Navigation has Conversations, My team, Approvals and Settings. Team members and skills sit under My team. Connections sit under Settings; routines/history remain reachable under Organize and command search. Old dashboard links lead to Conversations, without a second execution composer.

The onboarding team is presented before optional editing. It remains an explicit curated starter selected by category, not an AI-generated bespoke team. The customer's free text is included in the initial request and agent context. This PR does not claim semantic generation of roles or a pixel-identical PDF preview.

Language selection is available from onboarding and the app header/settings. English and Brazilian Portuguese are supported; the prior Spanish option that silently rendered English is removed. One saved preference drives interface labels, document language, native menu/tray, business starters, built-in catalog metadata and material controls. Custom names, customer messages, historical deliveries, external catalog content and original technical instructions are not rewritten. Technical diagnostic details may retain their source language. A member can change only the presentation language without gaining administrative settings access or receiving raw settings in that response.

## Verification plan

Reuse `npm run verify:ux`: types, unit/integration tests, build, runner, isolated Electron smoke, secret scan and package policy. The smoke must complete at least 29 checks. New scenarios cover live language switch/reload, contextual connection and draft preservation, isolated drafts per conversation, and request → delivery → single-send revision → version 2 → acceptance through real IPC and a deterministic local OpenAI-compatible HTTP fixture. No real provider account is charged.

Inspect light/dark screenshots, narrow layout, Portuguese and English controls, current/prior versions, material panel, and keyboard focus. Do not treat automated assertions as full accessibility certification. OAuth uses the existing connection handlers and recovery controls; a real account authorization is not claimed by this fixture.

## Review

Fixed point: main merge f7b45e3b03d2fef28f4e622298daddea60a9a371. Standards: CONTRIBUTING.md, existing workspace-ui-check skill. Final results and any unresolved limitations are recorded below before PR handoff.
