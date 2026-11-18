# WhatsApp connector via QR code (sidecar bridge) — design

- Date: 2026-11-17
- Status: proposed

## Intent and why

KeepMind OS workspaces should reach customers where they already are. WhatsApp is the dominant channel in Brazil and
most of KeepMind's target market. The user asked for a connector paired by QR code — the unofficial WhatsApp Web
session — doing both directions: agents operate the number as a tool, and people who write to it get answers from
agents (WhatsApp as an inbound channel).

The official path already exists: the Composio preset (`whatsapp` in `connectors/presets.ts`) wraps the WhatsApp
Business Cloud API — no QR, but Meta Business verification, a dedicated number and approved message templates. QR
pairing is a different product: it binds a personal/regular WhatsApp number as a linked device. Accepted risk: the
WhatsApp client may ban the number for unofficial-client use; this is for internal/low-volume use.

## Goals

- Pair a WhatsApp number by scanning a QR code in the Connectors UI.
- Agents get WhatsApp tools through the normal connector machinery: per-agent scopes, tool classification, sensitive
  actions behind approval — same as any MCP connector.
- Inbound WhatsApp messages become workspace conversations agents can answer (a person writes on WhatsApp, an agent
  replies on WhatsApp).
- Works self-hosted: the session lives on the server that owns the workspace; no cloud relay.

## Non-goals

- No official Cloud API work (the Composio preset stays as is).
- No multi-number per org in v1 (one WhatsApp session per organization).
- No WhatsApp Business catalog/catalogs, payments or calls.
- No message history import beyond what the session syncs.

## Anti-goals

- Never let a WhatsApp contact act with a workspace member's authority. External senders are untrusted data and a
  restricted authority, like webhook-sourced content today.
- Never expose the session credentials (`creds.json`, signal keys) to clients or logs.

## Constraints

- Connectors today are remote HTTPS MCP servers only: `connectCustomServer` runs `assertPublicHttpsUrl` (SSRF guard,
  `net-guard.ts`), so a loopback bridge needs a first-party registration path, not the custom-server flow.
- The engine is Bun; Baileys (`@whiskeysockets/baileys`) is Node-oriented and its crypto stack is not guaranteed on
  Bun — the session runs in a separate process.
- The server already supervises sidecars (the desktop runner pattern); a bridge fits the same lifecycle.
- Every tenant-owned table has `org_id`; model calls go through the Model Gateway; sensitive actions need approval.

## Approaches considered

1. **Sidecar bridge (chosen).** A small always-on process (`whatsapp-bridge`, Node + Baileys) spawned and supervised
   by the server, one per org that connects. It exposes a local HTTP MCP endpoint for agent tools and posts inbound
   messages to an internal engine API. Session state lives under the org's server data dir.
   - Trade-off: a new process to ship, monitor and keep compatible with WhatsApp protocol changes.
2. **Hosted relay on keepmind.io.** Sessions live in our cloud; workspaces connect outbound. Rejected: messages
   transit our infrastructure (privacy), per-session cost, and self-hosters would depend on our cloud — against the
   self-host model. The bridge is written decoupled enough that a hosted variant is possible later.
3. **In-process Baileys in the Bun server.** Rejected: unverified Bun compatibility for Baileys' crypto, and a
   crashing session would take the whole server down.

## Design

### Components

- **`apps/server/src/whatsapp/bridge.ts`** — bridge supervisor: spawns `whatsapp-bridge.mjs` (Node) per connected
  org, health-checks it, restarts on exit, stops it when the org disconnects. Bridge port on 127.0.0.1, random high
  port, per-org bearer token generated at spawn and stored server-side only.
- **`packages/whatsapp-bridge/`** (new package, Node runtime) — the sidecar:
  - Baileys socket with `useMultiFileAuthState` under `<serverData>/whatsapp/<orgId>/` (creds + signal keys,
    chmod 600, never returned by any API).
  - Local HTTP MCP server (Streamable HTTP on loopback) exposing the agent-facing tools.
  - Inbound events POSTed to the engine's internal route with the per-org token.
