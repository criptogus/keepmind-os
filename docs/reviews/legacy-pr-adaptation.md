# Adapting PRs #1–#4 to the current KeepMind OS

User direction: adapt exclusive functionality as well as preserve the current app.
The migration merge retains the old branch ancestry but uses the validated current
application as its tree base. Paperclip/Postgres, the old application identity,
UNLICENSED metadata and replaced onboarding are not reintroduced.

| Original capability | Current implementation |
| --- | --- |
| #1 local desktop, teams, governed requests, human review, history, budget ledger | Current AgentManager, WorkManager, LocalAuth and governance replace the Paperclip implementation. Business setup, chat versions, PDF/PPT and OAuth remain intact. |
| #2 Custom, OpenRouter, DeepSeek, Hermes | CompatibleProviders + Advanced connection cards, model picker, real OpenAI-compatible execution and headless JSON profiles. Separate encrypted keys; HTTPS or explicit loopback; no redirect forwarding. |
| #2 model discovery and pricing | Connection test lists models; OpenRouter catalog prices can populate fields only after a user click and require saving. Other providers use operator-declared positive prices instead of stale hardcoded rates. |
| #2 per-request output/cost and subscription run/time limits | Compatible profiles cap output and accumulated run cost; agent editor adds monthly run counts and execution time limits. Existing native Codex/Claude OAuth supplies subscription authentication without spawning unrestricted CLI agents. |
| #3 company-isolated read-only KeepMind | Ported gate/scopes/service/stdio transport; administrator binds each agent to a company. Desktop and runner fail closed when bound memory is unavailable; no fallback to global memory. |
| #4 bundle restrictions and dependency allowlist | Pinned version/license inventory, CI/preflight command and afterPack ASAR/unpacked inspection. Claude Agent, Cursor and Copilot restricted SDKs are excluded; no dependency on those SDKs is introduced. |

## Standards

Review against CONTRIBUTING.md, SECURITY.md and current repository behavior.
Independent review findings and resolutions are appended after validation.

## Spec

Sources: original PR branch README, connector contracts, company-memory tests and
packaging policy; current business UX requirements take precedence over the old
technical onboarding. Compatibility replaces old infrastructure; it does not
promise identical Paperclip APIs or CLI process internals.

## Reproducible validation

Run `npm run verify:ux` for typecheck, unit/integration, build, runner, 22 Electron
checks, secret scan and dependency policy. The existing workspace-ui-check skill
now includes compatible providers and company-memory checks. Targeted tests cover
local HTTP model discovery, selected-endpoint execution with native OAuth present,
first delivery → immediate revision → acceptance, real token-cost accounting,
pre-call budget rejection, synthetic cross-company attacks and packaging rejection.

Live OpenRouter/DeepSeek/Hermes accounts and an unlocked production company vault
were not supplied. HTTP fixture validation does not claim those accounts connected.
Company binding scopes Second Brain reads; other separately granted tools retain
their own permissions. Local checkpoints can contain authorized context.

API compatibility checked against official [DeepSeek docs](https://api-docs.deepseek.com/)
and [OpenRouter API](https://openrouter.ai/docs/api_reference/overview).

The dependency inventory records existing licenses including libsignal GPL-3.0,
libvips LGPL and JSZip's MIT/GPL choice. It detects changes and excluded SDKs; it
is not a blanket license clearance for distributing an installer. No release is
published by this migration.

### Review resolutions

Standards review found three blockers: missing-usage charges did not accumulate in
the active run cap, resume reset that cap, and switching connections via Test could
reuse a pending key. Estimates now charge both the ledger and active execution;
resumed executions initialize spending from the ledger; switching profiles clears
the password. The independent Spec axis identified the same spending issues and
a missing subscription run-cap default. The default is now 1,000 requests/month,
configurable per agent; the timeout defaults to 300 seconds. Both review axes
confirmed the reviewed fixes, with no remaining runtime blocker.

### Visual follow-up requested by the owner

Unified Mantine and CSS variables around white, neutral black and #c4ff3d lime,
including the remote approvals page and PDF/PPT accents. Primary actions receive
a restrained glow; warnings retain semantic colors. Agent identities are now
monochrome initials or geometric marks, consistent in lists, selectors and chat.
Removed the avatar character shapes, mismatched green/blue status accents and
low-contrast delivery gradient. Chat entry/working indicators respect reduced
motion. Portuguese/English conversation labels now follow the selected language.

Native windows and the macOS Dock explicitly use the existing KeepMind K icon,
including development launches; the icon is copied into the built main assets.
Advanced memory controls are collapsed below everyday settings. Business examples
and agent capability labels no longer present JSON or internal identifiers.

The smoke now requires 22 checks, including cross-area light/dark palette equality,
compatible provider readiness without native OAuth, and reduced motion. Capture
and visually inspect Home, Agents, Approvals, Settings, chat and materials before
recording final evidence. macOS directory packaging runs the actual afterPack hook;
its first normalized-config failure was fixed, and a subsequent package scanned
24,202 dependency entries successfully. No release or installer publication.

Final local aggregate: 213 unit tests, 1 integration test, 22 Electron checks, typecheck/build/runner, 274-file secret scan and 462-package dependency inventory passed. Final visual inspection prompted full delivery expansion by default so tables and sources are not clipped.

Native icon changes deliberately retain the existing Electron application name used by credential storage; changing that name could select a different macOS Keychain service. Window title and packaged product identity remain KeepMind OS.
