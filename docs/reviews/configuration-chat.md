# Configuration through conversation

Product direction: people should ask for connections/settings in chat, with only authentication left to them. No navigation to Settings should be necessary for the Granola connection example. Keep PR #12 open, no merge.

## Implemented contract

- A local administrator can open the configuration conversation from the conversation sidebar. Explicit configuration requests in the request/message composer go there, preserving the original delivery and drafts. The existing AI conversation can also recognize setup intent and offer the configuration assistant.
- “Conectar o Granola” works locally without a model call. The explicit request starts the existing OAuth flow; the chat tracks pending/success/failure, browser recovery and cancellation. Keys, passwords and OAuth codes are not solicited in chat.
- Other requests use the existing configured agent/provider with a fixed configuration prompt, no tools, no skills, no external memory and normal usage/budget enforcement. Missing parameters yield clarification. A validated catalog action and exact parameters are persisted before review. Execution accepts only the saved plan ID, rechecks administrator access, uses existing handlers and never executes an arbitrary model-generated channel.
- Catalog: Granola connection/sync; language/theme/preferences; agent creation/update/deletion/sharing/budgets/assigned skills; skill creation/update/deletion; guided team creation and membership; routines; company profile and memory bindings; computer access and approval controls; MCP configuration/removal; OpenAI/Anthropic OAuth or keys; Super Agent Skill accounts; Second Brain connection/settings; compatible providers and Composio credentials. Credential fields bypass the planner and message history. All non-bootstrap mutations require a saved-plan preview approval.
- Plans are scoped to the local actor. New messages invalidate unexecuted plans. Duplicate apply does not rerun completed operations. Interrupted/failed actions are not automatically replayed. Configuration success does not create or approve a delivery.

## Remaining coverage

This is a reusable configuration action catalog, not universal feature parity. User management, WhatsApp pairing, Composio application authorization, skill import/install review, provider removal and other peripheral maintenance flows still use their existing secure flows. They must gain typed catalog actions/secure inline cards before we claim all features are configurable through AI chat. If a provider is configured but no usable agent exists, a temporary tool-free KeepMind execution identity is used with a US$5 monthly safety cap, shown in chat; it creates no persistent agent; users do not have to create an agent manually. Shared remote-workspace configuration is intentionally unavailable; it must not silently mutate the local workspace.

## Verification

`npm run verify:ux` passed: 271 unit tests, one integration test and 51 Electron scenarios, plus typecheck/build/runner/secret scan/bundle policy. Configuration preview, language change, bootstrap without an agent and preservation of delivery were exercised in the rendered app. The Granola OAuth tests use a loopback callback and controlled token exchange; they do not prove a live account authorization. No customer account was connected in this change.

Jev 1.14.0 evaluated minimal synthetic scope/flow descriptions (629 input, 79 output tokens). It classified “every feature already supported” as an overclaim (0.93) and the described Granola handoff as matching the intent (0.69, with meaningful uncertainty). The scope above retains the limitation; deterministic execution and rendered checks remain the evidence.

Project additions: project creation, partial project-access updates, company standards, separate connection slots and secure Second Brain context connection are also in the typed catalog (41 actions total). Creating an account slot is explicitly reported as not authenticated; Gmail/Outlook/WhatsApp authentication still uses Project Access. A voice-only change preserves existing resources and rules.
