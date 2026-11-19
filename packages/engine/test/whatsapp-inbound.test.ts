import { describe, expect, test } from "bun:test";
import { and, eq, schema } from "@keepmind/db";
import {
  type BridgeEventMessage,
  handleInboundWhatsAppMessage,
  insertMessage,
  listWhatsAppChats,
  maybeDeliverWhatsAppReply,
  sealSecret,
  setWhatsAppChatApproval,
  type WhatsAppDeps,
  type WhatsAppInboundDeps,
  whatsappReplyTarget,
} from "../src";
import { setup } from "./fixtures";

const TOKEN_AAD = (orgId: string) => `whatsapp-session|${orgId}`;

async function connectedSession(
  f: Awaited<ReturnType<typeof setup>>,
  answerAgentId: string | null,
): Promise<WhatsAppDeps> {
  const sealed = await sealSecret(f.keyWrapper, "bridge-token", TOKEN_AAD(f.org.id));
  await f.db.insert(schema.whatsappSessions).values({
    orgId: f.org.id,
    status: "connected",
    phone: "5511999999999",
    answerAgentId,
    bridgePort: 45678,
    bridgeTokenCiphertext: sealed.ciphertext,
    wrappedDataKey: sealed.wrappedDataKey,
    kekId: sealed.kekId,
  });
  return {
    db: f.db,
    keyWrappers: [f.keyWrapper],
    dataDir: "/tmp",
    apiBaseUrl: "http://127.0.0.1:3088",
    pubsub: f.pubsub,
  } as WhatsAppDeps;
}

function inbound(text: string, chatId = "5511888888888@s.whatsapp.net"): BridgeEventMessage {
  return {
    type: "message",
    chat: { id: chatId, name: "Cliente" },
    sender: { id: "5511777777777@s.whatsapp.net", name: "Maria" },
    text,
    timestamp: Date.now(),
    hasMedia: false,
  };
}

async function mirroredMessages(f: Awaited<ReturnType<typeof setup>>) {
  return f.db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.orgId, f.org.id), eq(schema.messages.channelId, await whatsappChannelId(f))));
}

async function whatsappChannelId(f: Awaited<ReturnType<typeof setup>>): Promise<string> {
  const [row] = await f.db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(eq(schema.channels.orgId, f.org.id), eq(schema.channels.name, "whatsapp")));
  if (!row) throw new Error("no whatsapp channel");
  return row.id;
}

