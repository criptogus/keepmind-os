# Shared workspaces, MCP and autonomy

KeepMind remains MIT, free and self-hosted. The same WorkManager, AgentManager,
checkpoint store and tool registry power desktop and server executions. A server
is optional; local use requires no account. Model providers charge separately.

## Start a shared server

Use Node >=24.11 and clone/install this branch. Copy
`examples/shared-workspace.json`, set your repository path, agents and project
names. Create a different random token for each principal (at least 32 characters):

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# Store generated tokens in the process environment, not in this JSON or Git.
# KEEPMIND_DEVELOPER_TOKEN=... KEEPMIND_REVIEWER_TOKEN=...
# OPENAI_API_KEY=... or ANTHROPIC_API_KEY=...
npm ci
npm run runner -- --config examples/shared-workspace.json --serve --watch
```

By default the server binds 127.0.0.1:47830. For another device, put it behind your
HTTPS reverse proxy/private network. The desktop rejects non-HTTPS remote origins
(loopback HTTP is allowed for development). There is no cloud account, billing,
Docker or database server requirement. Use your own process supervisor. One
process owns the data directory; do not mount the same SQLite database in both
desktop and server. The lock file prevents two runners writing the same directory.

In the desktop workspace, open **Connections → Shared workspace**, enter the
server origin and your token, then connect. Switching reloads the app. Local
work stays separate; nothing is uploaded or merged automatically. **Use local
workspace** explicitly disconnects. A missing token or offline server never
silently redirects mutations into local work. Tokens use the existing Electron
credential store (OS encryption where available; its documented development
fallback applies otherwise). They are never returned to the renderer after save.

Only the Work workspace, its reviews/approvals and rules switch to the server.
Agent management, automation configuration, memory and MCP settings elsewhere in
the desktop remain local. Configure server agents, routines and extensions in
its JSON file. Restart the server to apply operator configuration changes.

## Collaboration and synchronization

Each identity has a token environment variable, role, project list and agent
list. Both lists must grant access to a task. `*` explicitly grants all entries.
Use distinct secrets and identity IDs. Tokens can be revoked by removing a
principal or replacing its environment secret and restarting the server.

| Role | Capabilities |
| --- | --- |
| reader | Read authorized tasks, plans, results, rules and approvals |
| contributor | Create, run, resume, comment, revise and cancel authorized work |
| reviewer | Contributor capabilities plus accept deliveries, decide approvals, activate rules and reconcile uncertain effects |
| admin | Same workspace API rights as reviewer; server configuration remains controlled by its operator |

The desktop refreshes the authoritative snapshot every three seconds. Comments
record the actor; tasks and rules have versions. Mutations require the version
shown to the client. A stale change returns HTTP 409, preserving the newer state.
Creation uses an idempotency key and a persisted fingerprint: replaying the same
request cannot create a second task; reusing its key with different data fails.
Dependencies can reference another collaborator's task in the same project.
Completed dependencies unlock execution; review-required tasks wait for acceptance. Shared project rules are selected
within the executing principal's project and agent grants.

This is synchronized task collaboration, not offline-first replication, CRDT
editing, shared file synchronization or presence. An offline view is stale and
mutations are disabled until a refresh succeeds. After an uncertain network
response, refresh before retrying. There is no automatic network mutation retry.
Project/agent grants restrict workspace records and execution eligibility; the
server operator must also scope each agent's repository/tool credentials. They
do not create OS containers or independent filesystem sandboxes per user.

## API

Every request requires `Authorization: Bearer <token>`. Browser-origin requests
are rejected; the Electron main process is the client. No permissive CORS exists.

- `GET /v1/context`: scoped tasks/rules, agents, pending approvals and identity.
- `POST /v1/call`: JSON `{ "method": "work:list", "args": [] }`.
- Supported methods: `work:context/list/create/action/preview/checkpoint/reconcile/reviewRule/export`,
  `governance:getState/getPendingApprovals/approve/reject`.
- `work:create` requires an `Idempotency-Key` header (16–100 letters, digits,
  underscores or hyphens). Mutations use the same typed arguments as preload;
  action/reconciliation include task revision and rule review includes version.
- There is no remote shell, agent-config editing or secret-reading API.

## MCP extensions

The pinned official `@modelcontextprotocol/sdk` v1.32.2 supports the 2025-11-25
protocol and standard stdio/Streamable HTTP transports. This does not claim
support for every feature of newer protocol revisions. Tool discovery/calls are
implemented; MCP resources, prompts, OAuth onboarding and sampling are not exposed.

For local desktop, use **Connections → MCP**. Example configurations:

```json
[
  {"id":"docs","transport":"http","url":"https://your-server.example/mcp","tokenEnv":"DOCS_MCP_TOKEN","enabled":true},
  {"id":"local","transport":"stdio","command":"/absolute/path/to/node","args":["/absolute/path/to/server.mjs"],"envNames":["TOOL_TOKEN"],"enabled":false}
]
```

Enabled stdio connections execute the configured program as the current OS user.
Install and review that program separately; KeepMind does not install arbitrary
packages automatically. Only explicitly listed environment secrets are passed,
plus the SDK's standard process environment. HTTP redirects are rejected so
credentials do not follow an unexpected destination. HTTP endpoints must use
HTTPS or loopback HTTP. Connection failures produce a status without echoing
third-party messages that could contain credentials.

Connected tools receive stable names `mcp_<server>_<tool>_<hash>`, with discovery
limits and timeouts. Desktop configuration creates an MCP skill: assign it
explicitly to an agent. These skills are excluded from automatic keyword routing.
Members cannot use local MCP tools. MCP calls outside explicitly authorized reads pass through the exact-
argument approval gate, then the durable
checkpoint journal. A failure during a handler produces an uncertain effect,
which requires reconciliation before resume. Server contributors can initiate
work but need a reviewer to approve external actions.

Server MCP uses the same configuration entries under `mcp`. Add the discovered
stable names to the appropriate agent's `tools` allowlist (`npm run runner -- --config your-config.json --list-tools` lists names; the
deterministic naming helper is in McpManager.ts).
Secrets live in the server's environment. Disconnected tools are not executable.

## Autonomy

New desktop routines can **create a task for me to start** or **run and request
automatic delivery**. Existing routines with no autonomy field retain their previous
run behavior. Server JSON routines default to `"autonomy":"draft"`; `"run"`
executes them under normal budgets/approvals. `--watch` uses the current config as
the routine authority and disables removed entries. Approvals and delivery
acceptance remain separate. No general undo of third-party effects is promised.

## Signed distribution

`npm run dist:signed` and the manual `Signed installer artifacts` workflow build
artifacts without publishing a release. macOS requires `CSC_LINK`,
`CSC_KEY_PASSWORD`, `CSC_NAME`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`; Windows requires its own `CSC_LINK` and `CSC_KEY_PASSWORD`.
The workflow uses MAC_/WIN_ prefixed certificate secrets in the `release`
environment. macOS enables hardened runtime and notarization. Missing credentials
fail the build rather than producing unsigned installers. Existing unsigned
release automation remains separate. No signing credentials were supplied and
no signed installers or production release were generated by this change.

## Verification

Unit tests cover scoped access, roles, duplicate creation, conflict detection,
shared dependencies, approval isolation and restartable failures. A real stdio
MCP fixture tests discovery/calls through governance. HTTP integration uses two
clients and restarts SQLite. Electron smoke connects through the real preload,
receives a collaborator's comment, renders the shared view and disconnects while
verifying that local/remote task data remains separate. These tests use synthetic
data and no paid provider calls.

### Automatic read tools and delivery

For a trusted MCP server, an operator may add `"automaticReadTools": ["search_docs"]`
to that server's configuration. Use the original MCP tool name, not the generated
KeepMind name. It must also advertise read-only=true and destructive=false.
Only those explicit reads skip approval; unknown/write tools still ask with a reason.
Existing pending decisions are not bypassed. See WORKSPACE.md for trust boundaries.

New tasks deliver without mandatory acceptance by default. Set `reviewRequired`
to true on task creation when a review is required. Automatic delivery does not
claim human acceptance or independent validation. Existing tasks retain their policy.
