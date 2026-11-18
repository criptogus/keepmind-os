# WhatsApp QR Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pair a WhatsApp number by QR code so agents can send/read WhatsApp messages as connector tools and people who write to the number get answers from agents in the workspace.

**Architecture:** A per-org Node sidecar (`@keepmind/whatsapp-bridge`, Baileys) spawned by the server exposes a loopback MCP endpoint registered as a first-party `whatsapp` connector, plus an internal HTTP API for pairing status and inbound/outbound messages. Inbound WhatsApp messages are mirrored into a per-org `WhatsApp` channel (one thread per chat) authored by a hidden relay agent with `meta.external` sender data; agent replies in those threads are delivered back to WhatsApp.

**Tech Stack:** Bun/Hono server, Drizzle/Postgres, `@whiskeysockets/baileys` (Node sidecar), MCP SDK, React web.

**Spec:** `docs/superpowers/specs/2026-11-17-whatsapp-qr-connector-design.md`

## Global Constraints

- Product name in code/docs stays `agentes.chat`; package scope `@keepmind/*`.
- Every tenant-owned table has `org_id`. Migrations are immutable — schema changes go in a new migration (`bun run db:generate <name>`).
- Model calls only through the Model Gateway. Secrets never reach clients; session creds stay in `<serverData>/orgs/<orgId>/whatsapp/` chmod 600.
- Custom MCP URLs must pass `assertPublicHttpsUrl`; the loopback bridge URL is server-issued only and bypasses it through a dedicated internal path — never accept a user-supplied loopback URL.
- WhatsApp content is untrusted external data: label it as such in prompts; external senders never get member authority.
- Sensitive WhatsApp actions (send_message, send_media, create_group) classify as `approval` by default.
- Bridge runs on Node (not Bun): Baileys crypto is Node-oriented.
- i18n: every user-facing string goes through `packages/i18n` en + pt-BR (other locales get English fallback via the pipeline).

## Review Focus

- Bridge process dies mid-run: supervisor must restart it and mark the connection `needs_reconnect`, never crash the server.
- QR expires or user ignores it: pairing must time out cleanly and offer a fresh QR.
- WhatsApp sends a non-text message (image/audio/sticker): must not crash inbound normalization; store a placeholder body.
- Agent replies in the WhatsApp channel from a *person* (not the agent): must NOT be delivered back to WhatsApp — only agent-authored messages go out.
- Two orgs on one server: sessions, ports, tokens and channels must never cross orgs.
- `loggedOut` event (user unlinks device): mark `needs_reconnect`, stop retrying silently.

---

### Task 1: `@keepmind/whatsapp-bridge` package scaffold + session lifecycle

**Files:**
- Create: `packages/whatsapp-bridge/package.json`
- Create: `packages/whatsapp-bridge/src/index.ts` — `startBridge(opts): Promise<BridgeHandle>`
- Create: `packages/whatsapp-bridge/src/wa.ts` — Baileys socket wrapper
- Create: `packages/whatsapp-bridge/src/events.ts` — event types + emitter
- Create: `packages/whatsapp-bridge/src/config.ts` — CLI arg parsing
- Create: `packages/whatsapp-bridge/bin/whatsapp-bridge.mjs` — Node entry (loads built JS or runs via tsx in dev)
- Test: `packages/whatsapp-bridge/test/session.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface BridgeEvent =
    | { type: "qr"; qr: string }
    | { type: "connecting" }
    | { type: "connected"; phone: string; name: string }
    | { type: "disconnected"; reason: string }
    | { type: "logged_out" }
    | { type: "message"; chat: { id: string; name: string }; sender: { id: string; name: string }; text: string; timestamp: number; hasMedia: boolean };
  interface BridgeHandle = { port: number; close(): Promise<void> };
  startBridge(opts: {
    orgId: string; dataDir: string; port: number; token: string;
    apiBaseUrl: string; // engine internal API base, e.g. http://127.0.0.1:3088
    onEvent?: (e: BridgeEvent) => void;
  }): Promise<BridgeHandle>;
  ```
- Baileys socket is injected for tests: `startBridge` accepts an optional `socketFactory` (default: real Baileys `makeWASocket`).

