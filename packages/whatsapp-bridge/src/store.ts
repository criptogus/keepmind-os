/**
 * In-memory view of WhatsApp chats and recent messages.
 *
 * Baileys does not expose a full chat list on demand, so the bridge learns
 * chats from traffic (inbound upserts and our own sends). v1 limitation:
 * history is bounded and lives only as long as the bridge process.
 */

export interface StoredMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  direction: "in" | "out";
  text: string;
  timestamp: number;
  hasMedia: boolean;
  /** Baileys message key, kept so mark_read can send a real receipt. */
  key?: { id: string; remoteJid: string; fromMe: boolean; participant?: string };
}

export interface ChatEntry {
  id: string;
  name: string;
  lastText: string;
  lastAt: number;
  unread: number;
}

const MAX_MESSAGES_PER_CHAT = 500;
const MAX_CHATS = 1000;

export class ChatStore {
  private chats = new Map<string, ChatEntry>();
  private messages = new Map<string, StoredMessage[]>();

  recordInbound(msg: {
    chatId: string;
    chatName: string;
    senderId: string;
    senderName: string;
    text: string;
    timestamp: number;
    hasMedia: boolean;
    key?: StoredMessage["key"];
  }): StoredMessage {
    const stored: StoredMessage = {
      id: msg.key?.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatId: msg.chatId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      direction: "in",
      text: msg.text,
      timestamp: msg.timestamp,
      hasMedia: msg.hasMedia,
      key: msg.key,
    };
    this.push(stored);
    const chat = this.chats.get(msg.chatId) ?? {
      id: msg.chatId,
      name: msg.chatName,
      lastText: "",
      lastAt: 0,
      unread: 0,
    };
    chat.name = msg.chatName || chat.name;
    chat.lastText = msg.text;
    chat.lastAt = msg.timestamp;
    chat.unread += 1;
    this.chats.set(msg.chatId, chat);
    return stored;
  }

  recordOutbound(chatId: string, chatName: string, text: string, messageId?: string): StoredMessage {
    const stored: StoredMessage = {
      id: messageId ?? `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatId,
      senderId: "me",
      senderName: "me",
      direction: "out",
      text,
      timestamp: Math.floor(Date.now() / 1000),
      hasMedia: false,
    };
    this.push(stored);
    const chat = this.chats.get(chatId) ?? {
      id: chatId,
      name: chatName || chatId,
      lastText: "",
      lastAt: 0,
      unread: 0,
    };
    chat.lastText = text;
    chat.lastAt = stored.timestamp;
    this.chats.set(chatId, chat);
    return stored;
  }

  private push(msg: StoredMessage) {
    const list = this.messages.get(msg.chatId) ?? [];
    list.push(msg);
    if (list.length > MAX_MESSAGES_PER_CHAT) list.splice(0, list.length - MAX_MESSAGES_PER_CHAT);
    this.messages.set(msg.chatId, list);
    if (!this.chats.has(msg.chatId) && this.chats.size >= MAX_CHATS) {
      // Evict the oldest chat to bound memory.
      let oldest: string | undefined;
      let oldestAt = Infinity;
      for (const [id, c] of this.chats) {
        if (c.lastAt < oldestAt) {
          oldestAt = c.lastAt;
          oldest = id;
        }
      }
      if (oldest) {
        this.chats.delete(oldest);
        this.messages.delete(oldest);
      }
    }
  }

  listChats(): ChatEntry[] {
    return [...this.chats.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  readMessages(chatId: string, limit = 50): StoredMessage[] {
    const list = this.messages.get(chatId) ?? [];
    return list.slice(-Math.min(Math.max(limit, 1), 200));
  }

  searchMessages(query: string, limit = 20): StoredMessage[] {
    const q = query.toLowerCase();
    const hits: StoredMessage[] = [];
    for (const list of this.messages.values()) {
      for (const m of list) {
        if (m.text.toLowerCase().includes(q)) hits.push(m);
      }
    }
    hits.sort((a, b) => b.timestamp - a.timestamp);
    return hits.slice(0, Math.min(Math.max(limit, 1), 100));
  }

  getChat(chatId: string): ChatEntry | undefined {
    return this.chats.get(chatId);
  }

  markRead(chatId: string): StoredMessage[] {
    const chat = this.chats.get(chatId);
    if (chat) chat.unread = 0;
    return this.messages.get(chatId) ?? [];
  }
}
