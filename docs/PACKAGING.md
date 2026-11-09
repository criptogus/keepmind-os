# Packaging KeepMind OS

Use Node >=24.11.0, run `npm install --no-audit --no-fund`, and build on the
destination operating system and architecture:

| Host | Command | Outputs in `release/` |
| --- | --- | --- |
| macOS Apple Silicon | `npm run dist:mac:arm64` | arm64 DMG + ZIP |
| macOS Intel | `npm run dist:mac:x64` | x64 DMG + ZIP |
| macOS (local, both targets) | `npm run dist:mac` | arm64 and x64 DMG + ZIP |
| Windows | `npm run dist:win` | x64 NSIS installer EXE |
| Linux | `npm run dist:linux` | x64 AppImage + DEB |

Each script builds the application first and passes `--publish never`. Artifacts
use `KeepMind-OS-${version}-${os}-${arch}.${ext}`. The macOS app is
`KeepMind OS.app`; the Linux executable is `keepmind-os`. Windows uses a per-user
installer with installation directory selection. No signing configuration or
credentials are required. For local macOS builds set
`CSC_IDENTITY_AUTO_DISCOVERY=false` as in CI.

With npm 11, `npm ci` can report that package.json and package-lock.json are not
in sync, including missing `@anthropic-ai/claude-agent-sdk@0.3.257` and platform
variants, even immediately after `npm install`. This is a lockfile quirk with
paperclipai's optional platform dependencies; use `npm install --no-audit
--no-fund` instead. npm 11 also blocked `@paperclipai/server`'s postinstall through
install-scripts approval in the verified run; the app still worked.

All builds are unsigned; macOS hardened runtime and notarization are disabled.
Gatekeeper may require right-click → Open. For a trusted downloaded app, removing
quarantine with `xattr -dr com.apple.quarantine "/Applications/KeepMind OS.app"`
may also be needed. Windows SmartScreen may require **More info → Run anyway**.
Installation and runtime verification on each destination platform remain the
operator's job.

## Runtime requirements and limitations

The packaged app still requires an **external Node >=24.11.0** using
`ZAOS_NODE_BINARY` or `node` on PATH (`src/main/node-runtime.ts`). Packaged builds
do **not** bundle this Node runtime. **Bundle Node runtime** is the main remaining
gap for end-user installs. Electron's internal Node is not used to run Paperclip.
A desktop launch may have a different PATH; set `ZAOS_NODE_BINARY` to an absolute
path as needed. Provider CLIs required by CLI connectors must also be installed
separately.

Windows and macOS must be built on their own OS. A Windows build from Linux
fails at NSIS without Wine (`spawn wine ENOENT`). Even with Wine, the
`win-unpacked` tree would carry Linux-only native dependencies:

- `@embedded-postgres/linux-x64`
- `@img/sharp-linux-x64`
- `@cursor/sdk-linux-x64`
- Paperclip Copilot `linux-x64` prebuilds

Such a cross-built Windows app would not work. Install dependencies and build
on each destination OS and architecture. The local `dist:mac` command retains
both targets, but x64 output built on Apple Silicon would carry arm64 native
dependencies; generating both archives does not make both runnable. CI uses
separate native macOS runners for this reason. Do not omit optional dependencies.
Paperclip's installed production dependencies remain unpacked through the
existing `asarUnpack` rule, alongside `src/runner`. Application assets, notices,
renderer, main process and preload are packaged; Node, provider credentials,
user data and provider subscriptions are not bundled.

## Verified Linux results

Verified outside the restricted development sandbox on **2026-11-09**, Linux x64,
with npm **11.21.1** and Node **24.22.1**. A clean `npm install` followed by
`npm run dist:linux` produced:

| Artifact | Size (bytes) |
| --- | ---: |
| `release/KeepMind-OS-0.1.0-linux-x86_64.AppImage` | 1,047,282,374 |
| `release/KeepMind-OS-0.1.0-linux-amd64.deb` | 961,839,864 |

The full Electron smoke **passed on the packaged AppImage** using
`ZAOS_SMOKE_EXECUTABLE=<AppImage>`, `APPIMAGE_EXTRACT_AND_RUN=1`,
`ZAOS_SMOKE_LINUX=1`, and `xvfb-run`. Paperclip and embedded Postgres booted,
operator authentication succeeded, a mock task succeeded, its review was
accepted, and the board opened. This verifies the AppImage runtime; it does not
establish DEB installation or Windows/macOS runtime verification.

## Manual CI and verification

`.github/workflows/package.yml` runs **only** through `workflow_dispatch` in the
Actions UI. Triggering it costs Actions minutes. Its matrix uses `macos-14`
(arm64, `dist:mac:arm64` only), `macos-13` (Intel x64, `dist:mac:x64` only),
`windows-latest` (`dist:win`), and `ubuntu-latest` (`dist:linux`). Each job uses
Node 24, runs `npm install --no-audit --no-fund` and `npm test` before packaging,
and sets `CSC_IDENTITY_AUTO_DISCOVERY=false`. It uses no secrets, grants only
`contents: read`, never publishes, and uploads release installers/archives per
OS runner.

Verify installation, icons, launch, external links and Paperclip startup on each
OS. On a host with loopback access and a desktop, smoke can target an executable:

```sh
ZAOS_SMOKE_EXECUTABLE=/absolute/path/to/keepmind-os npm run smoke:electron
# Packaged AppImage on a headless Linux host:
ZAOS_SMOKE_EXECUTABLE=/absolute/path/to/KeepMind-OS-0.1.0-linux-x86_64.AppImage \
  ZAOS_SMOKE_LINUX=1 xvfb-run -a npm run smoke:electron
```

When `ZAOS_SMOKE_EXECUTABLE` ends with `.AppImage`, the child environment defaults
`APPIMAGE_EXTRACT_AND_RUN` to `1` so FUSE is not required; an explicit value is
preserved. Without the executable variable the smoke still runs `electron .`.
The existing `ZAOS_SMOKE_LINUX=1` switch adds `--no-sandbox` only for the Linux
smoke test.
