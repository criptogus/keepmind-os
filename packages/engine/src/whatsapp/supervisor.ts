import { spawn as nodeSpawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import type { KeyWrapper, PubSub } from "@keepmind/adapters";
import { and, type Database, eq, isNull, schema } from "@keepmind/db";
import { openSecret, randomToken, safeEqual, sealSecret } from "../crypto";
import { NotFoundError } from "../errors";
import { publishOrgEvent } from "../events";

/**
 * Per-org supervisor for the whatsapp-bridge sidecar (unofficial QR/session
 * mode — the accepted ban risk is documented in the connector design doc).
 * The bridge is a Node process the server spawns, health-checks and restarts;
 * its session creds live under `<dataDir>/orgs/<orgId>/whatsapp/` and never
 * leave the server.
 */

export type WhatsAppSessionStatus = "pairing" | "connected" | "needs_reconnect" | "off";

export interface BridgeEventMessage {
  type: "message";
  chat: { id: string; name: string };
  sender: { id: string; name: string };
  text: string;
  timestamp: number;
  hasMedia: boolean;
}

export type BridgeEvent =
  | { type: "qr"; qr: string }
  | { type: "connecting" }
  | { type: "connected"; phone: string; name: string }
  | { type: "disconnected"; reason: string }
  | { type: "logged_out" }
  | BridgeEventMessage;

/** Minimal spawn seam so tests never launch a process. */
export interface SpawnedBridge {
  pid?: number;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  kill(signal?: string): void;
}
export type SpawnImpl = (
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; stdio: "ignore" | "pipe" },
) => SpawnedBridge;

export interface WhatsAppDeps {
  db: Database;
  /** Current wrapper first (seals), then legacy ones (open only). */
  keyWrappers: KeyWrapper[];
  /** Base dir; sessions live at `<dataDir>/orgs/<orgId>/whatsapp/`. */
  dataDir: string;
  /** Engine's own loopback base, e.g. http://127.0.0.1:3088 — the bridge POSTs events here. */
  apiBaseUrl: string;
  pubsub?: PubSub;
  spawn?: SpawnImpl;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Inbound `message` events go here (wired to the mirror in whatsapp/inbound.ts). */
  handleMessage?: (orgId: string, msg: BridgeEventMessage) => Promise<void>;
  /** Path to the bridge entry; defaults to the workspace package bin. */
  bridgeEntry?: string;
  nodeBin?: string;
  /** Health poll interval (tests: small). */
  healthMs?: number;
  /** Max automatic restarts before needs_reconnect (tests: small). */
  maxRestarts?: number;
}

export interface WhatsAppSessionView {
  status: WhatsAppSessionStatus;
  phone: string | null;
  lastError: string | null;
}

interface Running {
  orgId: string;
  port: number;
  token: string;
  proc: SpawnedBridge;
  healthTimer?: ReturnType<typeof setInterval>;
  restartTimer?: ReturnType<typeof setTimeout>;
  healthFails: number;
  restarts: number;
  stopping: boolean;
}

export const WHATSAPP_CONNECTION = "custom:whatsapp";

const running = new Map<string, Running>();
/** The latest pairing QR per org, for the connector UI; cleared once connected. */
const latestQr = new Map<string, string>();
const tokenAad = (orgId: string) => `whatsapp-session|${orgId}`;
const HEALTH_FAILS_MAX = 3;
const DEFAULT_MAX_RESTARTS = 5;

export function __resetWhatsAppSupervisorForTests() {
  for (const r of running.values()) {
    r.stopping = true;
    if (r.healthTimer) clearInterval(r.healthTimer);
    if (r.restartTimer) clearTimeout(r.restartTimer);
    try {
      r.proc.kill();
    } catch {}
  }
  running.clear();
  latestQr.clear();
}

