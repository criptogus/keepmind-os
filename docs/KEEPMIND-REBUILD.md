# KeepMind OS rebuild

Based on agentes-chat/agentes-chat at a01d9fdd035da52d828ad23745bce04a2c245d57.
The upstream license, NOTICE and About attribution are retained. Package scopes and internal protocol IDs remain stable to make upstream updates tractable.

## Architecture

User choice: a shared server for teams at https://keepmind.io. Bun/Hono, PostgreSQL with pgvector, React web client and Tauri desktop client. Organization isolation, role checks, encryption, model budgets and action approvals remain in the engine. The installed Electron app and SQLite databases are not modified.

## Capability preservation

| KeepMind capability | New access | Migration status |
| --- | --- | --- |
| Chat, formatted replies, questions and approvals | Channels and agent DMs | Upstream engine retained; real-provider acceptance pending |
| Agents and teams | Agents, channels, roles and routing | Upstream engine retained; SQLite import pending |
| Skills and improvement | Versioned skills and SuperAgentSkill MCP | OAuth connected in local validation; improvement proposals and library search implemented; real AI acceptance pending |
| MCP tools | Organization connectors and per-agent scopes | SuperAgentSkill and Liquid presets added |
| Second brain | Native memory, wiki, Drive; KeepMind SB integration | Native memory retained; authenticated legacy Corp HTTP bridge implemented; personal stdio bridge and real account acceptance pending |
| Cron jobs | Durable routines and PostgreSQL jobs | Upstream scheduler retained; existing cron import pending |
| Guardrails | Roles, tool policies, approvals, budgets | No privilege expansion during rebrand |
| Plugins created in chat | Custom connectors and native tool engine | Declarative records plugins ported with per-agent approval and persistence; old record import pending |
| Existing records and credentials | Explicit import with preview | No automatic conversion or credential copy |

## Deployment

Copy `deploy/keepmind/.env.example` to `deploy/keepmind/.env`, set unique secrets and the owner claim hash. Do not expose a fresh instance without the hash. Run:

```sh
docker compose --env-file deploy/keepmind/.env -f deploy/keepmind/compose.yml up -d --build
```

Point keepmind.io DNS to the chosen host before TLS provisioning. No DNS or server changes have been made. Caddy terminates TLS; PostgreSQL has no published port. Use the one-time `/owner#claim=TOKEN` URL to create the first owner. Team membership is invitation-based. Keep provider keys inside the organization's encrypted settings, never in browser configuration.

Before production: configure transactional email, backups and restore validation, verify tenant isolation and authenticated connectors, run real AI acceptance, build and sign the KeepMind desktop client. The upstream desktop updater must not be used for KeepMind releases. This branch is a reconstruction baseline, not a replacement release for 0.1.22.

## Local verification

The isolated server returned healthy database status. A synthetic account and team workspace were created through the real HTTP API, then signed in through the browser. The catalog showed SuperAgentSkill and Liquid Cybersec. SuperAgentSkill uses OAuth with PKCE and dynamic client registration, confirmed against its public authorization-server metadata. Liquid uses its API-key flow. The form follows each catalog entry’s authentication methods; regression tests cover both paths. Because anonymous MCP initialization succeeds, the OAuth-only preset explicitly continues metadata discovery rather than saving an anonymous connection. A live discovery confirmed the issuer, scopes and resource; a mocked integration checks the authorization URL, PKCE and callback. The user completed SuperAgentSkill consent and the callback returned to KeepMind with the connector Active. Real tool execution remains pending because the ChatGPT sign-in was deferred. The temporary Mac runner was stopped without installing a startup service.

The first full workspace typecheck and server/web build passed. Targeted backend tests covered MCP permissions, organization boundaries, default coordinator and catalog; UI tests covered components, connector flows, brand assets and geometry. The final artifact is rebuilt after the visual corrections. No real model or external authenticated connector was exercised in this reconstruction task. Compose configuration validates, but the Docker daemon was unavailable, so no container boot was tested.


## Skills migration increment

- Always-visible library search matches all entered terms across normalized names, descriptions, imported categories and tags. Category filtering preserves the complete matching set; tags are read from frontmatter, including nested `metadata`.
- A team skill's “Improve with AI” action sends a concrete request to an existing agent that already has the skill. It does not grant tools or alter skill assignments. The request asks for SuperAgentSkill review when connected and a proposal before changes. Only agents the person can talk to are offered; unavailable AI prevents dispatch and links to configuration.
- `update_skill` accepts `reviewOnly: true`, storing a native proposal without changing the active version even when automatic improvements are enabled. Approval uses existing management permissions and stale-content checks. Accepting a proposal saves a new version. Personal skills keep their existing editing path.
- New OAuth registrations identify the client as KeepMind OS. Existing registrations are retained.
- Verified with native proposal/permission/version tests, library UI dispatch/readiness/search tests, language validation, type checks and build. A simulated agent/tool test is not a real-provider acceptance run.

The next section implements native Second Brain access, the legacy Corp bridge and declarative records plugins. Existing user data imports, personal stdio vault support and native packaging remain pending; this branch does not claim full parity with 0.1.22.

## Second Brain and chat plugins migration

### What people can ask

