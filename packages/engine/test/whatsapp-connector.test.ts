import { describe, expect, test } from "bun:test";
import { and, eq, isNull, schema } from "@keepmind/db";
import {
  __resetWhatsAppSupervisorForTests,
  connectCustomServer,
  connectWhatsApp,
  disconnectWhatsApp,
  type McpSession,
  openWhatsAppToken,
  type SpawnedBridge,
  type WhatsAppConnectorDeps,
} from "../src";
import { setup } from "./fixtures";

class FakeProc implements SpawnedBridge {
  killed = false;
  pid = 1;
  on() {
    return this;
  }
  kill() {
    this.killed = true;
  }
}

const TOOLS = [
  ["whatsapp_list_chats", true],
  ["whatsapp_read_messages", true],
  ["whatsapp_search_messages", true],
  ["whatsapp_get_chat", true],
  ["whatsapp_mark_read", false],
  ["whatsapp_send_message", false],
  ["whatsapp_send_media", false],
  ["whatsapp_create_group", false],
] as const;

async function makeDeps(f: Awaited<ReturnType<typeof setup>>, spawns: FakeProc[]) {
  const calls: { connection: { serverUrl: string; authType?: string }; headers: Record<string, string> }[] = [];
  const session: McpSession = {
    listTools: async () =>
      TOOLS.map(([name, readOnly]) => ({
        name,
        description: `${name} tool`,
        inputSchema: { type: "object" },
        readOnlyHint: readOnly,
        destructiveHint: !readOnly && name !== "whatsapp_mark_read",
      })),
    callTool: async () => ({ content: "{}", isError: false }),
    close: async () => {},
  };
  const deps: WhatsAppConnectorDeps = {
    db: f.db,
    keyWrappers: [f.keyWrapper],
    publicUrl: "http://127.0.0.1:3088",
    connect: async (connection, headers) => {
      calls.push({ connection: connection as never, headers });
      return session;
    },
    whatsapp: {
      db: f.db,
      keyWrappers: [f.keyWrapper],
      dataDir: "/tmp/wa-test",
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
    },
  };
  return { deps, calls };
}

describe("whatsapp connector", () => {
  test("connect registers the bridge as a first-party connector and syncs tools", async () => {
    __resetWhatsAppSupervisorForTests();
    const f = await setup();
    const spawns: FakeProc[] = [];
    const { deps, calls } = await makeDeps(f, spawns);

    const result = await connectWhatsApp(deps, f.owner.id, f.org.id);
    expect(result.status).toBe("pairing");
    expect(spawns).toHaveLength(1);

    const [session] = await f.db
      .select()
      .from(schema.whatsappSessions)
      .where(eq(schema.whatsappSessions.orgId, f.org.id));
    expect(session?.status).toBe("pairing");

    const [conn] = await f.db
      .select()
      .from(schema.connectorConnections)
      .where(
        and(
          eq(schema.connectorConnections.orgId, f.org.id),
          eq(schema.connectorConnections.connector, "custom:whatsapp"),
          isNull(schema.connectorConnections.revokedAt),
        ),
      );
    expect(conn).toBeTruthy();
    expect(conn!.authType).toBe("internal");
    expect(conn!.serverUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(conn!.secretCiphertext).toBeTruthy();

    // The MCP session saw the loopback URL and the sealed bearer as a header.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.connection.serverUrl).toBe(conn!.serverUrl);
    expect(calls[0]!.connection.authType).toBe("internal");
    const token = await openWhatsAppToken(deps.whatsapp, f.org.id);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${token}`);

    // Tools synced and auto-classified: reads open, sends behind approval.
    const tools = await f.db.select().from(schema.customTools).where(eq(schema.customTools.connectionId, conn!.id));
    expect(tools).toHaveLength(8);
    const byName = new Map(tools.map((t) => [t.name, t.access]));
    expect(byName.get("whatsapp_list_chats")).toBe("read");
    expect(byName.get("whatsapp_send_message")).toBe("approval");
    expect(byName.get("whatsapp_send_media")).toBe("approval");
    expect(byName.get("whatsapp_create_group")).toBe("approval");
    expect(byName.get("whatsapp_mark_read")).toBe("write");

    await disconnectWhatsApp(deps, f.owner.id, f.org.id);
    await f.close();
  });

  test("a user-typed loopback MCP URL is still refused", async () => {
    __resetWhatsAppSupervisorForTests();
    const f = await setup();
    const spawns: FakeProc[] = [];
    const { deps } = await makeDeps(f, spawns);

    await expect(
      connectCustomServer(deps, f.owner.id, f.org.id, {
        serverUrl: "http://127.0.0.1:9999/mcp",
      }),
    ).rejects.toThrow();
    await f.close();
  });

  test("disconnect stops the bridge and revokes the connection", async () => {
    __resetWhatsAppSupervisorForTests();
    const f = await setup();
    const spawns: FakeProc[] = [];
    const { deps } = await makeDeps(f, spawns);

    await connectWhatsApp(deps, f.owner.id, f.org.id);
    await disconnectWhatsApp(deps, f.owner.id, f.org.id);

    expect(spawns[0]!.killed).toBe(true);
    const [session] = await f.db
      .select()
      .from(schema.whatsappSessions)
      .where(eq(schema.whatsappSessions.orgId, f.org.id));
    expect(session?.status).toBe("off");
    const live = await f.db
      .select()
      .from(schema.connectorConnections)
      .where(
        and(
          eq(schema.connectorConnections.orgId, f.org.id),
          eq(schema.connectorConnections.connector, "custom:whatsapp"),
          isNull(schema.connectorConnections.revokedAt),
        ),
      );
    expect(live).toHaveLength(0);
    await f.close();
  });
});
