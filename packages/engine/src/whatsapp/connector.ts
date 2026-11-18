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
import { type CustomDeps, saveCustomTools, syncCustomTools, type ToolDecision } from "../connectors/custom";
import { sealSecret } from "../crypto";
import {
  ensureWhatsAppBridge,
  stopWhatsAppBridge,
  WHATSAPP_CONNECTION,
  type WhatsAppDeps,
  whatsappStatus,
} from "./supervisor";

/**
 * The WhatsApp connector is a first-party custom MCP connection: the org's
 * bridge registers once as `custom:whatsapp` (one active row per org by the
 * unique index), its loopback MCP URL is server-issued, and its tools go
 * through the same classification/approval path as any custom server.
 */

export interface WhatsAppConnectorDeps extends CustomDeps {
  whatsapp: WhatsAppDeps;
}

const aadFor = (orgId: string, id: string) => `connector-connection|${orgId}|${id}`;

async function whatsappConnection(db: Database, orgId: string): Promise<ConnectorConnection | null> {
  const [row] = await db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.orgId, orgId),
        eq(connectorConnections.connector, WHATSAPP_CONNECTION),
        isNull(connectorConnections.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Connects (or resumes) the org's WhatsApp pairing: ensures the bridge runs,
 * upserts its connector row with the spawn token sealed as the MCP bearer,
 * and syncs the tool list for admin classification. Admin-only — callers
 * check `manage_connectors`.
 */
export async function connectWhatsApp(
  deps: WhatsAppConnectorDeps,
  actorId: string,
  orgId: string,
): Promise<{ status: string; phone: string | null }> {
  const bridge = await ensureWhatsAppBridge(deps.whatsapp, orgId);
  if (!bridge) throw new Error("whatsapp session is off");

  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const serverUrl = `http://127.0.0.1:${bridge.port}/mcp`;
  const existing = await whatsappConnection(deps.db, orgId);

  let connection: ConnectorConnection;
  if (existing) {
    const sealed = await sealSecret(wrapper, JSON.stringify({ apiKey: bridge.token }), aadFor(orgId, existing.id));
    const [row] = await deps.db
      .update(connectorConnections)
      .set({
        serverUrl,
        authType: "internal",
        secretCiphertext: sealed.ciphertext,
        wrappedDataKey: sealed.wrappedDataKey,
        kekId: sealed.kekId,
        tokenExpiresAt: null,
        status: "active",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(connectorConnections.id, existing.id))
      .returning();
    if (!row) throw new Error("connection update returned nothing");
    connection = row;
  } else {
    const id = randomUUID();
    const sealed = await sealSecret(wrapper, JSON.stringify({ apiKey: bridge.token }), aadFor(orgId, id));
    connection = await deps.db.transaction(async (tx) => {
      const toolPrefix = await freeToolPrefix(tx, orgId, "whatsapp", deps.oauthApps);
      const [row] = await tx
        .insert(connectorConnections)
        .values({
          id,
          orgId,
          connector: WHATSAPP_CONNECTION,
          label: "WhatsApp",
          toolPrefix,
          serverUrl,
          authType: "internal",
          secretCiphertext: sealed.ciphertext,
          wrappedDataKey: sealed.wrappedDataKey,
          kekId: sealed.kekId,
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
        details: { serverUrl: "whatsapp://bridge", authType: "internal", label: "WhatsApp", everyAgent: true },
      });
      return row;
    });
  }
  caches.connections.delete(`${orgId}:active`);
  caches.scopes.deletePrefix(`${orgId}:`);

  // Tools classify like any custom server (suggestions + admin review). The
  // bridge serves /mcp before pairing completes, so this works during QR too;
  // a failure leaves the connection usable once tools sync on a later connect.
  try {
    await syncCustomTools(deps, connection);
  } catch {
    deps.log?.warn("whatsapp tools sync deferred", { orgId, connectionId: connection.id });
  }

  // Sensible defaults so the connector works without a review round: reads
  // open, mark_read writes, and every send/create asks a person. An admin can
  // still change any of them in the connector's tool list.
  const access: Record<string, ToolDecision> = {
    whatsapp_list_chats: "read",
    whatsapp_read_messages: "read",
    whatsapp_search_messages: "read",
    whatsapp_get_chat: "read",
    whatsapp_mark_read: "write",
    whatsapp_send_message: "approval",
    whatsapp_send_media: "approval",
    whatsapp_create_group: "approval",
  };
  try {
    await saveCustomTools(deps, actorId, orgId, connection.id, {
      label: "WhatsApp",
      tools: Object.entries(access).map(([name, level]) => ({ name, access: level, label: name })),
    });
  } catch (error) {
    deps.log?.warn("whatsapp tool defaults not saved", { orgId, error: String(error) });
  }

  const status = await whatsappStatus(deps.db, orgId);
  return { status: status?.status ?? "pairing", phone: status?.phone ?? null };
}

/** Disconnects WhatsApp: stops the bridge, revokes the connector, clears grants. */
export async function disconnectWhatsApp(deps: WhatsAppConnectorDeps, actorId: string, orgId: string): Promise<void> {
  const connection = await whatsappConnection(deps.db, orgId);
  if (connection) {
    await revokeConnection(deps.db, actorId, orgId, connection.id, deps.composio ?? null);
  }
  await stopWhatsAppBridge(deps.whatsapp, orgId);
  // Also remove any leftover custom tool classifications for the dead row.
  await deps.db.execute(sql`delete from custom_tools where connection_id in (
    select id from connector_connections where org_id = ${orgId}::uuid and connector = ${WHATSAPP_CONNECTION}
  )`);
}

export type { WhatsAppDeps } from "./supervisor";
export { WHATSAPP_CONNECTION };