- [ ] **Step 1: Write the failing test** — `session.test.ts`: fake socket emits `connection.update` with QR → `onEvent` receives `{type:"qr"}`; emits `open` with `user.id` → `{type:"connected", phone}`; emits `messages.upsert` with a text message → `{type:"message", chat, sender, text}`; emits `connection.update` status `loggedOut` → `{type:"logged_out"}`; non-text message → `hasMedia: true`, `text` placeholder `"[media]"`. Also: second `startBridge` on same `dataDir` restores session without QR (creds exist → `connected`).

- [ ] **Step 2: Run test to verify it fails** — `cd packages/whatsapp-bridge && bun test` → module not found.

- [ ] **Step 3: Implement** — package.json (`"type":"module"`, deps: `@whiskeysockets/baileys`, `qrcode-terminal` not needed — QR string goes to engine; devDep `typescript`, `bun-types`). `wa.ts`: `makeWASocket({ auth: state, printQRInTerminal: false, browser: ["KeepMind OS","Chrome","1.0"], markOnlineOnConnect: false })`, `useMultiFileAuthState(dataDir)`, handlers for `connection.update` (qr/close→reason, loggedOut) and `messages.upsert` (filter `m.key.fromMe`, map `pushName`, `remoteJid`, `conversation`/`extendedTextMessage.text`, media flag). `events.ts`: tiny typed emitter. `index.ts`: wires socket→events, POSTs each event to `${apiBaseUrl}/api/internal/whatsapp/${orgId}/event` with `Authorization: Bearer ${token}` (fire-and-forget with retry×2), starts a minimal HTTP server on `port` exposing `GET /health` → `{ok:true}` (MCP lands in Task 2). `config.ts`: parse `--org-id --data-dir --port --token --api-base-url`.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit** — `feat(whatsapp): bridge package scaffold and session lifecycle`.

---

### Task 2: Bridge MCP server (agent tools over loopback)

**Files:**
- Create: `packages/whatsapp-bridge/src/mcp.ts` — MCP Streamable HTTP server + tool handlers
- Modify: `packages/whatsapp-bridge/src/index.ts` — mount MCP at `/mcp`
- Test: `packages/whatsapp-bridge/test/mcp.test.ts`

**Interfaces:**
- Consumes: `BridgeHandle`, socket send functions from Task 1 (`sendText(chatId, text)`, `sendMedia`, `listChats()`, `readMessages(chatId, limit)`, `markRead(chatId)` — expose these on the handle/`wa.ts`).
- Produces: MCP endpoint `POST /mcp` requiring `Authorization: Bearer <token>`; plus `POST /send` (`{chat_id, text}` → sends via socket, Bearer auth) used by the engine's reply delivery; tools:
  - `whatsapp_list_chats` (read) → chats with id, name, last message preview, unread count
  - `whatsapp_read_messages` (read) `{chat_id, limit?}` → last N messages `[{sender, text, at}]`
  - `whatsapp_search_messages` (read) `{query, limit?}` → matches
  - `whatsapp_get_chat` (read) `{chat_id}` → chat info + participants
  - `whatsapp_send_message` (write, sensitive) `{chat_id, text}` → sends, returns message id
  - `whatsapp_send_media` (write, sensitive) `{chat_id, media_url, caption?}` → sends
  - `whatsapp_mark_read` (write) `{chat_id}` → marks read

- [ ] **Step 1: Write failing test** — `mcp.test.ts`: start bridge with fake socket; `POST /mcp` without token → 401; `initialize` + `tools/list` → 8 tools with correct names; `tools/call whatsapp_send_message` → fake socket recorded `sendText`; `whatsapp_read_messages` → returns mapped fake history.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** — use `@modelcontextprotocol/sdk` `McpServer` + `StreamableHTTPServerTransport` (stateless mode) on the same HTTP server; token check middleware on `/mcp` only; tool handlers call the `wa.ts` functions, map Baileys errors to `isError` results; annotate tools `readOnlyHint`/`destructiveHint` so engine classification lands right (sends get `destructiveHint: true` → approval).

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Commit** — `feat(whatsapp): MCP tool surface on the bridge`.

---

### Task 3: Engine — session supervisor + pairing state

