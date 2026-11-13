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

## Conversational intent and decisions (PR #12 follow-up)

User scope: implement conversation that understands intent, asks clarifying questions and presents decision cards, preserving white/black/lime identity. Update the same PR; do not merge.

- Preparing a new request asks one essential question at a time, offers optional answers and accepts free text. A concise brief requires explicit **Start delivery** confirmation. The pending decision and dialogue survive restart.
- Questions receive a contextual answer without replacing, accepting or versioning the delivery. Exact thanks are acknowledged locally. Unclear messages offer answer / new version / comment decisions; clear change requests start a new revision immediately.
- Conversation classification uses the configured provider with a fixed prompt, no tools, no skill selection and no external memory retrieval. Existing provider, concurrency, usage and budget controls apply. It does not claim to infer an agent's private reasoning. External-action requests cannot become action approvals.
- Delivery approval and sensitive-action approval remain separate, consistently styled cards. Generated messages preserve their historical language; controls follow PT/EN settings.
- Duplicate request IDs are idempotent; stale revisions/decisions, malformed responses and late replies after cancellation cannot start work. Running-task messages explicitly say they apply to the next revision.

Validation uses the existing `npm run verify:ux` automation, extended with controlled provider responses for clarification → brief → start → delivery → question → thanks → ambiguous comment → immediate revision → approval. These fixtures verify the application plumbing and decision handling, not every model's semantic accuracy. Additional domain tests cover persistence, invalid replies, duplicate decisions, scoped remote access and tool-free inference with recorded cost.

### Follow-up review and evidence

**Standards:** the review found that cancelling a pending reply did not abort its paid inference. Inference now carries the work-task identity without replacing the delivery execution ID; a provider-signal test confirms cancellation releases its slot. Shutdown tracks dialogue separately from work concurrency. A regression test covers immediate revision with `maxConcurrent=1`. Shared `canReviseWork` keeps transition eligibility consistent.

**Spec:** a failed first attempt could not accept corrections before producing a delivery. This now starts corrected work and creates v1; the UI says “Try the updated request” when no prior delivery exists. Both reviewers confirmed their findings resolved by source inspection.

Jev `jev-1.14.0` classified six synthetic Portuguese cases against the conversation policy: question with negation, thanks plus correction, ambiguous feedback, external action, textual approval and a quoted action. All six matched the intended categories; textual approval was less decisive (reported confidence 0.88), reinforcing the deterministic rule that ordinary text never accepts deliveries. Exact distributions and usage (1,450 input / 277 output tokens) are retained in `evidence/conversation-semantic-*.json`. This is advisory policy evidence, not a live-provider accuracy benchmark.

Focused UX references supported contextual status messages and visible keyboard focus; existing tokens, components and reduced-motion rules remain authoritative. Visual inspection covered the new clarification, brief, v2 and narrow-window screenshots. The redundant saved-request notice is hidden once preparation is underway, and the conversation list exposes “Waiting for you”.

Final validation: `npm run verify:ux` covers 238 unit tests in 34 files, one integration test, 39 Electron scenarios, TypeScript, production build, runner, secret scan and the 462-package inventory policy. The provider in the full UI flow is a deterministic loopback fixture; no live customer OAuth session or model quality claim is made. No merge.
