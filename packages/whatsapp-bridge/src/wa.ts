import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SocketLike } from "./events.ts";

const silentLogger = {
  level: "silent",
  child() {
    return this;
  },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

/**
 * Real Baileys socket. Imported lazily so tests and typecheck never load it.
 * Baileys is WhatsApp's unofficial web protocol — see the design doc for the
 * ban-risk trade-off the org accepted by enabling this connector.
 */
export async function makeBaileysSocket(opts: { authDir: string }): Promise<SocketLike> {
  const baileys = await import("@whiskeysockets/baileys");
  const { state, saveCreds } = await baileys.useMultiFileAuthState(join(opts.authDir, "auth"));
  const sock = baileys.makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["KeepMind OS", "Chrome", "1.0"],
    markOnlineOnConnect: false,
    logger: silentLogger as any,
    // Keep the socket alive across brief network drops; the engine marks
    // needs_reconnect when the session is truly gone (logged_out).
    keepAliveIntervalMs: 30_000,
  });
  sock.ev.on("creds.update", saveCreds);
  return sock as unknown as SocketLike;
}

export function ensureAuthDir(dataDir: string): void {
  mkdirSync(join(dataDir, "auth"), { recursive: true, mode: 0o700 });
}
