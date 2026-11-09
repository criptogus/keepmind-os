# Zero Agency OS

MVP v0.1 — private, pre-release

A local-first desktop operating layer for human-governed agent teams, maintained
by Zero Agency and built on Paperclip (MIT). macOS is the first target.

License: TBD (pending owner decision)

The package metadata uses UNLICENSED until the owner decides the project license.
See THIRD_PARTY_NOTICES.md for dependency notices and pending license checks.

Phase 1 contains project configuration, directory placeholders, and supplied
design assets. Application entry points, screens, runner, tests, and integration
flows have not been implemented. No dependencies have been installed.

## Setup

Use Node >=24.11.0. The operator should run `npm install` to install dependencies
and generate package-lock.json, then use `npm ci` for subsequent reproducible
installs. No lockfile is fabricated in this offline scaffold.

After application entry points are implemented:

- `npm run dev`: renderer Vite development server on an ephemeral loopback port.
- `npm run build`: renderer to dist/renderer, Electron main to dist/main/main.js,
  and bundled CommonJS preload to dist/main/preload.cjs.
- `npm start`: launches Electron from the built output.
- `npm test`: unit tests, excluding test/integration.
- `npm run test:integration`: separate opt-in integration test project.
- `npm run typecheck`: TypeScript checks without emitting files.
- `npm run smoke:electron`: reserved smoke command; currently exits with an
  explicit unavailable message until the application and smoke flow exist.
- `npm run dist:mac`: builds unsigned DMG and ZIP artifacts for arm64 and x64;
  signing and notarization are outside MVP scope. Packaging is untested here.
- `npm run astryx -- --help`: Astryx CLI.
- `npm run scan:secrets`: local heuristic scan of tracked and untracked,
  non-ignored text files; findings identify paths without exposing values.

Build/start need the future renderer HTML and main/preload entry points. Tests
will report no test files until later phases add them. Development currently
serves an empty renderer directory. No application functionality is implied by
these commands being configured.

## Layout

Source directories separate Electron main, preload, runner, renderer, and shared
types. Tests belong in test/; optional integration tests belong in test/integration/.
Scripts, documentation, application assets, and local evidence have dedicated
folders. Runtime data, credentials, build outputs, and evidence logs are ignored.

The supplied theme is scoped to owned screens. Its font URL points to the copied
assets/fonts/Inter-Regular.ttf so Vite can bundle the asset. Paperclip board
styling and application behavior are deferred to later phases.

All requested dependencies are declared in package.json. Astryx licenses must be
verified from the installed packages before distribution. zod remains a development
dependency because this phase contains no runtime validation code; move it to
dependencies if later application code imports it at runtime.
