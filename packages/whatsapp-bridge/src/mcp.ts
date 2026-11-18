import { timingSafeEqual } from "node:crypto";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SocketLike } from "./events.ts";
import type { ChatStore } from "./store.ts";

export interface BridgeApiDeps {
  token: string;
  store: ChatStore;
  socket: SocketLike;
}

function authorized(req: Request, token: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  const a = new TextEncoder().encode(header);
  const b = new TextEncoder().encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const unauthorized = () => new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

function toolJson(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

async function sendText(deps: BridgeApiDeps, chatId: string, text: string) {
  const res = (await deps.socket.sendMessage(chatId, { text })) as { key?: { id?: string } } | undefined;
  deps.store.recordOutbound(chatId, "", text, res?.key?.id);
  return res?.key?.id ?? "";
}

function registerTools(server: McpServer, deps: BridgeApiDeps) {
  const safe = async (fn: () => unknown | Promise<unknown>) => {
    try {
      return toolJson(await fn());
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "whatsapp call failed");
    }
  };

  server.registerTool(
    "whatsapp_list_chats",
    {
      title: "List WhatsApp chats",
      description: "List WhatsApp chats the bridge has seen, most recent first.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    (args) => safe(() => deps.store.listChats().slice(0, args.limit)),
  );

  server.registerTool(
    "whatsapp_read_messages",
    {
      title: "Read WhatsApp messages",
      description: "Read recent messages of one WhatsApp chat by chat_id.",
      inputSchema: z.object({
        chat_id: z.string().min(1),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    (args) =>
      safe(() =>
        deps.store.readMessages(args.chat_id, args.limit).map((m) => ({
          sender: m.senderName,
          direction: m.direction,
          text: m.text,
          at: m.timestamp,
          has_media: m.hasMedia,
        })),
      ),
  );

  server.registerTool(
    "whatsapp_search_messages",
    {
      title: "Search WhatsApp messages",
      description: "Search recent WhatsApp messages across chats for a text query.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    (args) =>
      safe(() =>
        deps.store.searchMessages(args.query, args.limit).map((m) => ({
          chat_id: m.chatId,
          sender: m.senderName,
          text: m.text,
          at: m.timestamp,
        })),
      ),
  );

  server.registerTool(
    "whatsapp_get_chat",
    {
      title: "Get WhatsApp chat",
      description: "Get info about one WhatsApp chat by chat_id.",
      inputSchema: z.object({ chat_id: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    (args) => safe(() => deps.store.getChat(args.chat_id) ?? { error: "chat not found" }),
  );

  server.registerTool(
    "whatsapp_send_message",
    {
      title: "Send WhatsApp message",
      description: "Send a WhatsApp text message to a chat. External, hard to undo — requires approval.",
      inputSchema: z.object({ chat_id: z.string().min(1), text: z.string().min(1).max(4000) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    (args) => safe(async () => ({ message_id: await sendText(deps, args.chat_id, args.text) })),
  );

  server.registerTool(
    "whatsapp_send_media",
    {
      title: "Send WhatsApp media",
      description: "Send an image, video or document to a WhatsApp chat from a public URL.",
      inputSchema: z.object({
        chat_id: z.string().min(1),
        media_url: z.string().url(),
        caption: z.string().max(1000).optional(),
        media_type: z.enum(["image", "video", "document"]).default("image"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    (args) =>
      safe(async () => {
        // https only: Baileys fetches the URL from this host, so a plaintext or
        // internal address would turn the tool into an SSRF/exfiltration path.
        const mediaUrl = new URL(args.media_url);
        if (mediaUrl.protocol !== "https:") throw new Error("media_url must be https");
        const content =
          args.media_type === "document"
            ? { document: { url: args.media_url }, caption: args.caption }
            : args.media_type === "video"
              ? { video: { url: args.media_url }, caption: args.caption }
              : { image: { url: args.media_url }, caption: args.caption };
        const res = (await deps.socket.sendMessage(args.chat_id, content)) as { key?: { id?: string } } | undefined;
        deps.store.recordOutbound(args.chat_id, "", args.caption ?? "[media]", res?.key?.id);
        return { message_id: res?.key?.id ?? "" };
      }),
  );

  server.registerTool(
    "whatsapp_mark_read",
    {
      title: "Mark WhatsApp chat read",
      description: "Mark a WhatsApp chat as read and clear its unread count.",
      inputSchema: z.object({ chat_id: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) =>
      safe(async () => {
        const messages = deps.store.markRead(args.chat_id);
        const sock = deps.socket as SocketLike & {
          chatModify?: (mod: { markRead: boolean; lastMessages: unknown[] }) => Promise<unknown>;
        };
        const keys = messages
          .filter((m) => m.key)
          .slice(-10)
          .map((m) => m.key);
        if (sock.chatModify && keys.length > 0) {
          await sock.chatModify({ markRead: true, lastMessages: keys });
        }
        return { ok: true };
      }),
  );

  server.registerTool(
    "whatsapp_create_group",
    {
      title: "Create WhatsApp group",
      description: "Create a WhatsApp group with the given participants (phone numbers, jid or lid).",
      inputSchema: z.object({
        subject: z.string().min(1).max(100),
        participants: z.array(z.string().min(1)).min(1).max(100),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    (args) =>
      safe(async () => {
        const sock = deps.socket as SocketLike & {
          groupCreate?: (subject: string, participants: string[]) => Promise<{ id?: string }>;
        };
        if (!sock.groupCreate) return toolError("group creation unsupported by this socket");
        const group = await sock.groupCreate(args.subject, args.participants);
        return { group_id: group?.id ?? "" };
      }),
  );
}

/**
 * HTTP handler for the bridge's API surface: POST /send (engine reply
 * delivery) and POST /mcp (agent tools). Both require the bearer token.
 */
export function createBridgeApiHandler(deps: BridgeApiDeps) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!authorized(req, deps.token)) return unauthorized();

    if (url.pathname === "/send") {
      let body: { chat_id?: string; text?: string };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }
      if (!body.chat_id || !body.text) return Response.json({ error: "chat_id and text required" }, { status: 400 });
      if (body.text.length > 4000 || body.chat_id.length > 100 || !body.chat_id.includes("@")) {
        return Response.json({ error: "invalid chat_id or text" }, { status: 400 });
      }
      try {
        const messageId = await sendText(deps, body.chat_id, body.text);
        return Response.json({ ok: true, message_id: messageId });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "send failed" }, { status: 502 });
      }
    }

    if (url.pathname === "/mcp") {
      const server = new McpServer({ name: "keepmind-whatsapp", version: "1.0.0" });
      registerTools(server, deps);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: 256_000,
      });
      await server.connect(transport);
      try {
        return await transport.handleRequest(req);
      } finally {
        await transport.close();
        await server.close();
      }
    }

    return new Response("Not found", { status: 404 });
  };
}
