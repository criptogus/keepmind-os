# Security model

Paperclip is authenticated, private, and bound to 127.0.0.1. Loopback alone is not authentication: local processes can call loopback services. The operator cookie, random instance secrets, Origin headers, disabled sign-up after bootstrap, and private file permissions reduce that exposure. disableSignUp takes effect after restart; integration must verify the behavior before release.

No Electron imports exist in the core. The future shell must use OS-backed safeStorage, deny permissions, isolate renderer context, disable nodeIntegration, enable sandbox, and expose narrowly scoped IPC handlers. `ipc-validation` offers pure exact main-frame URL and payload checks. IPC handlers must derive main-frame identity from Electron's event.senderFrame and bind the check to the actual owned BrowserWindow webContents, not accept renderer-supplied sender metadata. Core implementation does not imply that shell hardening is complete.

Only the process adapter with the exact ZAOS runner argument is supported by the orchestrator. Codex and Claude dangerous approval bypass flags are rejected; hardening helpers force safe false defaults, but these adapters cannot be created by the MVP. The trusted main process chooses the command, absolute runner path, and working directory. Untrusted IPC payloads cannot supply process commands or environment variables.

BYOK keys are sent only to Paperclip's local secret endpoint and the selected provider. Adapter environments reference secret IDs. Provider endpoints require HTTPS, with HTTP allowed only for 127.0.0.1 mock services. Redirects are refused. Raw fetch errors and response bodies are not surfaced in logs. Runner results are redacted for the two API keys before posting comments. Production encryptors must never use the test identity/base64 implementations.

Paid execution defaults off. A zero budget disables upstream enforcement, so Zero Agency OS rejects zero caps and pauses agents when execution is disabled. Unknown costs block further work. See SPEND-POLICY.md.

Residual risks: another process running as the same OS user can read or modify local files and logs; file permissions are not a defense against that user. Embedded PostgreSQL is not encrypted. The runner is not OS-sandboxed in v0.1. The runner acknowledgement is trusted local execution evidence, not a signed provider receipt. A malicious replacement runner or modified log can undermine reconciliation. Provider usage may exceed estimates, and external provider billing is authoritative. Pausing an agent prevents future execution but does not guarantee cancellation of a provider request already in flight. A forced server kill can interrupt accounting and must lead to review rather than automatic replay.

Signing, notarization, external penetration testing, and production distribution are outside this phase.
