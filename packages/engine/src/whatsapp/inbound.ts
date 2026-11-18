import { and, type Database, type Executor, eq, isNull, schema } from "@keepmind/db";
import { createAgentRuns } from "../dispatch";
import { insertMessageWithRuns, type Message } from "../messages";
import { type BridgeEventMessage, openWhatsAppToken, type WhatsAppDeps } from "./supervisor";

/**
 * Mirrors WhatsApp chats into the workspace: one `whatsapp` channel, one
 * thread per chat (`whatsapp_chats.thread_root_id`), external senders authored
 * by a relay agent with `meta.external` — never a person, so they gain no
 * member authority and their run is `unattended`. Agent replies in those
 * threads go back out through the bridge's `/send`; person-authored ones do
 * not.
 */

export const WHATSAPP_CHANNEL = "whatsapp";
const RELAY_HANDLE = "whatsapp-relay";

export interface WhatsAppInboundDeps {
  db: Database;
  whatsapp: WhatsAppDeps;
  fetch?: typeof fetch;
}

async function ensureChannel(db: Database, orgId: string): Promise<string> {
  const [existing] = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.orgId, orgId),
        eq(schema.channels.name, WHATSAPP_CHANNEL),
        isNull(schema.channels.archivedAt),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.channels)
    .values({
      orgId,
      name: WHATSAPP_CHANNEL,
      topic: "WhatsApp chats mirrored from the connected number",
      kind: "channel",
      visibility: "private",
    })
    .onConflictDoNothing()
    .returning({ id: schema.channels.id });
  if (created) return created.id;
  const [again] = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(eq(schema.channels.orgId, orgId), eq(schema.channels.name, WHATSAPP_CHANNEL)))
    .limit(1);
  if (!again) throw new Error("whatsapp channel could not be created");
  return again.id;
}

/** The relay agent authors inbound messages; it never runs and stays archived. */
async function ensureRelay(db: Database, orgId: string): Promise<string> {
  const [existing] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.handle, RELAY_HANDLE)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.agents)
    .values({
      orgId,
      name: "WhatsApp",
      handle: RELAY_HANDLE,
      role: "External chats",
      instructions: "Relays WhatsApp messages into the workspace. It never answers on its own.",
      model: "whatsapp-relay",
      archivedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.agents.id });
  if (created) return created.id;
  const [again] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.handle, RELAY_HANDLE)))
    .limit(1);
  if (!again) throw new Error("whatsapp relay could not be created");
  return again.id;
}

async function ensureMember(db: Executor, orgId: string, channelId: string, agentId: string) {
  await db.insert(schema.channelMembers).values({ orgId, channelId, agentId, autoReply: false }).onConflictDoNothing();
}

/** The agent that answers a chat: the session's pick, else the workspace right hand. */
async function answerAgent(db: Database, orgId: string): Promise<string | null> {
  const [session] = await db
    .select({ answerAgentId: schema.whatsappSessions.answerAgentId })
    .from(schema.whatsappSessions)
    .where(eq(schema.whatsappSessions.orgId, orgId))
    .limit(1);
  if (session?.answerAgentId) return session.answerAgentId;
  const [rightHand] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(
      and(eq(schema.agents.orgId, orgId), eq(schema.agents.builtin, "right_hand"), isNull(schema.agents.archivedAt)),
    )
    .limit(1);
  return rightHand?.id ?? null;
}

