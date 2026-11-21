# KeepMind OS: instructions for coding agents

This file is for Codex and any other coding agent. Read it first, then `CLAUDE.md` in full:
that file holds the engineering rules and the map of where everything lives, and it applies
to every agent, not only to Claude. `docs/KEEPMIND-HANDOFF.md` lists what is done and what
is next.

## What this is

A fork of agentes.chat, rebranded as KeepMind OS, for teams at keepmind.io: a Slack-style
workspace where people and AI agents work together. Bun, Hono and Drizzle on the server,
PostgreSQL as the only required dependency, React with Vite on the web, Expo on the phone,
Tauri on the desktop. The owner is not a programmer: explain results in plain words and
never leave a step for them to run in a terminal.

## Setup

```sh
bun install --frozen-lockfile
```

Bun's version is `packageManager` in `package.json`. Unit tests need no database, no
Docker, no `.env` and no network: they run on in-memory PGlite and fake providers. Two
packages of the WhatsApp bridge come straight from GitHub; in a sandbox that blocks them
the install reports two failures and everything else still works.

## Before you say a change is done

Run these, in this order, and fix what they show:

```sh
bun run format            # fixes formatting and import order
bun run lint              # must end with no errors (warnings are known)
bun run check:boundaries
bun run check:migrations
bun run typecheck         # low on memory: run `bun run typecheck` inside each package instead
bun test path/to/the/files/you/touched.test.ts
```

Never run the whole test suite to fix one failure: run the one file. CI runs everything.

## Rules that are easy to break

- Format before every commit. An unformatted file fails CI for everyone.
- Migrations are immutable once committed. A change is a new migration:
  `bun run db:generate <name>`. Generate it on top of the newest `main`, never two with
  the same number (`check:migrations` refuses that).
- A new tool, sidebar item or route usually has a list somewhere that a test compares.
  Search the tests for the neighbouring name and add yours.
- Environment variables exist only in `packages/config/src/schema.ts`. Check the real
  name there before writing one into a compose file or a doc, then run `bun run docs:env`.
- Every tenant-owned table has `org_id`. Model calls go only through the Model Gateway.
  No key ever reaches a client.
- Names: the product is KeepMind OS and packages are `@keepmind/*`. Keep `agenteschat://`,
  `X-Agentes-*` and `AGENTES_*` exactly as they are (compatibility ids), and keep the
  upstream attribution, LICENSE and NOTICE.
- A new architecture decision gets an ADR in `docs/adr/` and a row in its README.
- Comments and docs are public: give the reason or the ADR, never an internal planning id.

## Git and releases

- Work lands on `main`. Fetch and rebase onto `origin/main` right before pushing.
- After a push, wait for the "CI result" check of your commit and fix it if it is red.
  Do not stack new features on a red `main`. Every push to `main` gets its own run (about
  30 minutes for a change that touches everything) and runs no longer cancel each other.
- The Desktop workflow refuses a release (`fix`, `feature`, `major`) unless that check
  passed on the commit. `none` only makes a test build.
- Do not delete branches, tags, releases or data, and do not change repository settings,
  unless the owner asked for exactly that.
- Never commit a `.env`, a key or real customer data. `gitleaks` runs in CI.
