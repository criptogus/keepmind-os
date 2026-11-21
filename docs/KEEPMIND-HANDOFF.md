# KeepMind OS: handoff

State of `main` on 2026-11-20, for whoever continues the work (a person or a coding agent).
Rules are in [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md); release gates are in
[KEEPMIND-ROADMAP.md](KEEPMIND-ROADMAP.md).

## Done in the 2026-11-20 review

- The keepmind.io compose uses the real first-owner variable, `OWNER_CLAIM_SHA256`
  (it asked for one the server never read), pins Postgres and Caddy, waits for the
  app's health check and has an optional backup service (`--profile backup`).
- Lint is clean again and the sidebar test knows the Goals tool.
- The Desktop workflow refuses a release from a commit whose CI did not pass.
- The audit log's hash chain seals each row's id and time, verifies in pages and is
  readable at `GET /api/app/organizations/{orgId}/audit/chain` (ADR 0187).
- `check:migrations` refuses two migration files with one number.
- Security reports, support and contribution questions point to this repository.

## Open, in the order to do it

1. **A first server release.** Only the `edge` image of `ghcr.io/criptogus/keepmind-os`
   exists. Tag a `v<version>` that matches `apps/server/package.json` so CI publishes
   versioned images, then point the root `docker-compose.yml`, `packages/setup`, its
   tests, `deploy/deploy.sh`, `SELF_HOSTING.md` and the help pages in `packages/i18n`
   at the fork's images instead of upstream's (`ghcr.io/agentes-chat/*`).
2. **Restore drill.** Turn on the backup profile against a real bucket, restore into an
   isolated database, compare counts. The roadmap requires it before real data.
3. **Audit chain, next step.** A key held outside the database (HMAC or signed heads)
   and a scheduled job that records the head somewhere else. Then measure the
   per-workspace lock under many concurrent agent runs (ADR 0187, "What it does not do").
4. **Show the chain in the app.** Settings › Audit has no place that calls
   `…/audit/chain` yet. Add the client method, a line with the result on the web page and
   the phone screen, and the words in `packages/i18n`.
5. **Telemetry receiver.** `TELEMETRY_URL` defaults to `https://keepmind.io/v1/report`,
   which no server answers. Keep `TELEMETRY` off, or build the receiver, or remove the default.
6. **Desktop signing.** macOS builds are not notarized and the Windows installer is not
   signed. The Apple and Windows secrets go in the repository's Actions secrets.
7. **Versions.** The server says `0.2.0-alpha.1`, the desktop `0.6.0`, the other packages
   `0.0.0`. Decide one scheme and write it in the roadmap.
8. **Upstream merges.** The package scope was renamed to `@keepmind/*`, so every upstream
   merge touches import lines. Merge upstream often and in small steps.
9. **Stale documents.** `KEEPMIND-ROADMAP.md` was last updated on 2026-11-15, before the
   goals, reminders, scheduled messages and three desktop releases. Bring it up to date.

## Left as they are, on purpose

- **Branch protection on `main` is off.** The owner pushes to `main` directly and the
  release job pushes its version commit there. The release gate covers the risk.
- **Migrations `0281` and `0282` exist twice.** They are applied; renaming them would
  stop servers from starting.
- **Branches.** Nineteen branches hold nothing `main` lacks and can be deleted in
  GitHub's branch list; fourteen hold commits that are not in `main` (squash merges and
  closed pull requests) and should be read before anyone removes them. There are no open
  pull requests.
- **WhatsApp by QR code** uses an unofficial protocol; `SELF_HOSTING.md` says so and
  says the number can be banned.
