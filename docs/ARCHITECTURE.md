# Architecture

The Electron shell reuses the plain Node core. It takes a single-instance lock,
loads a sandboxed file renderer, starts Paperclip, authenticates the operator,
restarts with signup disabled, and audits managed agents before marking the
workspace ready. Credentials and workspace state use Electron safeStorage.
Paperclip data lives in <userData>/paperclip; ZAOS state lives in <userData>/zaos.
ZAOS_USER_DATA overrides userData before Electron is ready. Execution consent
resets on each launch. Startup failures expose a retry and local log tail.

`Supervisor` launches the external Node >=24.11.0 binary and the installed Paperclip CLI with a dedicated data directory. It polls health, reports stopped/starting/ready/unavailable/crashed, retries crashes three times with exponential backoff, and terminates the child with SIGTERM followed by SIGKILL after the grace period. Health timeout defaults to 180 seconds; integration allows 240 seconds. The external runtime is resolved from ZAOS_NODE_BINARY or PATH.

`paperclip-config` writes authenticated/private/loopback configuration before first boot. `ports` probes ephemeral IPv4 loopback ports for the server and embedded PostgreSQL, excluding 3000, 3100, 8642, 8787, and 8794. Probes cannot reserve a port across process startup; a subsequent bind failure must be surfaced and retried by the caller.

`instance-secrets` persists three independent random 32-byte hex secrets through an injected encryptor, with file mode 0600. `operator-auth` creates a random local operator identity, claims bootstrap, persists credentials, and signs in on later boots. Its callback writes disableSignUp=true. That change requires a server restart; integration verifies it against the installed version.

`PaperclipClient` carries session cookies and Origin, applies timeouts, refuses redirects, and emits bounded errors. The board window signs in through Electron session.fetch so the cookie lands in persist:zaos-board. Navigation is limited to the current loopback origin. Its injected CSS contains only neutral identity styles.

`Orchestrator` creates a company, stores BYOK keys in Paperclip's local encrypted secrets store, creates an allowlisted process runner agent, applies spend policies, gates paid execution, and polls tasks. Workspace state and persistence are injected; paid consent is never persisted and resets on process start. Call startupAudit before exposing execution after restart. The injected state must default telemetry to false and managedAgentIds to an empty list. The shell persists state through the existing encrypted storage helper. A single active task is allowed per orchestrator instance.

The runner uses agent JWT authorization and X-Paperclip-Run-Id. It discovers an assigned task, checks price and remaining budget before any provider call, records priced usage, posts the result, and requests in_review. It never marks a task done.

Paperclip's data-quality API exposes only problematic events. The runner therefore emits a bounded acknowledgement of the accepted priced cost event to stdout. The board reads that acknowledgement from the same run's log before adjusting its separate unpriced process receipt to zero. No result text or raw provider errors are printed. This trusts the managed runner and Paperclip's stored logs; it is not independent provider billing verification. Missing or malformed acknowledgement leaves cost unknown.

Tests use injected fetch/process fakes without sockets. Optional socket tests exercise the mock servers and real fake-server child. The integration suite boots real Paperclip in os.tmpdir(), uses only a local mock provider, checks authentication and listener address, and writes evidence/integration-report.json after cleanup.

The preload exposes only typed methods on window.zaos. Main-process IPC validates
both webContents identity and the exact owned main frame/URL, then payloads.
The owned renderer has a file response CSP with connect-src none, external build
scripts only, and inline styles permitted for Astryx. It cannot call providers or
Paperclip directly. React uses the installed Astryx components and built Neutral
theme with explicit light/dark mode and locally bundled Inter.

Packaged external Node entrypoints and their dependencies are unpacked from asar;
renderer, preload, and identity assets remain inside the app archive. The smoke
uses the same API facade and Orchestrator as IPC, captures actual windows, accepts
a review, disables execution, stops the supervisor, and writes a structured report.

Provider connectors use `connectors/port.ts` and a trusted registry of six
adapters. Legacy provider state migrates to custom. The existing setup remains
available; typed connector IPC uses the same exact frame and payload validation.
OpenRouter discovers models through injected fetch; other adapters use static or
operator-specified models. API execution remains in the ZAOS runner. Subscription
execution delegates to installed Codex/Claude binaries from that runner, never a
new Paperclip adapter. Binary resolution is trusted main-process PATH discovery
or launch-time ZAOS_CODEX_BIN / ZAOS_CLAUDE_BIN. See ADR 0001.