async function freePort(): Promise<number> {
  // bun-types' net.Server lacks the EventEmitter methods tsc expects; the
  // runtime object has them, so describe the slice we use.
  const srv = createServer() as unknown as {
    on(event: string, listener: (...args: unknown[]) => void): void;
    listen(port: number, host: string, cb: () => void): void;
    address(): { port: number } | null;
    close(cb: () => void): void;
  };
  return new Promise((resolve, reject) => {
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address()?.port ?? 0;
      srv.close(() => resolve(port));
    });
  });
}

const defaultSpawn: SpawnImpl = (command, args, opts) =>
  nodeSpawn(command, args, {
    env: opts.env,
    stdio: opts.stdio === "pipe" ? "pipe" : "ignore",
  }) as unknown as SpawnedBridge;

async function sessionRow(db: Database, orgId: string) {
  const [row] = await db
    .select()
    .from(schema.whatsappSessions)
    .where(eq(schema.whatsappSessions.orgId, orgId))
    .limit(1);
  return row;
}

async function updateSession(db: Database, orgId: string, patch: Partial<typeof schema.whatsappSessions.$inferInsert>) {
  await db
    .insert(schema.whatsappSessions)
    .values({ orgId, ...patch })
    .onConflictDoUpdate({
      target: schema.whatsappSessions.orgId,
      set: { ...patch, updatedAt: new Date() },
    });
}

function broadcastStatus(deps: WhatsAppDeps, orgId: string, event: { type: string; [k: string]: unknown }) {
  void publishOrgEvent(deps.pubsub, {
    type: "org.broadcast",
    orgId,
    event: { orgId, ...event },
  });
}

/** Plaintext spawn token for the bridge's own loopback API (engine → bridge calls). */
export async function openWhatsAppToken(deps: WhatsAppDeps, orgId: string): Promise<string | null> {
  const row = await sessionRow(deps.db, orgId);
  if (!row?.bridgeTokenCiphertext || !row.wrappedDataKey || !row.kekId) return null;
  try {
    return await openSecret(
      deps.keyWrappers,
      {
        ciphertext: row.bridgeTokenCiphertext,
        wrappedDataKey: row.wrappedDataKey,
        kekId: row.kekId,
      },
      tokenAad(orgId),
    );
  } catch {
    return null;
  }
}

/** Constant-time check of a bearer token presented on the internal event route. */
export async function whatsappTokenMatches(deps: WhatsAppDeps, orgId: string, presented: string): Promise<boolean> {
  const expected = await openWhatsAppToken(deps, orgId);
  return expected !== null && safeEqual(expected, presented);
}

async function markNeedsReconnect(deps: WhatsAppDeps, orgId: string, reason: string) {
  await updateSession(deps.db, orgId, { status: "needs_reconnect", lastError: reason });
  broadcastStatus(deps, orgId, { type: "whatsapp.status", status: "needs_reconnect", reason });
}

