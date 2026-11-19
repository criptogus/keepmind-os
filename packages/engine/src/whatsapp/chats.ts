import { and, type Database, desc, eq, schema } from "@keepmind/db";

/**
 * The mirrored WhatsApp chats an admin reviews (`whatsapp_chats`): every
 * inbound chat lands here, but only an approved one (`approvedAt` set by a
 * `manage_connectors` admin) lets the answer agent reply. Mirroring stays
 * visible either way — approval gates the agent, not the record.
 */

export interface WhatsAppChatView {
  chatId: string;
  participantName: string | null;
  threadRootId: string;
  approvedAt: string | null;
  createdAt: string;
}

export async function listWhatsAppChats(db: Database, orgId: string): Promise<WhatsAppChatView[]> {
  const rows = await db
    .select({
      chatId: schema.whatsappChats.chatId,
      participantName: schema.whatsappChats.participantName,
      threadRootId: schema.whatsappChats.threadRootId,
      approvedAt: schema.whatsappChats.approvedAt,
      createdAt: schema.whatsappChats.createdAt,
    })
    .from(schema.whatsappChats)
    .where(eq(schema.whatsappChats.orgId, orgId))
    .orderBy(desc(schema.whatsappChats.createdAt));
  return rows.map((r) => ({
    ...r,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Approves (`approved: true`) or revokes a chat's right to trigger the answer agent. */
export async function setWhatsAppChatApproval(
  db: Database,
  orgId: string,
  chatId: string,
  approved: boolean,
): Promise<WhatsAppChatView | null> {
  const [row] = await db
    .update(schema.whatsappChats)
    .set({ approvedAt: approved ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(schema.whatsappChats.orgId, orgId), eq(schema.whatsappChats.chatId, chatId)))
    .returning({
      chatId: schema.whatsappChats.chatId,
      participantName: schema.whatsappChats.participantName,
      threadRootId: schema.whatsappChats.threadRootId,
      approvedAt: schema.whatsappChats.approvedAt,
      createdAt: schema.whatsappChats.createdAt,
    });
  if (!row) return null;
  return { ...row, approvedAt: row.approvedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
}
