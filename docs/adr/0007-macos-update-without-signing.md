# ADR-0007: Custom macOS update installer for unsigned builds

Date: 2026-11-12 · Status: accepted

## Context

KeepMind OS is distributed unsigned (no Apple Developer ID certificate). Auto-update
uses `electron-updater`, whose macOS backend is Squirrel.Mac. Squirrel validates the
incoming bundle against the *installed* app's designated requirement. For ad-hoc
signatures that requirement is the binary `cdhash`, which changes on every build —
so no unsigned build can ever satisfy it. Observed failures:

- `identity: null` (no signature): "code signature did not pass validation: the code
  object is not signed at all"-class errors.
- `identity: "-"` (ad-hoc deep signature, `hardenedRuntime: false`): "code failed to
  satisfy specified code requirements" because cdhash differs per build.

## Decision

Keep `electron-updater` for update *discovery and download* (feed, `latest-mac.yml`,
zip download into the updater cache all work fine unsigned). Replace only the
*install* step on packaged macOS builds:

`src/main/updater/macInstaller.ts` (`update:install` handler):

1. Read `pending/update-info.json` for the downloaded file name and expected sha512.
2. Recompute sha512 of the zip and compare (integrity check).
3. Extract with `ditto -x -k` to a temp staging dir.
4. `codesign --verify --deep --strict` the staged `.app`.
5. **Bundle-identifier check**: the staged app's `CFBundleIdentifier` must equal
   the installed app's. The pending-dir lookup has a fallback that scans
   `~/Library/Caches/*-updater`; without this check a foreign app's cache could
   theoretically supply the payload. Added after a field incident where an
   unrelated app bundle was found at the install path.
6. Write a detached `swap.sh` that waits for this process to exit, `rm -rf`s the old
   bundle, moves the new one into place and `open`s it.
6. `app.quit()`.

`autoUpdater.autoInstallOnAppQuit = false` prevents `downloadUpdate()` from also
handing the zip to native Squirrel (which would log a guaranteed validation error).

Windows/Linux keep the standard `autoUpdater.quitAndInstall()` path.

## Consequences

- Updates work end-to-end without an Apple certificate (verified 0.1.3 → 0.1.4).
- The swap relies on write access to the install dir (`/Applications` is admin-writable
  on standard macOS setups); failure returns a readable error instead of quitting.
- No Gatekeeper notarization: first launch of a swapped app may show the usual
  "downloaded from the internet" flow if quarantine attributes are set — in practice
  `ditto`/`mv` of an already-trusted local file preserves the existing state.
- If a Developer ID certificate is obtained later, revert to `quitAndInstall()` and
  set `CSC_LINK`/`CSC_KEY_PASSWORD` in CI; this module can remain as a fallback.