function scheduleHealth(deps: WhatsAppDeps, r: Running) {
  const healthMs = deps.healthMs ?? 5000;
  const fetchImpl = deps.fetch ?? fetch;
  r.healthTimer = setInterval(() => {
    void (async () => {
      try {
        const res = await fetchImpl(`http://127.0.0.1:${r.port}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        r.healthFails = res.ok ? 0 : r.healthFails + 1;
      } catch {
        r.healthFails += 1;
      }
      if (r.healthFails >= HEALTH_FAILS_MAX && !r.stopping) {
        if (r.healthTimer) clearInterval(r.healthTimer);
        try {
          r.proc.kill();
        } catch {}
        void markNeedsReconnect(deps, r.orgId, "bridge health check failed");
        scheduleRestart(deps, r.orgId);
      }
    })();
  }, healthMs);
  r.healthTimer.unref?.();
}

function scheduleRestart(deps: WhatsAppDeps, orgId: string) {
  const r = running.get(orgId);
  if (!r || r.stopping) return;
  const max = deps.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  if (r.restarts >= max) {
    void markNeedsReconnect(deps, orgId, "bridge restart limit reached");
    return;
  }
  r.restarts += 1;
  const delay = Math.min(1000 * 2 ** r.restarts, 60_000);
  r.restartTimer = setTimeout(() => {
    if (r.stopping) return;
    void ensureWhatsAppBridge(deps, orgId).catch(() => {});
  }, delay);
  r.restartTimer.unref?.();
}

/**
 * Ensures the org's bridge process is running; returns its loopback port and
 * the plaintext token (also stored sealed in `whatsapp_sessions`). Idempotent.
 * Returns null when the session is `off`.
 */
export async function ensureWhatsAppBridge(
  deps: WhatsAppDeps,
  orgId: string,
): Promise<{ port: number; token: string } | null> {
  const existing = running.get(orgId);
  if (existing && !existing.stopping) return { port: existing.port, token: existing.token };

  const row = await sessionRow(deps.db, orgId);
  if (row?.status === "off") return null;

  // The token is stable across respawns: the connector row seals the same
  // value for MCP calls, so a restart must not rotate it.
  let token: string;
  let sealed: { ciphertext: string; wrappedDataKey: string; kekId: string } | null = null;
  if (row?.bridgeTokenCiphertext && row.wrappedDataKey && row.kekId) {
    token = await openSecret(
      deps.keyWrappers,
      {
        ciphertext: row.bridgeTokenCiphertext,
        wrappedDataKey: row.wrappedDataKey,
        kekId: row.kekId,
      },
      tokenAad(orgId),
    );
  } else {
    token = randomToken(32);
    sealed = await sealSecret(deps.keyWrappers[0]!, token, tokenAad(orgId));
  }
  const port = await freePort();
  const spawnImpl = deps.spawn ?? defaultSpawn;
  const dataDir = join(deps.dataDir, "orgs", orgId, "whatsapp");
  const bridgeEntry = deps.bridgeEntry ?? join(import.meta.dir, "../../../whatsapp-bridge/bin/whatsapp-bridge.mjs");
  const proc = spawnImpl(
    deps.nodeBin ?? "node",
    [
      bridgeEntry,
      "--org-id",
      orgId,
      "--data-dir",
      dataDir,
      "--port",
      String(port),
      "--token",
      token,
      "--api-base-url",
      deps.apiBaseUrl,
    ],
    { env: process.env, stdio: "ignore" },
  );

  const r: Running = {
    orgId,
    port,
    token,
    proc,
    healthFails: 0,
    restarts: existing?.restarts ?? 0,
    stopping: false,
  };
  running.set(orgId, r);

  // Preserve a known-good status across restarts; a fresh pairing shows QR.
  const status: WhatsAppSessionStatus = row?.phone ? (row.status as WhatsAppSessionStatus) : "pairing";
  await updateSession(deps.db, orgId, {
    status,
    bridgePort: port,
    ...(sealed
      ? {
          bridgeTokenCiphertext: sealed.ciphertext,
          wrappedDataKey: sealed.wrappedDataKey,
          kekId: sealed.kekId,
        }
      : {}),
    lastError: null,
  });
  broadcastStatus(deps, orgId, { type: "whatsapp.status", status });

  // The bridge's loopback port changes on every spawn: keep the connector
  // row's MCP URL pointed at the live one.
  await deps.db
    .update(schema.connectorConnections)
    .set({ serverUrl: `http://127.0.0.1:${port}/mcp`, updatedAt: new Date() })
    .where(
      and(eq(schema.connectorConnections.orgId, orgId), eq(schema.connectorConnections.connector, WHATSAPP_CONNECTION)),
    );

  proc.on("exit", (code) => {
    if (r.stopping) return;
    running.delete(orgId);
    void (async () => {
      await markNeedsReconnect(deps, orgId, `bridge exited (${code ?? "signal"})`);
      scheduleRestart(deps, orgId);
    })();
  });

  scheduleHealth(deps, r);
  return { port, token };
}

/** Stops the bridge and marks the session off (admin disconnect). */
export async function stopWhatsAppBridge(deps: WhatsAppDeps, orgId: string): Promise<void> {
  const r = running.get(orgId);
  if (r) {
    r.stopping = true;
    if (r.healthTimer) clearInterval(r.healthTimer);
    if (r.restartTimer) clearTimeout(r.restartTimer);
    try {
      r.proc.kill();
    } catch {}
    running.delete(orgId);
  }
  await updateSession(deps.db, orgId, { status: "off", bridgePort: null, lastError: null });
  latestQr.delete(orgId);
  broadcastStatus(deps, orgId, { type: "whatsapp.status", status: "off" });
}

/** Boot hook: respawn bridges whose session was live when the server stopped. */
export async function ensureWhatsAppBridgesOnBoot(deps: WhatsAppDeps): Promise<void> {
  const candidates = await deps.db
    .select({ orgId: schema.whatsappSessions.orgId, status: schema.whatsappSessions.status })
    .from(schema.whatsappSessions);
  for (const row of candidates) {
    if (row.status === "pairing" || row.status === "connected") {
      await ensureWhatsAppBridge(deps, row.orgId).catch(() => {});
    }
  }
}

export async function whatsappStatus(db: Database, orgId: string): Promise<WhatsAppSessionView | null> {
  const row = await sessionRow(db, orgId);
  if (!row) return null;
  return { status: row.status as WhatsAppSessionStatus, phone: row.phone, lastError: row.lastError };
}

/** Which agent answers inbound WhatsApp messages (null = the workspace right hand). */
export async function setWhatsAppAnswerAgent(db: Database, orgId: string, agentId: string | null): Promise<void> {
  if (agentId !== null) {
    const [agent] = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, orgId), isNull(schema.agents.archivedAt)))
      .limit(1);
    if (!agent) throw new NotFoundError("Agent not found");
  }
  await updateSession(db, orgId, { answerAgentId: agentId });
}

/** Status plus the live pairing QR (null once connected or off). */
export async function whatsappSessionView(
  deps: Pick<WhatsAppDeps, "db">,
  orgId: string,
): Promise<(WhatsAppSessionView & { qr: string | null; answerAgentId: string | null }) | null> {
  const row = await sessionRow(deps.db, orgId);
  if (!row) return null;
  const view = {
    status: row.status as WhatsAppSessionStatus,
    phone: row.phone,
    lastError: row.lastError,
    answerAgentId: row.answerAgentId,
  };
  return { ...view, qr: view.status === "pairing" ? (latestQr.get(orgId) ?? null) : null };
}

/** Applies a bridge event to the session row; message events go to `handleMessage`. */
export async function recordWhatsAppEvent(deps: WhatsAppDeps, orgId: string, event: BridgeEvent): Promise<void> {
  switch (event.type) {
    case "qr":
      latestQr.set(orgId, event.qr);
      await updateSession(deps.db, orgId, { status: "pairing", lastError: null });
      broadcastStatus(deps, orgId, { type: "whatsapp.qr", qr: event.qr });
      return;
    case "connecting":
      return;
    case "connected":
      latestQr.delete(orgId);
      await updateSession(deps.db, orgId, {
        status: "connected",
        phone: event.phone,
        lastError: null,
      });
      broadcastStatus(deps, orgId, { type: "whatsapp.status", status: "connected", phone: event.phone });
      return;
    case "disconnected":
      await updateSession(deps.db, orgId, { lastError: `disconnected: ${event.reason}` });
      return;
    case "logged_out":
      latestQr.delete(orgId);
      await markNeedsReconnect(deps, orgId, "device unlinked on WhatsApp");
      return;
    case "message":
      await deps.handleMessage?.(orgId, event);
      return;
  }
}