**Files:**
- Create: `packages/engine/src/whatsapp/supervisor.ts` — spawn/health/restart bridge per org
- Create: `packages/engine/src/whatsapp/status.ts` — status read model for UI
- Create: migration via `bun run db:generate whatsapp_sessions` → `packages/db/src/schema/whatsapp.ts` table `whatsapp_sessions`: `orgId` PK→organizations, `status` text (`pairing|connected|needs_reconnect|off`), `phone` text, `bridgePort` int, `bridgeTokenCiphertext`/`bridgeTokenWrappedDataKey`/`bridgeTokenKekId` text (sealed spawn token for the internal event route), `lastError` text, `createdAt/updatedAt`.
- Modify: `apps/server/src/engine.ts` — wire supervisor deps (serverDataDir from config, node binary path, bridge entry path resolution: bundled `bin/whatsapp-bridge.mjs` next to server bundle).
- Modify: `apps/server/src/workers.ts` or startup — supervisor `ensure(orgId)` on boot for `status != 'off'` rows.
- Test: `packages/engine/test/whatsapp-supervisor.test.ts`

**Interfaces:**
- Produces:
  ```ts
  ensureWhatsAppBridge(deps: WhatsAppDeps, orgId: string): Promise<{ port: number; token: string }>;
  stopWhatsAppBridge(deps, orgId): Promise<void>;
  whatsappStatus(db, orgId): Promise<{ status, phone?, lastError? } | null>;
  recordWhatsAppEvent(db, orgId, event: BridgeEvent): Promise<void>; // updates session row; qr→status pairing (QR itself is transient, pushed via pubsub)
  ```
- Bridge spawn env: `NODE_OPTIONS` none; command `node <bridgeEntry> --org-id … --data-dir <dataDir>/orgs/<orgId>/whatsapp --port <freePort> --token <random> --api-base-url http://127.0.0.1:<serverPort>`. Token: random 32B, stored **sealed** (envelope encryption like other connection secrets) in `bridgeTokenCiphertext`/`wrappedDataKey`/`kekId` columns so the engine can verify the bridge's bearer on the internal route; plaintext exists only in the spawn env and the bridge process. Free port via `net.createServer().listen(0)`.
- Health: poll `GET /health` every 5s after spawn; 3 failures → kill + `needs_reconnect`. Exponential backoff restart max 5, then `needs_reconnect`.

- [ ] **Step 1: Failing test** — with a fake spawn (inject `spawnImpl`): `ensure` inserts row `pairing`, spawns once; second `ensure` same org returns same port (idempotent); `recordWhatsAppEvent({type:"connected"})` → status `connected` + phone; `{type:"logged_out"}` → `needs_reconnect`; `{type:"qr"}` → pubsub event `whatsapp.qr` with qr payload for UI.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** supervisor + schema + migration + engine wiring.

- [ ] **Step 4: Run → passes; `bun run db:generate` migration committed.**

- [ ] **Step 5: Commit** — `feat(whatsapp): per-org bridge supervisor and session state`.

---

### Task 4: Engine — connector registration + internal routes

**Files:**
- Create: `packages/engine/src/whatsapp/connector.ts` — `registerWhatsAppConnector(deps, orgId)` creates `connector_connections` row (`connector:"whatsapp"`, `serverUrl:"http://127.0.0.1:<port>/mcp"`, `authType:"internal"`, `secretCiphertext` = sealed bearer token) + runs tool sync (reuse `syncCustomTools` path or a slim variant listing via MCP `tools/list`).
- Modify: `packages/engine/src/connectors/catalog.ts` — add `whatsapp` catalog entry (via `mcp`, scope map: list/read/search/get → `whatsapp:read`… reuse existing scope scheme `connector:whatsapp` style — follow how custom tools map; simplest: treat like custom server tools with `custom_tools` rows so admin classification UI applies).
- Modify: `packages/engine/src/connectors/mcp.ts` — outbound fetch for `authType==="internal"` connections must allow loopback: gate behind a check that `serverUrl` host is `127.0.0.1`/`localhost` AND `authType==="internal"` AND connection row exists (never user-typed URLs — those still hit `assertPublicHttpsUrl` at connect time).
- Create: `apps/server/src/routes/internal-whatsapp.ts` — `POST /api/internal/whatsapp/:orgId/event` (Bearer token = spawn token; engine unseals `bridgeToken*` from the session row and compares — constant-time). Also `POST /api/internal/whatsapp/:orgId/send` used by `deliverAgentReplyToWhatsApp` is NOT needed: the engine calls the bridge's own `/send` on its loopback port directly with the unsealed token.
- Test: `packages/engine/test/whatsapp-connector.test.ts`

