# Security model

Paperclip is authenticated, private, and bound to 127.0.0.1. Loopback alone is not authentication: local processes can call loopback services. The operator cookie, random instance secrets, Origin headers, disabled sign-up after bootstrap, and private file permissions reduce that exposure. disableSignUp takes effect after restart; integration must verify the behavior before release.

The plain Node core remains independent of Electron. The shell uses OS-backed safeStorage, denies permissions, isolates renderer context, disables nodeIntegration, enables sandbox and webSecurity, and exposes narrowly scoped IPC handlers. `ipc-validation` offers pure exact main-frame URL and payload checks. IPC handlers derive main-frame identity from Electron's event.senderFrame and bind the check to the actual owned BrowserWindow webContents, not accept renderer-supplied sender metadata. The owned renderer has a restrictive file response CSP; navigation and window.open are denied. The board has no preload and navigation stays within its loopback origin.

Only the process adapter with the exact ZAOS runner argument is supported by the orchestrator. Codex and Claude dangerous approval bypass flags are rejected; hardening helpers force safe false defaults, but these adapters cannot be created by the MVP. The trusted main process chooses the command, absolute runner path, and working directory. Untrusted IPC payloads cannot supply process commands or environment variables.

BYOK keys are sent only to Paperclip's local secret endpoint and the selected provider. Adapter environments reference secret IDs. Provider endpoints require HTTPS, with HTTP allowed only for 127.0.0.1 mock services. Redirects are refused. Raw fetch errors and response bodies are not surfaced in logs. Runner results are redacted for the two API keys before posting comments. Unavailable OS encryption fails closed, including Linux basic_text. Only ZAOS_SMOKE=1 on Linux permits a logged test-only base64 encryptor. Never use real credentials in smoke mode.

Paid execution defaults off. A zero budget disables upstream enforcement, so Zero Agency OS rejects zero caps and pauses agents when execution is disabled. Unknown costs block further work. See SPEND-POLICY.md.

Residual risks: another process running as the same OS user can read or modify local files and logs; file permissions are not a defense against that user. Embedded PostgreSQL is not encrypted. The runner is not OS-sandboxed in v0.1. The runner acknowledgement is trusted local execution evidence, not a signed provider receipt. A malicious replacement runner or modified log can undermine reconciliation. Provider usage may exceed estimates, and external provider billing is authoritative. Pausing an agent prevents future execution but does not guarantee cancellation of a provider request already in flight. A forced server kill can interrupt accounting and must lead to review rather than automatic replay.

Signing, notarization, external penetration testing, and production distribution are outside this phase.

CLI delegation never reads vendor tokens or credential stores. Login belongs to
the unmodified vendor CLI. Execution uses shell:false, fixed safe arguments,
a fresh empty temporary cwd, a 1 MB stdout cap and SIGTERM/SIGKILL timeout.
The child environment allows only PATH, HOME, USER, LOGNAME, LANG, LC_ALL,
TMPDIR, SHELL, USERPROFILE, APPDATA, LOCALAPPDATA, SystemRoot, XDG_CONFIG_HOME.
No PAPERCLIP_, ZAOS_ or API-key variables reach the CLI child. IPC accepts no
commands, binary paths, arguments or environment overrides. Claude subscription
mode defaults OFF; enable explicitly at app launch for personal local use only.
Hermes defaults to http://127.0.0.1:8642/v1 and permits no-key requests without
Authorization. Custom URLs and Hermes require HTTPS or HTTP on 127.0.0.1 only,
with no credentials, query or fragment. Tests never probe real Hermes or port
3000: use injected fetch or excluded-port ephemeral mocks.
