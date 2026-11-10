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

The packaged app bundles the official Node.js runtime pinned in
`scripts/node-runtime.json`. Each dist script fetches its target runtime before
building; `npm run dist:mac` fetches both architectures. Downloads use the official
Node distribution and verify the archive's SHA256 against `SHASUMS256.txt` before
extraction. Only the runtime binary, upstream LICENSE and VERSION.json metadata
are staged in ignored `build/node/<os>-<arch>/` and shipped in `resources/node/`.
No Node binary is committed. System `tar` is required for packaging.

At launch, `ZAOS_NODE_BINARY` overrides runtime selection. Packaged apps otherwise
use the bundled binary, falling back to `node` on PATH if it is missing;
development uses PATH. Every selected binary is checked with `--version` and must
be >=24.11.0. The bundled binary's directory is prepended to Paperclip and runner
child PATH so nested Node invocations work without a system installation.
Electron's internal Node is not used to run Paperclip. Provider CLIs required by
CLI connectors must still be installed separately.

Windows and macOS must be built on their own OS. A Windows build from Linux
fails at NSIS without Wine (`spawn wine ENOENT`). Even with Wine, the
`win-unpacked` tree would carry Linux-only native dependencies:

- `@embedded-postgres/linux-x64`
- `@img/sharp-linux-x64`

Such a cross-built Windows app would not work. Install dependencies and build
on each destination OS and architecture. The local `dist:mac` command retains
both targets, but x64 output built on Apple Silicon would carry arm64 native
dependencies; generating both archives does not make both runnable. CI uses
separate native macOS runners for this reason. Do not omit optional dependencies.
Only reviewed dependencies in `scripts/bundle-allowlist.json` can ship. The
explicit `asarUnpack` list keeps their runtime files and `src/runner` outside
ASAR for standalone Node; unrestricted `node_modules/**/*` unpacking is forbidden. Application assets, notices,
renderer, main process, preload and Node are packaged; provider credentials,
user data and provider subscriptions are not bundled.

## Bundle license policy and optional adapters

`scripts/bundle-license-policy.mjs` is the policy
source; `scripts/bundle-allowlist.json` records reviewed production package names.
After reviewing a dependency change, update that list and run
`node scripts/bundle-license-policy.mjs --write` to synchronize electron-builder's
`files` and `asarUnpack`. Run `npm run check:bundle-licenses` and `npm test` to check
configuration drift, the installed dependency tree, and nested exclusion fixtures.
These checks do not create installers. New package names are excluded by default.

The shipped app excludes `@anthropic-ai/claude-agent-sdk` and its platform
packages, `@cursor/sdk` and its platform packages, and all `@github/copilot` /
`@github/copilot-*` packages because their licenses restrict redistribution.
Exclusions apply to nested `node_modules` too. Paperclip's vendored
`@paperclipai/server/provider-assets/copilot` tree is also excluded.
The default ZAOS process runner / BYOK path does not need these SDKs.

Paperclip's registry eagerly imports Cursor Cloud. The `afterPack` hook guards
that adapter's staged server entry with lazy imports and structured unavailable
responses; it never changes the workspace dependencies. It checks both ASAR and
unpacked output for forbidden paths and fails if the upstream entry changes.
The remaining Paperclip Copilot integration code resolves its provider assets
when used; it is not a supported MVP adapter. Residual risk: deeper bundled
Paperclip code could embed Copilot payloads under other names. Path checks are
not a full license/content audit. Native packaged process startup still needs
verification after this policy change; the historical smoke below predates it.

Operators who accept upstream terms can install the SDKs themselves into a
user-writable directory (or a development tree), for example:

```sh
mkdir -p "$HOME/.keepmind-optional"
npm install --prefix "$HOME/.keepmind-optional" @anthropic-ai/claude-agent-sdk @cursor/sdk @github/copilot
export KEEPMIND_OPTIONAL_PACKAGES_DIR="$HOME/.keepmind-optional"
```

Install only the packages you need. KeepMind's `optionalAdapterStatus` /
`loadOptionalAdapter` helpers detect them dynamically through that directory's
`node_modules`, returning `available: false` and installation guidance if loading
fails. Without the variable they resolve from the app/development tree. For
Cursor Cloud status outside the packaged shim, install
`@paperclipai/adapter-cursor-cloud` there too. This detection does not enable
non-process adapters in the MVP or automatically configure Paperclip's separate
SDK resolution; advanced Paperclip use requires its own upstream configuration.
Never copy these local installations into a redistributed application.

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

For bundled-runtime verification, launch a packaged app with `ZAOS_NODE_BINARY`
unset and no system Node on PATH, then verify Paperclip startup and task execution.
Check `resources/node/VERSION.json` against the official distribution checksum and
confirm `resources/node/LICENSE` is present. Downloads and builds must be run by
the operator; the historical Linux results above predate runtime bundling.