**Interfaces:**
- Produces:
  ```ts
  connectWhatsApp(deps, actorId, orgId): Promise<{status:"pairing"|"connected", phone?}>; // admin-only (manage_connectors)
  disconnectWhatsApp(deps, actorId, orgId): Promise<void>; // stops bridge, revokes connection, deletes session dir
  ```
- `authType:"internal"` is a new value on the text column (no enum) — document in schema comment.

- [ ] **Step 1: Failing test** — connect → session row + connection row + tools synced from fake MCP list; agent scope grant exposes `whatsapp_send_message` behind approval; `authType internal` + loopback URL connects where a user-supplied `http://127.0.0.1` custom URL is still refused by `assertPublicHttpsUrl`; disconnect revokes + stops.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Commit** — `feat(whatsapp): register bridge as first-party connector`.

---

### Task 5: Engine — inbound messages → WhatsApp channel + reply delivery

**Files:**
- Create: `packages/engine/src/whatsapp/inbound.ts` — `handleWhatsAppEvent(db, deps, orgId, event)`
- Create: `packages/engine/src/whatsapp/channel.ts` — get-or-create org `WhatsApp` channel + per-chat thread mapping (store `chatId → threadRootId` in `whatsapp_chats` table or message meta lookup — prefer table: `whatsapp_chats(orgId, chatId, threadRootId, participantName)`)
- Migration: `whatsapp_chats` table.
- Modify: `packages/engine/src/whatsapp/connector.ts` or new `outbound.ts` — after an agent posts a message in a whatsapp thread, POST to bridge `/send` (internal route on bridge, token auth) — hook into message-post path (`messages.ts` post-commit or a `later()` job).
- Modify: authority — external sender runs get restricted toolset: implement as `authority.kind === "external"`? Simpler v1: inbound message authored by relay agent triggers run of the **designated agent** (setting `whatsapp_answer_agent_id` on session row or org setting; default: right_hand agent) with `meta.externalSender` on trigger; run-policy treats trigger meta `external:true` → read-only tools + no approvals bypass (add check in `tools/run-policy.ts`).
- Test: `packages/engine/test/whatsapp-inbound.test.ts`

**Interfaces:**
- Consumes: `BridgeEvent.message`, `insertMessage`, thread creation helpers, `deliverNotice`-adjacent paths.
- Produces:
  ```ts
  handleInboundMessage(deps, orgId, msg: Extract<BridgeEvent,{type:"message"}>): Promise<void>;
  deliverAgentReplyToWhatsApp(deps, orgId, message: Message): Promise<void>; // no-op unless message.channel is the org WhatsApp channel and author is agent and thread maps to a chat
  ```
- Inbound message row: `authorType:"agent"`, `authorAgentId` = relay agent id (create hidden agent `whatsapp-relay` per org on first connect, `hidden:true` if such flag exists — else a normal agent named "WhatsApp" with instructions "relay only"), body = `[name (+phone)]: text`… actually keep body = raw text and put sender in `meta.external = {provider:"whatsapp", senderId, senderName, chatId}`; `toTurns` labels via meta (add small rendering branch or rely on author name — simplest: authorAgentId=relay, and prefix body with sender name? The design says label; implement `meta.external` + a `viaLine`-style suffix in `toTurns` — check `viaLine` reuse).
- Reply detection: agent messages in threads listed in `whatsapp_chats` → engine POSTs to the bridge's `http://127.0.0.1:<bridgePort>/send` with the unsealed spawn token (endpoint delivered in Task 2).

- [ ] **Step 1: Failing test** — inbound event → message row in WhatsApp channel thread for that chat, relay-authored, meta.external set; second message same chat → same thread; agent reply in that thread → fake bridge `/send` received text; person message in same channel → NOT sent to WhatsApp; message with `hasMedia` → body `"[media]"` + meta flag.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Commit** — `feat(whatsapp): mirror chats into the workspace and deliver agent replies`.

