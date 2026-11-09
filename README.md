# KeepMind OS

MVP v0.1 — private, pre-release

A local-first desktop operating layer for human-governed agent teams, maintained
by KeepMind and built on Paperclip (MIT). macOS is the first target.

License: TBD (pending owner decision)

The package metadata uses UNLICENSED until the owner decides the project license.
See THIRD_PARTY_NOTICES.md for dependency notices and pending license checks.

Phase 3 adds the Electron shell, isolated preload, and owned React/Astryx screens
around the existing core. Startup supervises the local Paperclip server, signs in
the operator, disables signup, and audits managed agents before opening execution.
The separate Paperclip board uses an authenticated, persistent session.

Use Node >=24.11.0 and `npm ci`. No dependencies were added for Phase 3.

- `npm test`: socket-free unit tests; two host socket tests are skipped by default.
- `ZAOS_SOCKET_TESTS=1 npm test`: also run mock HTTP and fake-child server tests.
- `npm run typecheck`: TypeScript verification.
- `npm run test:integration`: real Paperclip + local mock provider; separate opt-in
  suite with temporary storage, cleanup, and `evidence/integration-report.json`.
- `npm run scan:secrets`: local heuristic secret scan.

The sandbox denies loopback listening with EPERM. Real server integration and
socket tests must be run by the operator outside it. Mock tests require no real
provider key and generate no paid traffic.

Launch with `npm run dev` (builds and starts Electron), or `npm run build && npm start`.
On Linux with an X server, run `xvfb-run -a env ZAOS_SMOKE_LINUX=1 npm run smoke:electron`
after building. The smoke uses a temporary instance and a local mock provider,
captures six PNGs in `evidence/screenshots`, and writes `evidence/smoke-report.json`.
Electron and real Paperclip execution must be verified by the operator outside
the restricted sandbox. macOS packaging (`npm run dist:mac`) is unsigned and untested.

Paid execution defaults off. Enabling requires a BYOK secret, known prices,
positive monthly cap, and explicit consent. A cap of zero is rejected because
Paperclip treats it as disabling its budget policy. Disabling pauses the agent.
Runner output goes to human review, never automatic completion or publication.

See [Architecture](docs/ARCHITECTURE.md), [Security model](docs/SECURITY-MODEL.md),
[Spend policy](docs/SPEND-POLICY.md), [Telemetry](docs/TELEMETRY.md), and
[Run on macOS](docs/RUN-MACOS.md). Paperclip is MIT; KeepMind OS does not copy
CompanyOS code, UI, or assets. Dependency notices are in THIRD_PARTY_NOTICES.md.

Backend connectors: Custom OpenAI-compatible, OpenRouter (live model pricing),
DeepSeek (dated peak rates), Hermes local gateway, Codex, and Claude. Codex and
Claude support API keys with explicit operator prices; installed CLI delegation
uses the CLI's own login and run/timeout caps. Claude subscription delegation is
personal/local opt-in only, hidden by default; ZAOS_ENABLE_CLAUDE_SUBSCRIPTION=1
enables it. See [ADR 0001](docs/adr/0001-subscription-cli-delegation.md).
