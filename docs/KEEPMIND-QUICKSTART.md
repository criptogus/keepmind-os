# KeepMind OS for developers

KeepMind OS is free, open-source software (AGPL-3.0-only). Hosting and model
providers may charge separately. This checkout builds the new team server and web
app. The old desktop 0.1.22 release is not an installer for this architecture.

## Run this fork

Use Bun 1.4.4 and PostgreSQL 18 with pgvector. Clone this repository rather than
running the upstream setup installer:

```sh
git clone https://github.com/criptogus/keepmind-os.git
cd keepmind-os
bun install --frozen-lockfile
cp .env.example .env
```

Set `DATABASE_URL` to a dedicated development database, and `AGENTES_SECRET` to a
new value generated with `openssl rand -hex 32`. Keep `.env` private. The server
applies migrations at boot. For a local-only installation, run:

```sh
bun run dev
```

Open http://localhost:5173. The API listens on port 3000. Create the owner account,
then configure a model in the application's protected AI settings. A model is
needed for agent execution; the web interface alone does not imply working AI.
Before exposing an installation publicly, configure the owner claim described below.

## Deploy KeepMind at keepmind.io

Use [the fork's Compose file](../deploy/keepmind/compose.yml), which builds this
source. Copy `deploy/keepmind/.env.example` to `deploy/keepmind/.env`. Generate
independent hex secrets for `POSTGRES_PASSWORD` and `AGENTES_SECRET`.

Generate a separate owner token, save it privately, and set
`OWNER_CLAIM_SHA256` to its SHA-256 hex digest. After boot, visit
`https://keepmind.io/owner#claim=TOKEN` to claim the first owner. This deployment
expects control of the domain, DNS pointed at the host and ports 80/443 available.

```sh
docker compose --env-file deploy/keepmind/.env -f deploy/keepmind/compose.yml up -d --build
```

This command changes a server; the documentation does not indicate that a server
has already been deployed. Configure transactional email before inviting teammates.
Back up PostgreSQL, uploaded files and the encryption secret separately, and test
restoration in an isolated environment before upgrading real data. Retain the
exact source commit and image for each deployment.

## Start with one goal

Ask the coordinator: “Crie um CRM autônomo para acompanhar meus relacionamentos.
Revise diariamente e me avise quando houver algo importante.” It proposes the
`autonomous_crm` template and presents a single activation approval naming the
assigned agents and allowed internal operations. The agent must also create a
native routine before claiming that daily monitoring is active. Review the saved
routine and its next execution in Rotinas.

After activation, assigned agents can organize records, record interactions with
sources, and prioritize follow-ups in background runs. They cannot use this grant
to send messages, delete data, grant permissions or make commitments. Native tool
policies continue to apply. Keep personal and company records in separate
workspaces. Existing assisted plugins keep their original approval behavior.

No separate agent roster, workflow diagram or JSON configuration is required to
begin. Advanced scopes, providers and routines remain available when needed.

## Contribute and validate

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the inherited engine conventions.
Open KeepMind issues and pull requests in this repository. Keep upstream copyright
and attribution. Packages use the `@keepmind/*` scope; the `agenteschat://` link scheme, `X-Agentes-*` headers and `AGENTES_*` variables are intentional compatibility IDs.

```sh
bun run lint
bun run check:boundaries
bun run check:migrations
bun run typecheck
bun test packages/engine/test/keepmind-plugins.test.ts packages/engine/test/plugin-review.test.ts packages/engine/test/run-policy.test.ts
bun run build
```

On memory-constrained machines, run `bun run typecheck` from each workspace
package sequentially instead of the parallel root command. The CI suite also
checks web behavior and container startup. See the [release gates](KEEPMIND-ROADMAP.md)
and [legacy migration procedure](KEEPMIND-LEGACY-MIGRATION.md).
