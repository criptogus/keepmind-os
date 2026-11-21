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

## Enterprise readiness (2026-11-21)

The market comparison and the plan are in the owner's doc "KeepMind OS: comparação com o mercado e plano
para empresas". Phase 1 is what a company's security review asks for first: company sign-in, SCIM, a second
factor, audit events sent to the company's SIEM and LGPD papers.

Done: company sign-in (SSO) through OpenID Connect, one provider per server, ADR 0188
(`apps/server/src/sso.ts`, `SSO_*` in `SELF_HOSTING.md`), and the company's directory through SCIM 2.0, ADR 0189
(`apps/server/src/routes/scim.ts`, `SCIM_TOKEN_SHA256`): accounts made, turned off and removed by Entra ID or Okta,
sessions ended at once. The phone app is not in use yet, so its company sign-in waits. Next in phase 1, in order:

1. **Second factor** (Better Auth's `two-factor` plugin, TOTP and backup codes) for password accounts.
2. **Audit events out**: the audit rows as JSON lines to a webhook or syslog for the company's SIEM.
3. **Groups from the directory** (SCIM `/Groups` mapped to channels or roles).
4. **Per-workspace SSO and SAML** for keepmind.io, where several companies share one server (ADR 0188, "Not in
   this decision").

## Agent cost and speed: what was measured on 2026-11-21

A default agent answering "oi" in a channel, on the server's real wiring with the fake model:

| | System text | Tool schemas | About |
| --- | --- | --- | --- |
| Tools on demand (the server's default) | 24,300 chars | 31,800 chars, 32 tools | 14,000 tokens |
| Every tool listed (tools on demand off) | 27,200 chars | 111,800 chars, 101 tools | 34,700 tokens |

The settled part is cached for an hour (ADR 0050), so a conversation pays most of it at the cache price.
"How you work" (9,400 chars) and "How to reply" (8,800) are the two largest sections.

Done from this: a connector's indented JSON answer is kept without its indentation
(`minifyJsonOutput` in `packages/engine/src/tools/output-filter.ts`, 25% and 38% fewer characters on a sample list of issues and of
calendar events, resent on every later turn of the run), and the apps give it its lines back for people
(`readableResult` in `packages/client/src/lib/work.ts`). The Jev key is in the deploy's `.env.example`.

Not done, and why: the prompt's words, the router, the hand-offs between agents and the speed setting were
tuned upstream against real models (`bun run eval:behavior`, `eval:router`, `eval:turns`, `eval:conversation`).
Those evals need provider keys. Changing any of them without running the evals before and after is a guess.

Next, in order:

1. Run the evals above with real keys and keep the numbers as the baseline.
2. Show a run's trace in the apps. `GET …/runs/{runId}` already returns `trace` (time by step kind, tokens,
   time per tool, stalls: `packages/engine/src/run-trace.ts`) and no screen reads it. One line in the opened
   tool block of a reply, on the web and the phone, following `.claude/skills/ui-polish`.
3. With the baseline, shorten "How you work" and "How to reply" one rule at a time, an eval run per change.

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
