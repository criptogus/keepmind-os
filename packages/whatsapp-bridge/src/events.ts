export type BridgeEvent =
  | { type: "qr"; qr: string }
  | { type: "connecting" }
  | { type: "connected"; phone: string; name: string }
  | { type: "disconnected"; reason: string }
  | { type: "logged_out" }
  | {
      type: "message";
      chat: { id: string; name: string };
      sender: { id: string; name: string };
      text: string;
      timestamp: number;
      hasMedia: boolean;
    };

export interface BridgeOptions {
  orgId: string;
  dataDir: string;
  port: number;
  /** Bearer token the engine checks on inbound event POSTs. */
  token: string;
  /** Engine internal API base, e.g. http://127.0.0.1:3088 */
  apiBaseUrl: string;
  onEvent?: (e: BridgeEvent) => void;
  /** Test seam: replaces the real Baileys socket. */
  socketFactory?: (opts: { authDir: string }) => Promise<SocketLike> | SocketLike;
  /** Test seam: replaces the engine event POST. */
  postEvent?: (url: string, token: string, event: BridgeEvent) => Promise<void>;
}

export interface SocketLike {
  user?: { id?: string; name?: string };
  sendMessage(chatId: string, content: unknown): Promise<unknown>;
  end?(disconnect?: boolean): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
}

export interface BridgeHandle {
  port: number;
  close(): Promise<void>;
}

/** Default engine event poster: POST with bearer, 2 retries. */
export async function postEventToEngine(
  apiBaseUrl: string,
  orgId: string,
  token: string,
  event: BridgeEvent,
): Promise<void> {
  const url = `${apiBaseUrl}/api/internal/whatsapp/${orgId}/event`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(event),
      });
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
}

/** Extracts the phone number from a Baileys user id like "5511...:12@s.whatsapp.net". */
export function phoneOf(userId: string | undefined): string {
  if (!userId) return "";
  return userId.split("@")[0]!.split(":")[0]!;
}

/** Text of an inbound Baileys message, or "[media]" placeholder. */
export function messageText(message: any): { text: string; hasMedia: boolean } {
  const m = message?.message;
  if (!m) return { text: "", hasMedia: false };
  if (typeof m.conversation === "string") return { text: m.conversation, hasMedia: false };
  const ext = m.extendedTextMessage?.text;
  if (typeof ext === "string") return { text: ext, hasMedia: false };
  const caption = m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.documentMessage?.caption;
  if (typeof caption === "string" && caption) return { text: caption, hasMedia: true };
  const mediaKeys = [
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
    "stickerMessage",
    "locationMessage",
    "contactMessage",
  ];
  if (mediaKeys.some((k) => m[k])) return { text: "[media]", hasMedia: true };
  return { text: "", hasMedia: false };
}

const MEDIA_PLACEHOLDER = "[media]";

export { MEDIA_PLACEHOLDER };
