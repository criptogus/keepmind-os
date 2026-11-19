import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BridgeHandle, type SocketLike, startBridge } from "../src/index.ts";

class FakeSocket extends EventEmitter implements SocketLike {
  sent: { chatId: string; content: unknown }[] = [];
  user: { id?: string; name?: string } | undefined;
  async sendMessage(chatId: string, content: unknown) {
    this.sent.push({ chatId, content });
    return { key: { id: `id-${this.sent.length}` } };
  }
  async end() {}
}

async function start(dataDir?: string) {
  const sockets: FakeSocket[] = [];
  const events: unknown[] = [];
  const handle = await startBridge({
    orgId: "org-1",
    dataDir: dataDir ?? mkdtempSync(join(tmpdir(), "wa-mcp-")),
    port: 0,
    token: "tok",
    apiBaseUrl: "http://127.0.0.1:1",
    postEvent: async () => {},
    socketFactory: async () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onEvent: (e) => events.push(e),
  });
  return { handle, sockets, events };
}

function rpc(handle: BridgeHandle, method: string, params?: unknown, token = "tok") {
  return fetch(`http://127.0.0.1:${handle.port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function callTool(handle: BridgeHandle, name: string, args: Record<string, unknown>) {
  const res = await rpc(handle, "tools/call", { name, arguments: args });
  const body = (await res.json()) as { result?: { tools?: { name: string; annotations?: Record<string, unknown> }[] } };
  return body.result;
}

describe("whatsapp bridge MCP surface", () => {
  test("/mcp requires the bearer token", async () => {
    const { handle } = await start();
    const res = await rpc(handle, "initialize", {}, "");
    expect(res.status).toBe(401);
    const bad = await rpc(handle, "initialize", {}, "wrong");
    expect(bad.status).toBe(401);
    await handle.close();
  });

  test("tools/list exposes the eight whatsapp tools with hints", async () => {
    const { handle } = await start();
    await rpc(handle, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    const res = await rpc(handle, "tools/list");
    const body = (await res.json()) as {
      result?: { tools?: { name: string; annotations?: Record<string, unknown> }[] };
    };
    const names = (body.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([
      "whatsapp_create_group",
      "whatsapp_get_chat",
      "whatsapp_list_chats",
      "whatsapp_mark_read",
      "whatsapp_read_messages",
      "whatsapp_search_messages",
      "whatsapp_send_media",
      "whatsapp_send_message",
    ]);
    const send = body.result?.tools?.find((t) => t.name === "whatsapp_send_message");
    expect(send?.annotations?.destructiveHint).toBe(true);
    const list = body.result?.tools?.find((t) => t.name === "whatsapp_list_chats");
    expect(list?.annotations?.readOnlyHint).toBe(true);
    await handle.close();
  });

  test("send_message calls the socket and read_messages sees inbound mail", async () => {
    const { handle, sockets } = await start();
    const sock = sockets[0];
    if (!sock) throw new Error("no socket");
    sock.emit("messages.upsert", {
      messages: [
        {
          key: { fromMe: false, remoteJid: "5511888888888@s.whatsapp.net", id: "m1" },
          pushName: "Maria",
          message: { conversation: "preciso de ajuda" },
          messageTimestamp: 1730000000,
        },
      ],
      type: "notify",
    });
    await Bun.sleep(5);

    const read = await callTool(handle, "whatsapp_read_messages", { chat_id: "5511888888888@s.whatsapp.net" });
    const text = JSON.stringify(read);
    expect(text).toContain("preciso de ajuda");
    expect(text).toContain("Maria");

    const sent = await callTool(handle, "whatsapp_send_message", {
      chat_id: "5511888888888@s.whatsapp.net",
      text: "claro, como ajudo?",
    });
    expect(JSON.stringify(sent)).not.toContain('"isError":true');
    expect(sock.sent).toHaveLength(1);
    expect(sock.sent[0]?.chatId).toBe("5511888888888@s.whatsapp.net");
    await handle.close();
  });

  test("POST /send delivers text with bearer auth", async () => {
    const { handle, sockets } = await start();
    const sock = sockets[0];
    if (!sock) throw new Error("no socket");

    const noAuth = await fetch(`http://127.0.0.1:${handle.port}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: "5511@s.whatsapp.net", text: "oi" }),
    });
    expect(noAuth.status).toBe(401);

    const res = await fetch(`http://127.0.0.1:${handle.port}/send`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok" },
      body: JSON.stringify({ chat_id: "5511@s.whatsapp.net", text: "oi" }),
    });
    expect(res.status).toBe(200);
    expect(sock.sent).toHaveLength(1);
    await handle.close();
  });
});
