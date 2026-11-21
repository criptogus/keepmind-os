# Legacy desktop app specs

These two specs describe the previous KeepMind desktop app (Electron, SQLite): the paths they
name (`src/main/auth/CredentialStore.ts`, `src/main/keepmind/sidecar.ts`) do not exist in this
repository, which is the team server rebuilt on the agentes.chat engine. They are kept as a
record of what that app still owes its users, not as work to do here.

In this codebase, provider keys and connector credentials are encrypted per organization in
PostgreSQL (`packages/engine/src/credentials.ts`, `crypto.ts`), never written in plain text.
