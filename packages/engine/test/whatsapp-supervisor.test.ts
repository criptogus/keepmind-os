import { describe, expect, test } from "bun:test";
import { orgTopic } from "@keepmind/adapters";
import { eq, schema } from "@keepmind/db";
import {
  __resetWhatsAppSupervisorForTests,
  ensureWhatsAppBridge,
  recordWhatsAppEvent,
  type SpawnedBridge,
  stopWhatsAppBridge,
  type WhatsAppDeps,
  whatsappStatus,
} from "../src/whatsapp/supervisor";
import { setup } from "./fixtures";

class FakeProc implements SpawnedBridge {
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

async function deps(f: Awaited<ReturnType<typeof setup>>, spawns: FakeProc[]): Promise<WhatsAppDeps> {
  return {
    db: f.db,
    keyWrappers: [f.keyWrapper],
    dataDir: "/tmp",
    apiBaseUrl: "http://127.0.0.1:3088",
    pubsub: f.pubsub,
    fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    healthMs: 60_000,
    spawn: () => {
      const p = new FakeProc();
      spawns.push(p);
      return p;
    },
    bridgeEntry: "/fake/bridge.mjs",
    nodeBin: "node",
  };
}

describe("whatsapp supervisor", () => {
  test("ensure inserts a pairing session and spawns once; second call is idempotent", async () => {
    __resetWhatsAppSupervisorForTests();
    const f = await setup();
    const spawns: FakeProc[] = [];
    const d = { ...(await deps(f, spawns)), dataDir: "/tmp/wa-test" };

    const first = await ensureWhatsAppBridge(d, f.org.id);
    expect(first).not.toBeNull();
    expect(first!.port).toBeGreaterThan(0);
    expect(first!.token.length).toBeGreaterThan(20);
    expect(spawns).toHaveLength(1);

    const second = await ensureWhatsAppBridge(d, f.org.id);
    expect(second!.port).toBe(first!.port);
    expect(second!.token).toBe(first!.token);
    expect(spawns).toHaveLength(1);

    const [row] = await f.db.select().from(schema.whatsappSessions).where(eq(schema.whatsappSessions.orgId, f.org.id));
    expect(row?.status).toBe("pairing");
    expect(row?.bridgePort).toBe(first!.port);
    // Token is stored sealed, never plaintext.
    expect(row?.bridgeTokenCiphertext).toBeTruthy();
    expect(row?.bridgeTokenCiphertext).not.toBe(first!.token);

    await stopWhatsAppBridge(d, f.org.id);
    await f.close();
  });

  test("events drive the session state machine and publish to the org topic", async () => {
    __resetWhatsAppSupervisorForTests();
    const f = await setup();
    const spawns: FakeProc[] = [];
    const d = { ...(await deps(f, spawns)), dataDir: "/tmp/wa-test" };
    const orgEvents: { type: string; [k: string]: unknown }[] = [];
    f.pubsub.subscribe(orgTopic(f.org.id), (e) => orgEvents.push(e as never));

    await ensureWhatsAppBridge(d, f.org.id);

    await recordWhatsAppEvent(d, f.org.id, { type: "qr", qr: "qr-payload" });
    let status = await whatsappStatus(f.db, f.org.id);
    expect(status?.status).toBe("pairing");
    // The QR itself never leaves the server: the broadcast only says one is ready.
    expect(orgEvents.some((e) => (e.event as { type?: string })?.type === "whatsapp.qr")).toBe(true);
    expect(JSON.stringify(orgEvents)).not.toContain("qr-payload");

    await recordWhatsAppEvent(d, f.org.id, { type: "connected", phone: "5511999999999", name: "Gustavo" });
    status = await whatsappStatus(f.db, f.org.id);
    expect(status?.status).toBe("connected");
    expect(status?.phone).toBe("5511999999999");

    await recordWhatsAppEvent(d, f.org.id, { type: "logged_out" });
    status = await whatsappStatus(f.db, f.org.id);
    expect(status?.status).toBe("needs_reconnect");

    await stopWhatsAppBridge(d, f.org.id);
    status = await whatsappStatus(f.db, f.org.id);
    expect(status?.status).toBe("off");
    await f.close();
  });
});
