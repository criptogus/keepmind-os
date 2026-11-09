# Run on macOS

Target: macOS arm64 or x64 with external Node >=24.11.0, installed using nvm or Homebrew. Set ZAOS_NODE_BINARY to an absolute compatible Node executable if PATH resolution differs when launching a desktop app. Electron's bundled Node is not the Paperclip runtime.

Use npm ci from the repository root. Do not add dependencies to resolve runtime configuration errors. npm test runs the socket-free unit suite; npm run typecheck checks TypeScript. Run ZAOS_SOCKET_TESTS=1 npm test on a host that permits loopback sockets. Run npm run test:integration separately; it boots real Paperclip with embedded PostgreSQL and a mock provider, permits 240 seconds for each boot, uses a temporary directory, and writes evidence/integration-report.json. No real key is needed for these tests.

This phase supplies the non-UI core only. The intended full-app commands are npm run dev and npm run build && npm start; Electron/renderer entry points are not implemented yet, so those commands do not currently launch a usable app. When the shell is implemented, enter a REAL provider key in Setup. The key must be stored only in Paperclip's local encrypted secret store, with operator/instance credentials protected by safeStorage. Costs are YOUR provider's charges. A provider subscription alone does not authorize execution. Configure prices, a positive cap, and explicit consent. Review every generated result; agents never publish.

The app owns a dedicated Paperclip data directory and selects ephemeral loopback ports for HTTP and embedded PostgreSQL. Keep that directory private and back it up securely. Logs and database files may contain task content. Do not share them publicly.

Packaging is intended through electron-builder using npm run dist:mac, producing unsigned arm64/x64 artifacts. Signing and notarization are out of scope. Packaging and macOS execution are untested on this box and require the later application shell and packaging verification.
