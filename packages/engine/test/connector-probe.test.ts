import { afterEach, expect, test } from "bun:test";
import { and, eq, schema } from "@keepmind/db";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CONNECTOR_PROBE_JOB,
  CONNECTOR_PROBE_WINDOW_MS,
  type ConnectorDeps,
  createApiKeyConnection,
  enqueueConnectorProbes,
  markToReconnect,
  probeConnection,
  probeConnectionById,
} from "../src";
import { fakeGithubMcp } from "./fake-mcp";
import { type Fixture, setup } from "./fixtures";

const outboxKinds = async (db: Fixture["db"]) =>
  (await db.select({ kind: schema.outbox.kind }).from(schema.outbox)).map((r) => r.kind);

let f: Fixture;
afterEach(() => f?.close());

const depsOf = (fx: Fixture, extra: Partial<ConnectorDeps> = {}): ConnectorDeps => ({
  db: fx.db,
  keyWrappers: [fx.keyWrapper],
  publicUrl: "https://chat.example.com",
  oauthApps: { github: { clientId: "gh-client", clientSecret: "gh-secret" } },
  ...extra,
});

const rowOf = async (fx: Fixture, id: string) =>
  (await fx.db.select().from(schema.connectorConnections).where(eq(schema.connectorConnections.id, id)))[0];

const mustRow = async (fx: Fixture, id: string) => {
  const row = await rowOf(fx, id);
  if (!row) throw new Error("connection row missing");
  return row;
};

test("enqueueConnectorProbes queues one probe per live connection, once per window", async () => {
  f = await setup();
  await createApiKeyConnection(depsOf(f), f.owner.id, f.org.id, {
    connector: "github",
    apiKey: "ghp_secret_123456",
  });
  await createApiKeyConnection(depsOf(f), f.owner.id, f.org.id, {
    connector: "sentry",
    apiKey: "sntrys_secret_123456",
  });
  const now = new Date("2026-11-20T12:00:00Z");
  expect(await enqueueConnectorProbes(f.db, now)).toBe(2);
  const kinds = await outboxKinds(f.db);
  expect(kinds.filter((k) => k === CONNECTOR_PROBE_JOB)).toHaveLength(2);
  // Same window: the dedupe keys refuse a second enqueue.
  expect(await enqueueConnectorProbes(f.db, new Date(now.getTime() + 60_000))).toBe(2);
  expect((await outboxKinds(f.db)).filter((k) => k === CONNECTOR_PROBE_JOB)).toHaveLength(2);
  // Next window: probed again.
  expect(await enqueueConnectorProbes(f.db, new Date(now.getTime() + CONNECTOR_PROBE_WINDOW_MS))).toBe(2);
  expect((await outboxKinds(f.db)).filter((k) => k === CONNECTOR_PROBE_JOB)).toHaveLength(4);
});

test("a probe that answers keeps the connection active, and heals a wrong needs_reconnect", async () => {
  f = await setup();
  const mcp = fakeGithubMcp();
  const c = await createApiKeyConnection(depsOf(f), f.owner.id, f.org.id, {
    connector: "github",
    apiKey: "ghp_secret_123456",
  });
  const deps = { ...depsOf(f), connect: mcp.connect };
  expect(await probeConnection(deps, await mustRow(f, c.id))).toBe("ok");
  expect(mcp.sessions).toHaveLength(1);
  // Marked by hand (a call once saw a 401), the next good probe clears it.
  await markToReconnect(f.db, c, "sign-in refused");
  expect((await rowOf(f, c.id))?.status).toBe("needs_reconnect");
  expect(await probeConnection(deps, await mustRow(f, c.id))).toBe("ok");
  expect(await rowOf(f, c.id)).toMatchObject({ status: "active", lastError: null });
});

test("a probe refused with 401 marks the connection to reconnect", async () => {
  f = await setup();
  const mcp = fakeGithubMcp();
  const connect: typeof mcp.connect = async () => {
    throw new StreamableHTTPError(401, "Error POSTing to endpoint: Bad credentials");
  };
  const c = await createApiKeyConnection(depsOf(f), f.owner.id, f.org.id, {
    connector: "github",
    apiKey: "ghp_secret_123456",
  });
  const deps = { ...depsOf(f), connect };
  expect(await probeConnection(deps, await mustRow(f, c.id))).toBe("failed");
  expect(await rowOf(f, c.id)).toMatchObject({ status: "needs_reconnect" });
});

test("a probe that fails for another reason marks nothing", async () => {
  f = await setup();
  const connect = async () => {
    throw new Error("socket hangup");
  };
  const c = await createApiKeyConnection(depsOf(f), f.owner.id, f.org.id, {
    connector: "github",
    apiKey: "ghp_secret_123456",
  });
  const deps = { ...depsOf(f), connect };
  expect(await probeConnection(deps, await mustRow(f, c.id))).toBe("failed");
  expect((await rowOf(f, c.id))?.status).toBe("active");
});

test("probeConnectionById skips revoked, foreign and Composio rows", async () => {
  f = await setup();
  const mcp = fakeGithubMcp();
  const deps = { ...depsOf(f), connect: mcp.connect };
  const c = await createApiKeyConnection(depsOf(f), f.owner.id, f.org.id, {
    connector: "github",
    apiKey: "ghp_secret_123456",
  });
  // Another workspace's id: nothing happens.
  await probeConnectionById(deps, "00000000-0000-0000-0000-000000000000", c.id);
  expect(mcp.sessions).toHaveLength(0);
  // Revoked: nothing happens.
  await f.db
    .update(schema.connectorConnections)
    .set({ revokedAt: new Date() })
    .where(eq(schema.connectorConnections.id, c.id));
  await probeConnectionById(deps, f.org.id, c.id);
  expect(mcp.sessions).toHaveLength(0);
  // A live one probes.
  await f.db
    .update(schema.connectorConnections)
    .set({ revokedAt: null })
    .where(and(eq(schema.connectorConnections.id, c.id)));
  await probeConnectionById(deps, f.org.id, c.id);
  expect(mcp.sessions).toHaveLength(1);
});
