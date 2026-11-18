import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type BridgeEvent,
  type BridgeHandle,
  type BridgeOptions,
  messageText,
  phoneOf,
  postEventToEngine,
  type SocketLike,
} from "./events.ts";
import { createBridgeApiHandler } from "./mcp.ts";
import { ChatStore } from "./store.ts";
import { ensureAuthDir, makeBaileysSocket } from "./wa.ts";

export type { BridgeEvent, BridgeHandle, BridgeOptions, SocketLike } from "./events.ts";
export { ChatStore } from "./store.ts";

const LOGGED_OUT_STATUS = 401;

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Starts the WhatsApp bridge: a Baileys socket plus a tiny HTTP server.
 * Task 1 surface: /health + session lifecycle. MCP lands in Task 2.
 */
export async function startBridge(opts: BridgeOptions): Promise<BridgeHandle> {
  ensureAuthDir(opts.dataDir);
  const socketFactory = opts.socketFactory ?? makeBaileysSocket;
  const postEvent =
    opts.postEvent ?? ((_url, token, event) => postEventToEngine(opts.apiBaseUrl, opts.orgId, token, event));

  const emit = (event: BridgeEvent) => {
    opts.onEvent?.(event);
    // Engine learns about pairing/session state and inbound messages here.
    void postEvent(`${opts.apiBaseUrl}/api/internal/whatsapp/${opts.orgId}/event`, opts.token, event).catch(() => {});
  };

  const socket: SocketLike = await socketFactory({ authDir: opts.dataDir });
  const store = new ChatStore();

  socket.on("connection.update", (raw) => {
    const update = raw as {
      qr?: unknown;
      connection?: unknown;
      lastDisconnect?: { error?: { output?: { statusCode?: unknown } } };
    } | null;
    if (typeof update?.qr === "string") emit({ type: "qr", qr: update.qr });
    if (update?.connection === "connecting") emit({ type: "connecting" });
    if (update?.connection === "open") {
      emit({
        type: "connected",
        phone: phoneOf(socket.user?.id),
        name: socket.user?.name ?? "",
      });
    }
    if (update?.connection === "close") {
      const status = update?.lastDisconnect?.error?.output?.statusCode;
      if (status === LOGGED_OUT_STATUS) {
        emit({ type: "logged_out" });
      } else {
        emit({ type: "disconnected", reason: `close:${status ?? "unknown"}` });
      }
    }
  });

  // Only live "notify" upserts: "append" is the history-sync backlog on
  // (re)connect, which would flood the workspace with old messages and a run
  // each. key.id dedupes notify/append overlap and event retries.
  const seenMessages = new Set<string>();
  socket.on("messages.upsert", (raw) => {
    const upsert = raw as {
      type?: string;
      messages?: {
        key?: { id?: string; remoteJid?: string; fromMe?: boolean; participant?: string };
        pushName?: string;
        messageTimestamp?: unknown;
        message?: import("./events.ts").WaProtoLike;
      }[];
    } | null;
    if (upsert?.type !== "notify") return;
    for (const msg of upsert.messages ?? []) {
      const key = msg?.key;
      if (!key || key.fromMe) continue;
      if (key.id) {
        if (seenMessages.has(key.id)) continue;
        seenMessages.add(key.id);
        if (seenMessages.size > 5000) {
          const oldest = seenMessages.values().next();
          if (!oldest.done) seenMessages.delete(oldest.value);
        }
      }
      const chatId = key.remoteJid;
      if (!chatId || chatId.endsWith("@g.us") || chatId === "status@broadcast") continue;
      const { text, hasMedia } = messageText(msg);
      if (!text) continue;
      store.recordInbound({
        chatId,
        chatName: msg.pushName ?? chatId,
        senderId: key.participant ?? chatId,
        senderName: msg.pushName ?? key.participant ?? chatId,
        text,
        timestamp: Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000)),
        hasMedia,
        key: { id: key.id ?? "", remoteJid: chatId, fromMe: false, participant: key.participant },
      });
      emit({
        type: "message",
        chat: { id: chatId, name: msg.pushName ?? chatId },
        sender: {
          id: key.participant ?? chatId,
          name: msg.pushName ?? key.participant ?? chatId,
        },
        text: hasMedia && text === "" ? "[media]" : text,
        timestamp: Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000)),
        hasMedia,
      });
    }
  });

  const apiHandler = createBridgeApiHandler({ token: opts.token, store, socket });

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const webReq = new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    try {
      const webRes = await apiHandler(webReq);
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
      res.end(Buffer.from(await webRes.arrayBuffer()));
    } catch {
      json(res, 500, { error: "internal" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await socket.end?.(true).catch(() => {});
    },
  };
}