- “Guarde esta decisão” / “O que combinamos sobre as palestras?”: the coordinator uses the native persistent Second Brain, preserving the same sources, private/team audience rules, corrections with history and reversible archival. Native tool names are unchanged so gateway policy and existing integrations continue to apply.
- “Crie um CRM para vender minhas palestras”: `list_plugins` supplies a ready template; `propose_plugin` saves a declarative draft; `activate_plugin` shows one approval with fields, actions and selected agents. No JSON form is needed. Managers can also ask for a different field/action schema.
- After activation, assigned agents discover generated list/create/update tools. Creation uses a stable request ID; updates require the current revision. Search ignores accents and returns pagination, including `nextOffset`, for complete retrieval/export. Disable revokes tools immediately and keeps records. A later activation restores access to the saved records.
- “Conecte este MCP”: the existing `offer_connect_app` card handles authentication, discovery and per-agent grants. Credentials stay in its protected form. MCP plugins reuse that path, rather than launching arbitrary generated code.

### Access and storage

Plugin records live in PostgreSQL within the workspace, not in the Mac's old settings store. This first port preserves the old manager-only plugin restriction: a current person with `manage_agents` must be behind every plugin call, and an agent must also be explicitly assigned. Background runs without a person are refused. Activation always requires an exact, one-time approval by someone who can manage agents; neither “never ask” nor “approve always” bypasses it. A draft/disable revision invalidates older pending activation requests. Transactions lock the plugin row, preventing concurrent lost updates. Limits: 2,000 records per plugin, 5,000,000 serialized characters, 30 fields and 12 actions. Secret-shaped values are refused; this is not comprehensive PII detection for custom CRM records.

The native Second Brain is not a silent import or sync of the existing personal/corporate vault. Existing memory and CRM stores remain untouched. Advanced KeepMind SB features such as GitHub sync, encrypted personal vaults, knowledge graphs and sleep cycles are not claimed to be migrated by this increment.

### Optional legacy Corp bridge

`apps/server/scripts/keepmind-sb-bridge.ts` exposes the legacy Corp HTTP runtime as authenticated MCP at `/mcp`. It follows [the upstream Corp bridge](https://github.com/criptogus/keepmind-corp/blob/main/tools/corp-mcp-bridge.mjs): `/api/mcp/call`, registered `agentId`, `x-keepmind-corp`, and `sb_search`, `sb_read`, `sb_list`, `sb_append`. It does not implement the personal stdio vault protocol.

An operator configures these values in a protected environment file, never in chat:

- `KEEPMIND_SB_URL`: actual Corp base URL (HTTPS, or HTTP loopback).
- `KEEPMIND_SB_AGENT_ID`: agent registered in that Corp installation for audit/policy/quota checks.
- `KEEPMIND_SB_UPSTREAM_TOKEN`: credential with only the intended vault access.
- `KEEPMIND_SB_BRIDGE_TOKEN`: separate random credential, at least 32 characters, scoped operationally to that one bridge/vault. Do not reuse an upstream token or share a bridge across unrelated workspaces.
- `KEEPMIND_SB_ALLOW_WRITE`: defaults off. When explicitly enabled, append goes only to `inbox/keepmind-os-captures.md`, rejecting obvious personal identifiers and secret-shaped content. The Corp server still enforces its own policy and scopes.
- `KEEPMIND_SB_BRIDGE_PORT`: optional loopback port (default 3090).

Run `bun --env-file=/path/to/protected.env apps/server/scripts/keepmind-sb-bridge.ts`. The process binds to 127.0.0.1 only. Deploy behind HTTPS infrastructure reachable by the team server, then connect that actual `/mcp` URL through the existing custom connector card and enter the bridge token in its protected form. This increment does not expose a local Mac service, create a startup service, change DNS, or invent a public KeepMind SB endpoint. Read tools work by default; write tools are not listed unless enabled. Upstream redirects are refused, calls time out, oversized results fail explicitly, and credential-bearing error bodies are not forwarded.

### Evidence and remaining acceptance

Deterministic tests exercise real database mutations, plugin permission/tenant/assignment checks, duplicate retries, stale revisions, disable/restore, gateway approval policy, native memory save/search/correct/archive and the bridge's MCP protocol against a simulated upstream. Existing memory trust/team and approval-level/run-policy suites cover regressions. The bridge's real Corp account and an actual model executing the full conversation remain pending. No credentials or real vault content were used in these tests.

The native plugin approval was visually checked at 1280×800 and 390×844: the primary review shows the human title, fields, actions and agents; identifiers/digest/revision stay in expandable technical details. The synthetic local preview was refused after inspection, leaving its plugin disabled. Build and affected package type checks passed; targeted UI tests and permission/concurrency/native-memory/bridge suites passed. The visual finish review found no blocking issue; existing design tokens and documentation remain unchanged. These checks do not substitute for real-model acceptance or connection to a real Corp vault.

### Migração de dados do app legado

Há um caminho offline de backup consistente e importação para uma base isolada, documentado em [KEEPMIND-LEGACY-MIGRATION.md](./KEEPMIND-LEGACY-MIGRATION.md). Preserva a origem e registra IDs para repetir sem duplicatas. Agentes ficam bloqueados, times privados, skills pessoais e rotinas inativas. Workflows, permissões sem equivalente e cronologias de memória exigem revisão antes de uma troca definitiva. Não é uma migração automática do app instalado ou do servidor de equipe.
