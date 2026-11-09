# Zero Agency OS

MVP v0.1 — private, pre-release

A local-first desktop operating layer for human-governed agent teams, maintained
by Zero Agency and built on Paperclip (MIT). macOS is the first target.

License: TBD (pending owner decision)

The package metadata uses UNLICENSED until the owner decides the project license.
See THIRD_PARTY_NOTICES.md for dependency notices and pending license checks.

Phase 2 implements the non-UI core: private Paperclip configuration and supervision,
operator authentication, encrypted credential persistence, a typed board client,
spend and adapter guards, generic templates, orchestration, pure IPC validators,
and a dependency-free BYOK runner. Electron/preload/renderer entry points remain
for the next phase; this is not yet a usable desktop app.

Use Node >=24.11.0 and `npm ci`. Dependencies are installed and locked; no new
packages were added for Phase 2.

- `npm test`: socket-free unit tests; two host socket tests are skipped by default.
- `ZAOS_SOCKET_TESTS=1 npm test`: also run mock HTTP and fake-child server tests.
- `npm run typecheck`: TypeScript verification.
- `npm run test:integration`: real Paperclip + local mock provider; separate opt-in
  suite with temporary storage, cleanup, and `evidence/integration-report.json`.
- `npm run scan:secrets`: local heuristic secret scan.

The sandbox denies loopback listening with EPERM. Real server integration and
socket tests must be run by the operator outside it. Mock tests require no real
provider key and generate no paid traffic.

The intended full-app commands are `npm run dev`, `npm run build && npm start`,
and `npm run dist:mac` (unsigned electron-builder artifacts). Application entry
points are not implemented yet, so build/start/packaging remain unavailable.
macOS, packaging, signing, notarization, and Electron smoke verification are not
covered by the core unit tests.

Paid execution defaults off. Enabling requires a BYOK secret, known prices,
positive monthly cap, and explicit consent. A cap of zero is rejected because
Paperclip treats it as disabling its budget policy. Disabling pauses the agent.
Runner output goes to human review, never automatic completion or publication.

See [Architecture](docs/ARCHITECTURE.md), [Security model](docs/SECURITY-MODEL.md),
[Spend policy](docs/SPEND-POLICY.md), [Telemetry](docs/TELEMETRY.md), and
[Run on macOS](docs/RUN-MACOS.md). Paperclip is MIT; Zero Agency OS does not copy
CompanyOS code, UI, or assets. Dependency notices are in THIRD_PARTY_NOTICES.md.
