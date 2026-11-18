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
import { ensureAuthDir, makeBaileysSocket } from "./wa.ts";

export type { BridgeEvent, BridgeHandle, BridgeOptions, SocketLike } from "./events.ts";

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
    opts.postEvent ?? ((url, token, event) => postEventToEngine(opts.apiBaseUrl, opts.orgId, token, event));

  const emit = (event: BridgeEvent) => {
    opts.onEvent?.(event);
    // Engine learns about pairing/session state and inbound messages here.
    void postEvent(`${opts.apiBaseUrl}/api/internal/whatsapp/${opts.orgId}/event`, opts.token, event).catch(() => {});
  };

  const socket: SocketLike = await socketFactory({ authDir: opts.dataDir });

  socket.on("connection.update", (update: any) => {
    if (update?.qr) emit({ type: "qr", qr: update.qr });
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

  socket.on("messages.upsert", (upsert: any) => {
    if (upsert?.type !== "notify" && upsert?.type !== "append") return;
    for (const msg of upsert.messages ?? []) {
      const key = msg?.key;
      if (!key || key.fromMe) continue;
      const chatId = key.remoteJid;
      if (!chatId || chatId.endsWith("@g.us") || chatId === "status@broadcast") continue;
      const { text, hasMedia } = messageText(msg);
      if (!text) continue;
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

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }
    json(res, 404, { error: "not_found" });
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
