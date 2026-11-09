# Run on macOS

Target: macOS arm64 or x64 with external Node >=24.11.0, installed using nvm or Homebrew. Set ZAOS_NODE_BINARY to an absolute compatible Node executable if PATH resolution differs when launching a desktop app. Electron's bundled Node is not the Paperclip runtime.

Use npm ci from the repository root. Do not add dependencies to resolve runtime configuration errors. npm test runs the socket-free unit suite; npm run typecheck checks TypeScript. Run ZAOS_SOCKET_TESTS=1 npm test on a host that permits loopback sockets. Run npm run test:integration separately; it boots real Paperclip with embedded PostgreSQL and a mock provider, permits 240 seconds for each boot, uses a temporary directory, and writes evidence/integration-report.json. No real key is needed for these tests.

Launch with `npm run dev` (build then Electron), or `npm run build && npm start`. Enter a REAL provider key in Setup. The key is stored only in Paperclip's local encrypted secret store, with operator/instance credentials protected by safeStorage. Costs are YOUR provider's charges. A provider subscription alone does not authorize execution. Configure prices, a positive cap, and explicit consent. Review every generated result; agents never publish.

The app owns a dedicated Paperclip data directory and selects ephemeral loopback ports for HTTP and embedded PostgreSQL. Keep that directory private and back it up securely. Logs and database files may contain task content. Do not share them publicly.

Packaging is intended through electron-builder using npm run dist:mac, producing unsigned arm64/x64 artifacts. The packaged application is `KeepMind OS.app`; artifacts use the `KeepMind-OS-${version}-${os}-${arch}.${ext}` naming pattern. Open the DMG and copy `KeepMind OS.app` to Applications to install it. Signing and notarization are out of scope. Packaging and macOS execution are untested on this box and require operator packaging verification.

On a Linux host with Electron prerequisites and Xvfb, run:

```sh
npm run build
npm run test:integration
xvfb-run -a env ZAOS_SMOKE_LINUX=1 npm run smoke:electron
```

Smoke has an overall six minute limit and no paid provider calls. It writes
`evidence/smoke-report.json` and six real PNG captures under `evidence/screenshots`.
Only the Linux smoke flag adds --no-sandbox. Its Linux encryption fallback is
explicitly test-only and logged. Failed smoke instances are retained in the
printed temporary directory for diagnosis; successful instances are removed.

See [Packaging](PACKAGING.md) for all platform commands, manual CI, unsigned warnings, and external Node/PostgreSQL requirements.