- **Engine connector registration** — a first-party connector kind (`whatsapp`) that registers a `connections` row
  pointing at `http://127.0.0.1:<port>/mcp` with `authType: "internal"`, bypassing `assertPublicHttpsUrl` only for
  this server-issued loopback URL (never user-supplied). Tools sync through the existing `syncCustomTools`-style
  flow so classification, scopes and approvals apply unchanged.
- **Internal routes** (`apps/server/src/routes/internal-whatsapp.ts`, loopback + token):
  - `POST /internal/whatsapp/inbound` — bridge → engine: normalize a WhatsApp message into a workspace message.
  - Status endpoints for the UI: pairing state (`qr` payload, `connected`, phone number, `needs_reconnect`).

### Agent-facing tools (MCP)

Read tools (`*.read` scope): `whatsapp_list_chats`, `whatsapp_read_messages`, `whatsapp_get_chat`,
`whatsapp_search_messages`.
Write tools (`*.write` scope, sensitive → approval): `whatsapp_send_message`, `whatsapp_send_media`,
`whatsapp_mark_read`, `whatsapp_create_group` (v1 may defer groups).
Every tool result is labeled external/untrusted content where it carries message text.

### Inbound channel mapping

- One workspace channel per org: `WhatsApp` (kind `channel`, marked external). Each inbound message is stored with
  the sender's push name + phone as author label and `meta.external = { channel: "whatsapp", chatId, sender }`.
- Routing: a per-org setting chooses the answering agent (default: the org's right_hand/Kivo). A WhatsApp message
  mentioning `@agent` routes like a channel mention; otherwise the designated agent answers in the mirrored thread
  (one thread per WhatsApp chat keeps conversations coherent).
- Authority: external senders map to a restricted "guest" authority — they can talk to the designated agent but the
  run's tools are limited (no connector writes, no approvals bypass; sensitive actions still ask a human in the
  workspace). Exact tool policy is settled in planning.
- Delivery guardrails: rate-limit per sender, no agent-initiated cold outbound to unknown numbers without approval,
  and a "WhatsApp connected" notice posted to the channel on pairing.

### Pairing UX

Connectors page → WhatsApp card (new first-party preset, not `soon`): "Connect" → status `pairing` → UI renders the
QR (`qrcode` payload from Baileys `connection.update`) → user scans with WhatsApp → Linked devices → status
`connected` with the account's phone number. Disconnect deletes the session dir and the connection row. If the
session drops (`loggedOut`, `disconnect`), status becomes `needs_reconnect` and the card offers a new QR — same UX
as connector reconnect today.

### Data and secrets

- Session dir: `<serverData>/orgs/<orgId>/whatsapp/` — outside the repo, chmod 600, excluded from backups exports.
- The per-org bridge token is generated at spawn, held in server memory + the org's sealed storage if the bridge
  must survive restarts (v1: regenerate on spawn; inbound API only accepts it while bridge lives).
- No message content in logs beyond debug level; bridge logs go to the server log with the org tag.

## What's left to the builder

- Exact MCP tool schemas and their read/write classification.
- The guest-authority tool policy for inbound runs (which tools an external sender's run may call).
- Whether inbound media (images/audio) is downloaded to Drive or passed by reference.
- Baileys version pinning and its update policy (protocol breakage cadence).
- Rate limits and anti-ban heuristics (delays, per-day caps) — start conservative.

## Test plan (for the plan)

- Bridge unit tests with a fake WhatsApp socket (no real WhatsApp in CI).
- Engine tests: pairing state machine, inbound normalization, guest-authority routing, tool sync/classification,
  reconnect flow.
- Manual E2E on a real number before release; document ban-risk in SELF_HOSTING.
