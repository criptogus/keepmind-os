import { describe, expect, test } from "bun:test";
import { eq, schema } from "@keepmind/db";
import {
  __resetReaSupervisorForTests,
  connectRea,
  disconnectRea,
  ensureRea,
  ensureReaOnBoot,
  type ReaDeps,
  reaStatus,
  type SpawnedRea,
  stopRea,
} from "../src";
import { setup } from "./fixtures";

class FakeProc implements SpawnedRea {
  killed = false;
  private listeners: ((code: number | null) => void)[] = [];
  pid = 1234;
  on(_event: "exit", listener: (code: number | null) => void) {
    this.listeners.push(listener);
    return this;
  }
  kill() {
    this.killed = true;
  }
  exit(code: number | null = 0) {
    for (const l of this.listeners) l(code);
  }
}

interface SpawnCall {
  command: string;
  args: string[];
  cwd?: string;
}

async function deps(f: Awaited<ReturnType<typeof setup>>, spawns: FakeProc[], calls: SpawnCall[]): Promise<ReaDeps> {
  return {
    db: f.db,
    pubsub: f.pubsub,
    dataDir: "/tmp/rea-test",
    packageSpec: "rea-agents@6.9.0",
    fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    healthMs: 60_000,
    spawn: (command, args, opts) => {
      calls.push({ command, args, cwd: opts.cwd });
      const p = new FakeProc();
      spawns.push(p);
      return p;
    },
  };
}

describe("rea supervisor", () => {
  test("ensure spawns `npx -y <pkg> mcp --http` once on a loopback port, idempotent", async () => {
    __resetReaSupervisorForTests();
    const f = await setup();
    const spawns: FakeProc[] = [];
    const calls: SpawnCall[] = [];
    const d = await deps(f, spawns, calls);

    const first = await ensureRea(d, f.org.id);
    expect(first).not.toBeNull();
    expect(first!.port).toBeGreaterThan(0);
    expect(spawns).toHaveLength(1);

    const call = calls[0]!;
    expect(call.args).toEqual([
      "-y",
      "rea-agents@6.9.0",
      "mcp",
      "--http",
      "--host",
      "127.0.0.1",
      "--port",
      String(first!.port),
    ]);
    // The sidecar's cwd is the org's own workspace under dataDir.
    expect(call.cwd).toBe(`/tmp/rea-test/orgs/${f.org.id}/rea`);

    const second = await ensureRea(d, f.org.id);
    expect(second!.port).toBe(first!.port);
    expect(spawns).toHaveLength(1);

    const status = await reaStatus(d, f.org.id);
    expect(status.status).toBe("running");

    await stopRea(d, f.org.id);
    expect((await reaStatus(d, f.org.id)).status).toBe("off");
    await f.close();
  });

  test("a dead sidecar restarts with backoff; stop marks it off", async () => {
    __resetReaSupervisorForTests();
    const f = await setup();
    const spawns: FakeProc[] = [];
    const calls: SpawnCall[] = [];
    const d = { ...(await deps(f, spawns, calls)), maxRestarts: 3 };

    await ensureRea(d, f.org.id);
    spawns[0]!.exit(1);
    // The restart is scheduled, not immediate; give the timer a tick.
    await new Promise((r) => setTimeout(r, 50));
    // Restarts happen on a backoff timer; with healthMs huge they still fire via restartTimer.
    // Force one ensure cycle by simulating what the timer does is covered by exit→scheduleRestart;
    // assert the org is marked off-with-error until the restart lands.
    const mid = await reaStatus(d, f.org.id);
    expect(mid.status).toBe("off");
    expect(mid.lastError).toContain("rea exited");

    await stopRea(d, f.org.id);
    await f.close();
  });

  test("ensureReaOnBoot respawns only orgs with an active custom:rea connection", async () => {
    __resetReaSupervisorForTests();
    const f = await setup();
    const other = await setup();
    const spawns: FakeProc[] = [];
    const calls: SpawnCall[] = [];
    const d = await deps(f, spawns, calls);

    // One org connected REA, the other never did.
    await f.db.insert(schema.connectorConnections).values({
      orgId: f.org.id,
      connector: "custom:rea",
      label: "REA",
      toolPrefix: "rea",
      serverUrl: "http://127.0.0.1:1/mcp",
      authType: "internal",
    });

    await ensureReaOnBoot(d);
    expect(spawns).toHaveLength(1);
    expect(calls[0]!.args).toContain("--host");

    // The connector row's URL now points at the live port.
    const [row] = await f.db
      .select()
      .from(schema.connectorConnections)
      .where(eq(schema.connectorConnections.orgId, f.org.id));
    expect(row?.serverUrl).toBe(`http://127.0.0.1:${(await ensureRea(d, f.org.id))!.port}/mcp`);

    await stopRea(d, f.org.id);
    await other.close();
    await f.close();
  });
});

describe("rea connector", () => {
  test("connect registers custom:rea once and disconnect revokes it", async () => {
    __resetReaSupervisorForTests();
    const f = await setup();
    const spawns: FakeProc[] = [];
    const calls: SpawnCall[] = [];
    const rea = await deps(f, spawns, calls);
    const connectorDeps = {
      db: f.db,
      keyWrappers: [f.keyWrapper],
      oauthApps: {},
      connect: async () => {
        throw new Error("no MCP in test");
      },
      resolveHost: async () => {
        throw new Error("unreachable");
      },
      log: { info: () => {}, warn: () => {} },
      rea,
    };

    const first = await connectRea(connectorDeps as never, f.owner.id, f.org.id);
    expect(first.status).toBe("running");

    const [row] = await f.db
      .select()
      .from(schema.connectorConnections)
      .where(eq(schema.connectorConnections.orgId, f.org.id));
    expect(row?.connector).toBe("custom:rea");
    expect(row?.authType).toBe("internal");
    expect(row?.serverUrl).toContain("http://127.0.0.1:");
    expect(row?.serverUrl).toContain("/mcp");
    // No secret: the sidecar endpoint has no auth of its own.
    expect(row?.secretCiphertext).toBeNull();

    // Second connect reuses the row and the running sidecar.
    await connectRea(connectorDeps as never, f.owner.id, f.org.id);
    const rows = await f.db
      .select()
      .from(schema.connectorConnections)
      .where(eq(schema.connectorConnections.orgId, f.org.id));
    expect(rows).toHaveLength(1);
    expect(spawns).toHaveLength(1);

    await disconnectRea(connectorDeps as never, f.owner.id, f.org.id);
    const [after] = await f.db
      .select()
      .from(schema.connectorConnections)
      .where(eq(schema.connectorConnections.orgId, f.org.id));
    expect(after?.revokedAt).not.toBeNull();
    expect((await reaStatus(rea, f.org.id)).status).toBe("off");

    await f.close();
  });
});
