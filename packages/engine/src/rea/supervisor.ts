import { spawn as nodeSpawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import type { PubSub } from "@keepmind/adapters";
import { and, type Database, eq, isNull, schema } from "@keepmind/db";
import { publishOrgEvent } from "../events";

/**
 * Per-org supervisor for the REA (`rea-agents`) MCP server: a Node process
 * the server spawns with `mcp --http` on a loopback port, health-checked and
 * restarted. REA reads host files for analysis, so it is opt-in per
 * organization (an admin connects it) and its working directory is
 * `<dataDir>/orgs/<orgId>/rea` — analysis output stays per-org.
 *
 * The endpoint has no auth of its own (upstream design): loopback bind plus
 * an ephemeral port is the boundary, same trust level as any local process.
 */

export type ReaStatus = "running" | "off";

/** Minimal spawn seam so tests never launch a process. */
export interface SpawnedRea {
  pid?: number;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  kill(signal?: string): void;
}
export type ReaSpawnImpl = (
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd?: string; stdio: "ignore" | "pipe" },
) => SpawnedRea;

export interface ReaDeps {
  db: Database;
  pubsub?: PubSub;
  /** Base dir; per-org workspaces live at `<dataDir>/orgs/<orgId>/rea/`. */
  dataDir: string;
  /** npm package spec the supervisor runs (`npx -y <package> mcp --http …`). */
  packageSpec: string;
  spawn?: ReaSpawnImpl;
  fetch?: typeof fetch;
  /** Health poll interval (tests: small). */
  healthMs?: number;
  /** Max automatic restarts before the sidecar stays off (tests: small). */
  maxRestarts?: number;
}

export interface ReaStatusView {
  status: ReaStatus;
  lastError: string | null;
}

interface Running {
  orgId: string;
  port: number;
  proc: SpawnedRea;
  healthTimer?: ReturnType<typeof setInterval>;
  restartTimer?: ReturnType<typeof setTimeout>;
  healthFails: number;
  restarts: number;
  stopping: boolean;
}

export const REA_CONNECTION = "custom:rea";

const running = new Map<string, Running>();
/** Concurrent ensures share one spawn; without it two callers race two servers. */
const inflight = new Map<string, Promise<{ port: number } | null>>();
const lastErrors = new Map<string, string>();
const HEALTH_FAILS_MAX = 3;
const DEFAULT_MAX_RESTARTS = 5;

export function __resetReaSupervisorForTests() {
  for (const r of running.values()) {
    r.stopping = true;
    if (r.healthTimer) clearInterval(r.healthTimer);
    if (r.restartTimer) clearTimeout(r.restartTimer);
    try {
      r.proc.kill();
    } catch {}
  }
  running.clear();
  lastErrors.clear();
}

