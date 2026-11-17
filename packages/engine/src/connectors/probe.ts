import { and, type Executor, eq, isNull, ne, schema } from "@keepmind/db";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { caches } from "../cache";
import { enqueue } from "../outbox";
import {
  type ConnectorConnection,
  type ConnectorDeps,
  connectionHeaders,
  GITHUB_APP_AUTH,
  markToReconnect,
} from "./connections";
import { connectOverHttp, type McpConnect } from "./mcp";

const { connectorConnections } = schema;

export const CONNECTOR_PROBE_JOB = "connector.probe";
/** How often each live connection is probed: one outbox job per connection per window (its dedupe key). */
export const CONNECTOR_PROBE_WINDOW_MS = 15 * 60_000;

/**
 * Queues a probe for every connection whose sign-in this server manages: catalog OAuth, API keys, a custom server's
 * own sign-in. The GitHub App's rows have no sign-in of their own to check, and a Composio account is reconciled by
 * `reconcileComposioConnectors` (metered calls: no probe spends one).
 */
export async function enqueueConnectorProbes(db: Executor, now = new Date()) {
  const window = Math.floor(now.getTime() / CONNECTOR_PROBE_WINDOW_MS);
  const rows = await db
    .select({ id: connectorConnections.id, orgId: connectorConnections.orgId })
    .from(connectorConnections)
    .where(
      and(
        isNull(connectorConnections.revokedAt),
        ne(connectorConnections.authType, GITHUB_APP_AUTH),
        isNull(connectorConnections.composioAccountId),
      ),
    );
  for (const row of rows) {
    await enqueue(db, {
      orgId: row.orgId,
      kind: CONNECTOR_PROBE_JOB,
      payload: { connectionId: row.id },
      dedupeKey: `${CONNECTOR_PROBE_JOB}:${row.id}:${window}`,
      // A probe is a courtesy check, never worth retrying a day: one attempt does it.
      maxAttempts: 1,
    });
  }
  return rows.length;
}

/**
 * One probe: opens an MCP session (the `initialize` handshake is an authenticated call, so a dead sign-in fails
 * here) and closes it. A refused sign-in marks the connection `needs_reconnect`, as a call would; a connection that
 * answers while marked goes back to `active` — a wrong mark heals itself, like Composio's reconcile.
 */
export async function probeConnection(
  deps: ConnectorDeps & { connect?: McpConnect },
  connection: ConnectorConnection,
): Promise<"ok" | "failed"> {
  const connect = deps.connect ?? connectOverHttp;
  try {
    const session = await connect(connection, await connectionHeaders(deps, connection));
    await session.close().catch(() => {});
  } catch (error) {
    // The same rule a tool call applies: a 401 from the server, or a refresh the provider refused.
    if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) {
      await markToReconnect(deps.db, connection, error.message);
    }
    return "failed";
  }
  if (connection.status === "needs_reconnect") {
    await deps.db
      .update(connectorConnections)
      .set({ status: "active", lastError: null, updatedAt: new Date() })
      .where(
        and(
          eq(connectorConnections.id, connection.id),
          eq(connectorConnections.status, "needs_reconnect"),
          isNull(connectorConnections.revokedAt),
        ),
      );
    caches.connections.delete(`${connection.orgId}:active`);
  }
  return "ok";
}

/** The outbox handler's entry: loads the row fresh (it may be revoked or gone since the enqueue). */
export async function probeConnectionById(
  deps: ConnectorDeps & { connect?: McpConnect },
  orgId: string,
  connectionId: string,
): Promise<void> {
  const [connection] = await deps.db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.id, connectionId),
        eq(connectorConnections.orgId, orgId),
        isNull(connectorConnections.revokedAt),
        ne(connectorConnections.authType, GITHUB_APP_AUTH),
        // A live Composio row too: its reconcile owns that status.
        isNull(connectorConnections.composioAccountId),
      ),
    )
    .limit(1);
  if (!connection) return;
  await probeConnection(deps, connection);
}