describe("whatsapp inbound mirror", () => {
  test("an inbound message becomes a thread message authored by the relay; the answer agent wakes only once the chat is approved", async () => {
    const f = await setup();
    const whatsapp = await connectedSession(f, f.agent.id);
    const deps: WhatsAppInboundDeps = { db: f.db, whatsapp };

    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("oi, vocês têm o relatório?"));

    const msgs = await mirroredMessages(f);
    expect(msgs).toHaveLength(1);
    const m = msgs[0]!;
    expect(m.authorType).toBe("agent");
    expect(m.body).toBe("oi, vocês têm o relatório?");
    const meta = m.meta as { external?: { sender?: { name?: string }; provider?: string } };
    expect(meta.external?.provider).toBe("whatsapp");
    expect(meta.external?.sender?.name).toBe("Maria");

    // Not a person: no user id, and the author is the hidden relay agent.
    expect(m.authorUserId).toBeNull();
    const [relay] = await f.db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.orgId, f.org.id), eq(schema.agents.handle, "whatsapp-relay")));
    expect(relay).toBeTruthy();
    expect(relay!.archivedAt).not.toBeNull();
    expect(m.authorAgentId).toBe(relay!.id);

    // Mirrored but silent: a brand-new chat never wakes the answer agent.
    const runsBefore = await f.db
      .select()
      .from(schema.agentRuns)
      .where(and(eq(schema.agentRuns.orgId, f.org.id), eq(schema.agentRuns.triggerMessageId, m.id)));
    expect(runsBefore).toHaveLength(0);

    // Chat → thread mapping persisted, pending approval.
    const [chat] = await f.db
      .select()
      .from(schema.whatsappChats)
      .where(
        and(eq(schema.whatsappChats.orgId, f.org.id), eq(schema.whatsappChats.chatId, "5511888888888@s.whatsapp.net")),
      );
    expect(chat?.threadRootId).toBe(m.id);
    expect(chat?.participantName).toBe("Maria");
    expect(chat?.approvedAt).toBeNull();

    // A manage_connectors admin approves the chat; the next message wakes the agent.
    const approved = await setWhatsAppChatApproval(f.db, f.org.id, "5511888888888@s.whatsapp.net", true);
    expect(approved?.approvedAt).not.toBeNull();
    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("e o relatório?"));

    const runs = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.orgId, f.org.id));
    expect(runs.map((r) => r.agentId)).toContain(f.agent.id);

    await f.close();
  });

  test("revoking a chat's approval silences the answer agent again", async () => {
    const f = await setup();
    const whatsapp = await connectedSession(f, f.agent.id);
    const deps: WhatsAppInboundDeps = { db: f.db, whatsapp };

    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("primeira"));
    await setWhatsAppChatApproval(f.db, f.org.id, "5511888888888@s.whatsapp.net", true);
    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("segunda"));
    const before = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.orgId, f.org.id));
    expect(before.length).toBeGreaterThanOrEqual(1);

    await setWhatsAppChatApproval(f.db, f.org.id, "5511888888888@s.whatsapp.net", false);
    const count = before.length;
    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("terceira"));
    const after = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.orgId, f.org.id));
    expect(after.length).toBe(count);
    // Still mirrored.
    expect(await mirroredMessages(f)).toHaveLength(3);

    await f.close();
  });

  test("listWhatsAppChats returns the mirrored chats with their approval state", async () => {
    const f = await setup();
    const whatsapp = await connectedSession(f, f.agent.id);
    const deps: WhatsAppInboundDeps = { db: f.db, whatsapp };

    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("oi", "111@s.whatsapp.net"));
    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("olá", "222@s.whatsapp.net"));
    await setWhatsAppChatApproval(f.db, f.org.id, "111@s.whatsapp.net", true);

    const chats = await listWhatsAppChats(f.db, f.org.id);
    expect(chats).toHaveLength(2);
    expect(chats.find((c) => c.chatId === "111@s.whatsapp.net")?.approvedAt).not.toBeNull();
    expect(chats.find((c) => c.chatId === "222@s.whatsapp.net")?.approvedAt).toBeNull();

    await f.close();
  });

  test("a second message in the same chat lands in the same thread", async () => {
    const f = await setup();
    const whatsapp = await connectedSession(f, f.agent.id);
    const deps: WhatsAppInboundDeps = { db: f.db, whatsapp };

    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("primeira"));
    await setWhatsAppChatApproval(f.db, f.org.id, "5511888888888@s.whatsapp.net", true);
    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("segunda"));

    const msgs = await mirroredMessages(f);
    expect(msgs).toHaveLength(2);
    const root = msgs.find((m) => m.threadId === null);
    const reply = msgs.find((m) => m.threadId !== null);
    expect(root).toBeTruthy();
    expect(reply?.threadId).toBe(root!.id);
    // The approved chat woke the answer agent.
    const runs = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.orgId, f.org.id));
    expect(runs.map((r) => r.agentId)).toContain(f.agent.id);

    await f.close();
  });

  test("an agent reply in a mirrored thread is delivered to the bridge /send; person and relay messages are not", async () => {
    const f = await setup();
    const whatsapp = await connectedSession(f, f.agent.id);
    const sent: { url: string; body: unknown; auth: string | null }[] = [];
    const deps: WhatsAppInboundDeps = {
      db: f.db,
      whatsapp,
      fetch: (async (url: unknown, init?: RequestInit) => {
        sent.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
          auth: new Headers(init?.headers).get("authorization"),
        });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    };

    await handleInboundWhatsAppMessage(deps, f.org.id, inbound("preciso de ajuda"));
    const [root] = await mirroredMessages(f);
    const rootId = root!.id;

    // The answer agent's reply in the thread.
    const agentReply = await f.db.transaction((tx) =>
      insertMessage(tx, {
        orgId: f.org.id,
        channelId: root!.channelId,
        threadId: rootId,
        author: { type: "agent", agentId: f.agent.id, runId: null, hop: 0, stretchId: null },
        body: "Claro! Segue o relatório.",
      }),
    );

    // A workspace person's message in the same thread must NOT go out.
    const personMsg = await f.db.transaction((tx) =>
      insertMessage(tx, {
        orgId: f.org.id,
        channelId: root!.channelId,
        threadId: rootId,
        author: { type: "person", userId: f.owner.id },
        body: "nota interna",
      }),
    );

    // The relay's own mirrored message must NOT echo back.
    const relayMsgs = await mirroredMessages(f);
    const relay = relayMsgs.find(
      (m) => m.authorAgentId !== f.agent.id && m.id !== agentReply.id && m.id !== personMsg.id,
    );
    expect(relay).toBeTruthy();

    await maybeDeliverWhatsAppReply(deps, agentReply);
    await maybeDeliverWhatsAppReply(deps, personMsg);
    await maybeDeliverWhatsAppReply(deps, relay!);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("http://127.0.0.1:45678/send");
    expect(sent[0]!.auth).toBe("Bearer bridge-token");
    expect(sent[0]!.body).toEqual({
      chat_id: "5511888888888@s.whatsapp.net",
      text: "Claro! Segue o relatório.",
    });

    // whatsappReplyTarget guards: agent reply maps, others don't.
    expect(await whatsappReplyTarget(f.db, agentReply)).toEqual({
      orgId: f.org.id,
      chatId: "5511888888888@s.whatsapp.net",
      text: "Claro! Segue o relatório.",
    });
    expect(await whatsappReplyTarget(f.db, personMsg)).toBeNull();
    expect(await whatsappReplyTarget(f.db, relay!)).toBeNull();

    await f.close();
  });
});