---

### Task 6: Web UI — Connectors card, QR pairing, status

**Files:**
- Modify: `packages/client/src/lib/` connector listing types (add `whatsapp` first-party status fields: `pairing`, `qr`, `phone`)
- Modify: `apps/server/src/routes/app/connectors.ts` (or new `connectors-whatsapp.ts`) — `POST …/connectors/whatsapp/connect`, `…/disconnect`, `GET …/connectors/whatsapp/status` (returns `{status, phone, qr?}`; QR pushed via existing realtime pubsub `whatsapp.qr` or polled)
- Create: `apps/web/src/components/connectors/WhatsAppConnect.tsx` — card/dialog: Connect → pairing spinner + QR image (`qrcode` string → render via existing QR lib or `api.qrserver`? NO external — render with a tiny QR component; check `packages/ui` for existing QR) → connected state shows phone + Disconnect.
- Modify: connectors list page to include the card when catalog exposes `whatsapp`.
- i18n keys en + pt-BR.
- Test: `apps/web` component test for states (pairing/connected/error) + server route test.

- [ ] **Step 1: Failing tests** — route: connect (admin) → 200 pairing; status reflects session row; non-admin → 403; disconnect → off. Component: renders QR when `status.pairing && qr`, phone when connected.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement routes + UI + i18n.**

- [ ] **Step 4: Run → passes; typecheck web.**

- [ ] **Step 5: Commit** — `feat(web): WhatsApp QR pairing in Connectors`.

---

### Task 7: Docs, packaging, E2E checklist

**Files:**
- Modify: `SELF_HOSTING.md` — WhatsApp section: unofficial, ban risk, Node required, data dir location.
- Modify: `scripts/native-package.ts` (or bundling config) — include `packages/whatsapp-bridge` build output + `node_modules` for Baileys in the server bundle; ensure `node` binary availability assumption documented (bridge needs system Node ≥18 — check what desktop runner already requires).
- Modify: `.env.example` via `bun run docs:env` if any new env (e.g., `WHATSAPP_BRIDGE_DISABLED`).
- Create: `docs/whatsapp-e2e.md` — manual test checklist (pair, send, receive, approval flow, reconnect, disconnect, two orgs).

- [ ] **Step 1: Write E2E checklist doc.**
- [ ] **Step 2: Package bridge into native bundle; verify `bun run check:boundaries`.**
- [ ] **Step 3: Full `bun run ci:local` relevant subset (engine tests, web tests, typecheck, lint on changed files).**
- [ ] **Step 4: Commit** — `docs(whatsapp): self-hosting notes and E2E checklist`.

---

## Execution note

Tasks 1–2 (bridge package) are independent of 3–6 (engine/UI) once interfaces are fixed — they can be built in either order; Task 5 depends on 2+3, Task 6 on 3+4.

## E2E checklist (manual, real WhatsApp number)

- [ ] Connectors → WhatsApp card shows "Connect WhatsApp"; click → pairing chip + QR renders.
- [ ] Scan QR in WhatsApp → Aparelhos conectados; card flips to connected with the phone number.
- [ ] Send a WhatsApp DM to the paired number → a thread appears in the private `whatsapp` channel, sender shown as external (no member avatar/authority).
- [ ] The chosen answer agent (default: right hand) replies in the thread → the reply arrives on WhatsApp.
- [ ] A workspace person's message in the thread does NOT go to WhatsApp; a second inbound message lands in the same thread.
- [ ] `@mention` inside an inbound WhatsApp text does not wake the mentioned agent (meta.external guard).
- [ ] Disconnect in the card → bridge process stops, session `off`, QR cleared; reconnect pairs again.
- [ ] Kill the bridge process → supervisor restarts it; `needs_reconnect` only on logged_out.
- [ ] Agent tool calls: `list_chats`/`read_messages` run as reads; `send_message` asks approval (unless agent is "never ask").
- [ ] Server restart with status pairing/connected → `ensureWhatsAppBridgesOnBoot` respawns the bridge.
- [ ] Native package: `server/whatsapp-bridge.mjs` exists and `WHATSAPP_BRIDGE_ENTRY` is exported by the launcher.
- [ ] Docker: `docker compose up` → same flow (bridge spawned with the image's Bun).