async function freePort(): Promise<number> {
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

const defaultSpawn: ReaSpawnImpl = (command, args, opts) =>
  nodeSpawn(command, args, {
    env: opts.env,
    cwd: opts.cwd,
    stdio: opts.stdio === "pipe" ? "pipe" : "ignore",
  }) as unknown as SpawnedRea;

function broadcastStatus(deps: ReaDeps, orgId: string, event: { type: string; [k: string]: unknown }) {
  void publishOrgEvent(deps.pubsub, {
    type: "org.broadcast",
    orgId,
    event: { orgId, ...event },
  });
}

/**
 * Any HTTP answer means the MCP listener is up: streamable HTTP answers GET
 * /mcp with 4xx before a session exists, which is exactly the liveness signal
 * we need (a refused connection is the failure case).
 */
async function reaAlive(deps: ReaDeps, port: number): Promise<boolean> {
  const fetchImpl = deps.fetch ?? fetch;
  try {
    await fetchImpl(`http://127.0.0.1:${port}/mcp`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

function scheduleHealth(deps: ReaDeps, r: Running) {
  const healthMs = deps.healthMs ?? 5000;
  r.healthTimer = setInterval(() => {
    void (async () => {
      if (!(await reaAlive(deps, r.port))) r.healthFails += 1;
      else r.healthFails = 0;
      if (r.healthFails >= HEALTH_FAILS_MAX && !r.stopping) {
        if (r.healthTimer) clearInterval(r.healthTimer);
        try {
          r.proc.kill();
        } catch {}
        lastErrors.set(r.orgId, "rea health check failed");
        scheduleRestart(deps, r.orgId);
      }
    })();
  }, healthMs);
  r.healthTimer.unref?.();
}

function scheduleRestart(deps: ReaDeps, orgId: string) {
  const r = running.get(orgId);
  if (!r || r.stopping) return;
  const max = deps.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  if (r.restarts >= max) {
    lastErrors.set(orgId, "rea restart limit reached");
    running.delete(orgId);
    broadcastStatus(deps, orgId, { type: "rea.status", status: "off" });
    return;
  }
  r.restarts += 1;
  const delay = Math.min(1000 * 2 ** r.restarts, 60_000);
  r.restartTimer = setTimeout(() => {
    if (r.stopping) return;
    void ensureRea(deps, orgId).catch(() => {});
  }, delay);
  r.restartTimer.unref?.();
}

/**
 * Ensures the org's REA MCP server is running; returns its loopback port.
 * Idempotent. Returns null only when the spawn itself fails to start —
 * callers surface `lastError` through `reaStatus`.
 */
export async function ensureRea(deps: ReaDeps, orgId: string): Promise<{ port: number } | null> {
  const existing = running.get(orgId);
  if (existing && !existing.stopping) return { port: existing.port };
  const pending = inflight.get(orgId);
  if (pending) return pending;
  const p = ensureReaSpawn(deps, orgId).finally(() => inflight.delete(orgId));
  inflight.set(orgId, p);
  return p;
}

async function ensureReaSpawn(deps: ReaDeps, orgId: string): Promise<{ port: number } | null> {
  const existing = running.get(orgId);
  if (existing && !existing.stopping) return { port: existing.port };

  const port = await freePort();
  const workDir = join(deps.dataDir, "orgs", orgId, "rea");
  await mkdir(workDir, { recursive: true });
  const spawnImpl = deps.spawn ?? defaultSpawn;
  // `npx` resolves to npx.cmd on Windows; REA itself requires Node 22+.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const proc = spawnImpl(
    npx,
    ["-y", deps.packageSpec, "mcp", "--http", "--host", "127.0.0.1", "--port", String(port)],
    {
      // REA is third-party code: minimal env, never the server's secrets. It
      // does need HOME (npm cache) and PATH (node itself).
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        LANG: process.env.LANG ?? "C.UTF-8",
        LC_ALL: process.env.LC_ALL ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        // REA keeps its own config/cache under HOME; npm needs these off.
        NO_UPDATE_NOTIFIER: "1",
      },
      cwd: workDir,
      stdio: "ignore",
    },
  );

  const r: Running = {
    orgId,
    port,
    proc,
    healthFails: 0,
    restarts: existing?.restarts ?? 0,
    stopping: false,
  };
  running.set(orgId, r);
  lastErrors.delete(orgId);

  // The loopback port changes on every spawn: keep the connector row's MCP
  // URL pointed at the live one.
  await deps.db
    .update(schema.connectorConnections)
    .set({ serverUrl: `http://127.0.0.1:${port}/mcp`, updatedAt: new Date() })
    .where(
      and(eq(schema.connectorConnections.orgId, orgId), eq(schema.connectorConnections.connector, REA_CONNECTION)),
    );

  proc.on("exit", (code) => {
    if (r.stopping) return;
    running.delete(orgId);
    lastErrors.set(orgId, `rea exited (${code ?? "signal"})`);
    broadcastStatus(deps, orgId, { type: "rea.status", status: "off" });
    scheduleRestart(deps, orgId);
  });

  scheduleHealth(deps, r);
  return { port };
}

/** Stops the sidecar (admin disconnect or shutdown). */
export async function stopRea(deps: ReaDeps, orgId: string): Promise<void> {
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
  lastErrors.delete(orgId);
  broadcastStatus(deps, orgId, { type: "rea.status", status: "off" });
}

/** Boot hook: respawn sidecars whose connector row is still active. */
export async function ensureReaOnBoot(deps: ReaDeps): Promise<void> {
  const rows = await deps.db
    .select({ orgId: schema.connectorConnections.orgId })
    .from(schema.connectorConnections)
    .where(
      and(eq(schema.connectorConnections.connector, REA_CONNECTION), isNull(schema.connectorConnections.revokedAt)),
    );
  for (const row of rows) {
    await ensureRea(deps, row.orgId).catch(() => {});
  }
}

export async function reaStatus(deps: ReaDeps, orgId: string): Promise<ReaStatusView> {
  const r = running.get(orgId);
  if (r && !r.stopping) return { status: "running", lastError: null };
  const lastError = lastErrors.get(orgId) ?? null;
  return { status: "off", lastError };
}
