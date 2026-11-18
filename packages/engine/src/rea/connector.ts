import { randomUUID } from "node:crypto";
import { and, type Database, eq, isNull, schema, sql } from "@keepmind/db";

const { connectorConnections } = schema;

import { recordAudit } from "../audit";
import { caches } from "../cache";
import {
  type ConnectorConnection,
  freeToolPrefix,
  grantToEveryAgent,
  revokeConnection,
} from "../connectors/connections";
import { type CustomDeps, syncCustomTools } from "../connectors/custom";
import { ensureRea, REA_CONNECTION, type ReaDeps, reaStatus, stopRea } from "./supervisor";

/**
 * The REA connector is a first-party custom MCP connection: the org's
 * `rea-agents` process registers once as `custom:rea` (one active row per org
 * by the unique index), its loopback MCP URL is server-issued, and its tools
 * go through the same classification/approval path as any custom server.
 * The endpoint has no auth — `internal` marks the server-issued loopback URL
 * so the SSRF guard stays on for every address a person can type.
 */

export interface ReaConnectorDeps extends CustomDeps {
  rea: ReaDeps;
}

async function reaConnection(db: Database, orgId: string): Promise<ConnectorConnection | null> {
  const [row] = await db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.orgId, orgId),
        eq(connectorConnections.connector, REA_CONNECTION),
        isNull(connectorConnections.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Connects (or resumes) the org's REA sidecar: ensures the MCP server runs,
 * upserts its connector row with the loopback URL, and syncs the tool list
 * for admin classification. Admin-only — callers check `manage_connectors`.
 */
export async function connectRea(
  deps: ReaConnectorDeps,
  actorId: string,
  orgId: string,
): Promise<{ status: string; lastError: string | null }> {
  const rea = await ensureRea(deps.rea, orgId);
  if (!rea) throw new Error("rea sidecar failed to start");

  const serverUrl = `http://127.0.0.1:${rea.port}/mcp`;
  const existing = await reaConnection(deps.db, orgId);

  let connection: ConnectorConnection;
  if (existing) {
    const [row] = await deps.db
      .update(connectorConnections)
      .set({
        serverUrl,
        authType: "internal",
        status: "active",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(connectorConnections.id, existing.id))
      .returning();
    if (!row) throw new Error("connection update returned nothing");
    connection = row;
  } else {
    connection = await deps.db.transaction(async (tx) => {
      const toolPrefix = await freeToolPrefix(tx, orgId, "rea", deps.oauthApps);
      const [row] = await tx
        .insert(connectorConnections)
        .values({
          id: randomUUID(),
          orgId,
          connector: REA_CONNECTION,
          label: "REA",
          toolPrefix,
          serverUrl,
          authType: "internal",
          createdByUserId: actorId,
        })
        .returning();
      if (!row) throw new Error("connection insert returned nothing");
      await grantToEveryAgent(tx, orgId, actorId, row);
      await recordAudit(tx, {
        orgId,
        actor: { type: "person", id: actorId },
        action: "connector.custom_connected",
        target: { type: "connector_connection", id: row.id },
        details: { serverUrl: "rea://sidecar", authType: "internal", label: "REA", everyAgent: true },
      });
      return row;
    });
  }
  caches.connections.delete(`${orgId}:active`);
  caches.scopes.deletePrefix(`${orgId}:`);

  // Tools classify like any custom server (suggestions + admin review).
  try {
    await syncCustomTools(deps, connection);
  } catch {
    deps.log?.warn("rea tools sync deferred", { orgId, connectionId: connection.id });
  }

  // Tool levels come from syncCustomTools' own classification (server
  // annotations, name verbs, the judge): REA's catalog is analysis-only, so
  // reads classify as reads and anything it marks destructive still asks a
  // person. An admin can tighten any tool afterwards.

  const status = await reaStatus(deps.rea, orgId);
  return { status: status.status, lastError: status.lastError };
}

/** Disconnects REA: stops the sidecar and revokes the connector + grants. */
export async function disconnectRea(deps: ReaConnectorDeps, actorId: string, orgId: string): Promise<void> {
  const connection = await reaConnection(deps.db, orgId);
  if (connection) {
    await revokeConnection(deps.db, actorId, orgId, connection.id, deps.composio ?? null);
  }
  await stopRea(deps.rea, orgId);
  await deps.db.execute(sql`delete from custom_tools where connection_id in (
    select id from connector_connections where org_id = ${orgId}::uuid and connector = ${REA_CONNECTION}
  )`);
}

export type { ReaDeps, ReaStatus, ReaStatusView } from "./supervisor";
export { REA_CONNECTION };