/** One inbound bridge message → mirrored workspace message + the answer agent's run. */
export async function handleInboundWhatsAppMessage(
  deps: WhatsAppInboundDeps,
  orgId: string,
  msg: BridgeEventMessage,
): Promise<void> {
  const [channelId, relayId, answerId] = await Promise.all([
    ensureChannel(deps.db, orgId),
    ensureRelay(deps.db, orgId),
    answerAgent(deps.db, orgId),
  ]);
  await ensureMember(deps.db, orgId, channelId, relayId);
  if (answerId) await ensureMember(deps.db, orgId, channelId, answerId);

  const [mapping] = await deps.db
    .select()
    .from(schema.whatsappChats)
    .where(and(eq(schema.whatsappChats.orgId, orgId), eq(schema.whatsappChats.chatId, msg.chat.id)))
    .limit(1);

  const body = msg.text.trim() || "[media]";
  const message = await deps.db.transaction(async (tx) => {
    const { message } = await insertMessageWithRuns(
      tx,
      {
        orgId,
        channelId,
        threadId: mapping?.threadRootId ?? null,
        author: { type: "agent", agentId: relayId, runId: null, hop: 0, stretchId: null },
        body,
        meta: {
          external: {
            provider: "whatsapp",
            sender: { id: msg.sender.id, name: msg.sender.name },
            chat: { id: msg.chat.id, name: msg.chat.name },
            hasMedia: msg.hasMedia,
          },
        },
      },
      { startRuns: false },
    );
    if (!mapping) {
      await tx
        .insert(schema.whatsappChats)
        .values({
          orgId,
          chatId: msg.chat.id,
          threadRootId: message.id,
          participantName: msg.sender.name,
        })
        .onConflictDoNothing();
    } else {
      await tx
        .update(schema.whatsappChats)
        .set({ participantName: msg.sender.name, updatedAt: new Date() })
        .where(and(eq(schema.whatsappChats.orgId, orgId), eq(schema.whatsappChats.chatId, msg.chat.id)));
    }
    if (answerId) {
      await createAgentRuns(tx, message, [answerId], "mention");
    }
    return message;
  });
  void message;
}

/** The WhatsApp chat an agent reply in a mirrored thread belongs to, if any. */
export async function whatsappReplyTarget(
  db: Database,
  message: Message,
): Promise<{ orgId: string; chatId: string; text: string } | null> {
  // Only agent replies leave: the relay's own mirrored messages carry
  // meta.external, a person's stay inside, and system lines (notices, cards)
  // are not chat replies.
  if (message.authorType !== "agent" || !message.threadId) return null;
  const meta = message.meta as Record<string, unknown> | null;
  if (meta?.external || meta?.notice || meta?.noAi || meta?.actionCard || meta?.talker || meta?.background) {
    return null;
  }
  const text = message.body.trim();
  if (!text) return null;
  const [mapping] = await db
    .select({ chatId: schema.whatsappChats.chatId })
    .from(schema.whatsappChats)
    .where(and(eq(schema.whatsappChats.orgId, message.orgId), eq(schema.whatsappChats.threadRootId, message.threadId)))
    .limit(1);
  return mapping ? { orgId: message.orgId, chatId: mapping.chatId, text } : null;
}

/** Delivers an agent reply to WhatsApp through the org's bridge `/send`. */
export async function deliverWhatsAppReply(
  deps: WhatsAppInboundDeps,
  target: { orgId: string; chatId: string; text: string },
): Promise<void> {
  const [session] = await deps.db
    .select({ bridgePort: schema.whatsappSessions.bridgePort, status: schema.whatsappSessions.status })
    .from(schema.whatsappSessions)
    .where(eq(schema.whatsappSessions.orgId, target.orgId))
    .limit(1);
  if (!session?.bridgePort || session.status === "off") return;
  const token = await openWhatsAppToken(deps.whatsapp, target.orgId);
  if (!token) return;
  const fetchImpl = deps.fetch ?? fetch;
  const res = await fetchImpl(`http://127.0.0.1:${session.bridgePort}/send`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ chat_id: target.chatId, text: target.text }),
  });
  if (!res.ok) throw new Error(`whatsapp bridge /send failed: ${res.status}`);
}

/** message.posted hook: mirrored-thread agent replies go back to WhatsApp. */
export async function maybeDeliverWhatsAppReply(deps: WhatsAppInboundDeps, message: Message): Promise<void> {
  const target = await whatsappReplyTarget(deps.db, message);
  if (target) await deliverWhatsAppReply(deps, target);
}
