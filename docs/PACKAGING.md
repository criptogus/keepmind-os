# Packaging KeepMind OS

Use Node >=24.11.0, run `npm ci`, and build on the destination operating system:

| Host | Command | Outputs in `release/` |
| --- | --- | --- |
| macOS | `npm run dist:mac` | arm64 and x64 DMG + ZIP |
| Windows | `npm run dist:win` | x64 NSIS installer EXE |
| Linux | `npm run dist:linux` | x64 AppImage + DEB |

Each script builds the application first and passes `--publish never`. Artifacts
use `KeepMind-OS-${version}-${os}-${arch}.${ext}`. The macOS app is
`KeepMind OS.app`; the Linux executable is `keepmind-os`. Windows uses a per-user
installer with installation directory selection. No signing configuration or
credentials are required. For local macOS builds set
`CSC_IDENTITY_AUTO_DISCOVERY=false` as in CI.

All builds are unsigned; macOS hardened runtime and notarization are disabled.
Gatekeeper and Windows SmartScreen may warn or block launch. Distribution and
runtime verification on each destination platform remain the operator's job.

## Runtime requirements and limitations

The app spawns an **external Node >=24.11.0** using `ZAOS_NODE_BINARY` or `node`
on PATH (`src/main/node-runtime.ts`). Packaged builds do **not** bundle this Node
runtime. Electron's internal Node is not used to run Paperclip. A desktop launch
may have a different PATH; set `ZAOS_NODE_BINARY` to an absolute path as needed.
Provider CLIs required by CLI connectors must also be installed separately.

Paperclip and embedded-postgres declare platform-specific optional PostgreSQL
binary dependencies. Install dependencies and build on each destination OS;
cross-building copies the host's installed binaries and does not produce a
reliable runtime. The target architecture must also have its optional binaries
installed: producing both macOS architectures does not prove both can run. The
manual CI's macos-14 host does not by itself validate x64 PostgreSQL availability.
Do not omit optional dependencies. Paperclip's installed production dependencies
remain unpacked through the existing `asarUnpack` rule, alongside `src/runner`.
Application assets, notices, renderer, main process and preload are packaged;
Node, provider credentials, user data and provider subscriptions are not bundled.

## Manual CI and verification

`.github/workflows/package.yml` runs **only** through `workflow_dispatch` in the
Actions UI. It consumes Actions minutes. Its macos-14, windows-latest and
ubuntu-latest jobs use Node 24, run `npm ci` and `npm test`, then the respective
dist script with `CSC_IDENTITY_AUTO_DISCOVERY=false`. It uses no secrets, grants
only `contents: read`, never publishes, and uploads release installers/archives.

Packaging has not been executed in the restricted development sandbox. Verify
installation, icons, launch, external links and Paperclip startup on each OS.
On a host with loopback access and a desktop, smoke can target an executable:

```sh
ZAOS_SMOKE_EXECUTABLE=/absolute/path/to/keepmind-os npm run smoke:electron
# Or use an executable AppImage; keep its runtime/FUSE prerequisites installed.
```

Without that variable the smoke still runs `electron .`. The existing
`ZAOS_SMOKE_LINUX=1` switch adds `--no-sandbox` only for the Linux smoke test.
