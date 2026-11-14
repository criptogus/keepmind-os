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
| Second brain | Native memory, wiki, Drive; KeepMind SB integration | SB stdio needs an authenticated server-side bridge; no endpoint invented |
| Cron jobs | Durable routines and PostgreSQL jobs | Upstream scheduler retained; existing cron import pending |
| Guardrails | Roles, tool policies, approvals, budgets | No privilege expansion during rebrand |
| Plugins created in chat | Custom connectors and native tool engine | The previous local records-plugin draft is preserved separately; not migrated yet |
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

Remaining migrations still include existing user data, the KeepMind SB bridge, local records/CRM plugins and native packaging. This increment does not claim full parity with 0.1.22.
