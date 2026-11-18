import { integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { organizations } from "./tenancy";

/**
 * One WhatsApp pairing per organization (the unofficial QR/session bridge —
 * see the WhatsApp connector design doc for the accepted ban risk).
 * `status`: `pairing` (QR outstanding), `connected`, `needs_reconnect`
 * (session lost or bridge down) or `off` (disconnected by an admin).
 * `bridgeTokenCiphertext`/`wrappedDataKey`/`kekId` hold the spawn token
 * sealed like other connection secrets: the engine verifies the bridge's
 * bearer on the internal event route and uses it for the bridge's own
 * loopback API. Plaintext exists only in the spawn env and the bridge.
 */
export const whatsappSessions = pgTable("whatsapp_sessions", {
  orgId: uuid()
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  status: text().notNull().default("off"),
  /** The paired number, digits only, once connected. */
  phone: text(),
  /** Agent that answers inbound WhatsApp messages; null = the workspace right hand. */
  answerAgentId: uuid().references(() => agents.id, { onDelete: "set null" }),
  bridgePort: integer(),
  bridgeTokenCiphertext: text(),
  wrappedDataKey: text(),
  kekId: text(),
  lastError: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Maps a WhatsApp chat (its jid) to the thread that mirrors it in the
 * organization's `WhatsApp` channel. One row per chat per org; the thread
 * root is a plain message id, matching how `messages.thread_id` works.
 */
export const whatsappChats = pgTable(
  "whatsapp_chats",
  {
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** WhatsApp chat jid, e.g. "5511888888888@s.whatsapp.net" or a group jid. */
    chatId: text().notNull(),
    /** Root message of the mirrored thread; a plain uuid like `messages.thread_id` (no FK: messages.id isn't unique). */
    threadRootId: uuid().notNull(),
    participantName: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.chatId] })],
);
