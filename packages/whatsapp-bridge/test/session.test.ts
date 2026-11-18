import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BridgeEvent, type BridgeHandle, type SocketLike, startBridge } from "../src/index.ts";

class FakeSocket extends EventEmitter implements SocketLike {
  sent: { chatId: string; text: string }[] = [];
  user: { id: string; name?: string } | undefined;
  ended = false;
  async sendMessage(chatId: string, content: unknown) {
    this.sent.push({ chatId, text: JSON.stringify(content) });
    return { key: { id: "fake-id" } };
  }
  async end() {
    this.ended = true;
  }
}

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), "wa-bridge-"));
}

async function startWithFake(dataDir: string, events: BridgeEvent[], sockets: FakeSocket[]): Promise<BridgeHandle> {
  return startBridge({
    orgId: "org-1",
    dataDir,
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
}

describe("whatsapp bridge session lifecycle", () => {
  test("qr, connected, message and logged_out events are mapped", async () => {
    const events: BridgeEvent[] = [];
    const sockets: FakeSocket[] = [];
    const handle = await startWithFake(tmpDataDir(), events, sockets);
    const sock = sockets[0]!;

    sock.emit("connection.update", { qr: "qr-string-1", connection: "connecting" });
    await Bun.sleep(1);
    expect(events).toContainEqual({ type: "qr", qr: "qr-string-1" });

    sock.user = { id: "5511999999999:12@s.whatsapp.net", name: "Gustavo" };
    sock.emit("connection.update", { connection: "open" });
    await Bun.sleep(1);
    expect(events).toContainEqual({ type: "connected", phone: "5511999999999", name: "Gustavo" });

    sock.emit("messages.upsert", {
      messages: [
        {
          key: { fromMe: false, remoteJid: "5511888888888@s.whatsapp.net", id: "m1" },
          pushName: "Maria",
          message: { conversation: "oi, tudo bem?" },
          messageTimestamp: 1730000000,
        },
      ],
      type: "notify",
    });
    await Bun.sleep(1);
    expect(events).toContainEqual({
      type: "message",
      chat: { id: "5511888888888@s.whatsapp.net", name: "Maria" },
      sender: { id: "5511888888888@s.whatsapp.net", name: "Maria" },
      text: "oi, tudo bem?",
      timestamp: 1730000000,
      hasMedia: false,
    });

    sock.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });
    await Bun.sleep(1);
    expect(events).toContainEqual({ type: "logged_out" });

    await handle.close();
  });

  test("media messages produce a [media] placeholder", async () => {
    const events: BridgeEvent[] = [];
    const sockets: FakeSocket[] = [];
    const handle = await startWithFake(tmpDataDir(), events, sockets);
    const sock = sockets[0]!;

    sock.emit("messages.upsert", {
      messages: [
        {
          key: { fromMe: false, remoteJid: "5511888888888@s.whatsapp.net", id: "m2" },
          pushName: "Maria",
          message: { imageMessage: { mimetype: "image/jpeg" } },
          messageTimestamp: 1730000001,
        },
      ],
      type: "notify",
    });
    await Bun.sleep(1);
    const msg = events.find((e) => e.type === "message");
    expect(msg).toMatchObject({ text: "[media]", hasMedia: true });
    await handle.close();
  });

  test("fromMe messages are ignored", async () => {
    const events: BridgeEvent[] = [];
    const sockets: FakeSocket[] = [];
    const handle = await startWithFake(tmpDataDir(), events, sockets);
    const sock = sockets[0]!;

    sock.emit("messages.upsert", {
      messages: [
        {
          key: { fromMe: true, remoteJid: "5511888888888@s.whatsapp.net", id: "m3" },
          message: { conversation: "echo" },
          messageTimestamp: 1730000002,
        },
      ],
      type: "append",
    });
    await Bun.sleep(1);
    expect(events.filter((e) => e.type === "message")).toHaveLength(0);
    await handle.close();
  });

  test("existing session dir restores without a QR", async () => {
    const dataDir = tmpDataDir();
    mkdirSync(join(dataDir, "auth"), { recursive: true });
    writeFileSync(join(dataDir, "auth", "creds.json"), "{}");

    const events: BridgeEvent[] = [];
    const sockets: FakeSocket[] = [];
    const handle = await startWithFake(dataDir, events, sockets);
    const sock = sockets[0]!;

    // With stored creds the socket goes straight to open — no qr event.
    sock.user = { id: "5511777777777:1@s.whatsapp.net", name: "Old" };
    sock.emit("connection.update", { connection: "open" });
    await Bun.sleep(1);

    expect(events.filter((e) => e.type === "qr")).toHaveLength(0);
    expect(events).toContainEqual({ type: "connected", phone: "5511777777777", name: "Old" });
    await handle.close();
  });
});
