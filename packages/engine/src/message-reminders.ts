import type { PubSub } from "@keepmind/adapters";
import type { Database } from "@keepmind/db";
import { and, asc, eq, isNotNull, isNull, schema } from "@keepmind/db";
import { requireChannelAccess } from "./channels";
import { NotFoundError, ValidationError } from "./errors";
import { getMessage } from "./messages";
import { notificationSnippet, notify } from "./notifications";
import { enqueue } from "./outbox";

const { messageReminders, channels } = schema;

/**
 * "Lembrar depois": a person marks a message to be reminded of at `remindAt`
 * (Slack's "remind me about this"). The reminder is a `message_reminders` row
 * plus a `reminder.due` outbox job at that instant; the job notifies them once
 * and stamps `doneAt`. Re-reminding the same message updates the row and
 * schedules a fresh job (the old one wakes early, sees `remindAt` in the
 * future and does nothing).
 */

export interface MessageReminderView {
  id: string;
  orgId: string;
  channelId: string;
  messageId: string;
  threadId: string | null;
  remindAt: string;
  note: string | null;
  doneAt: string | null;
  createdAt: string;
}

const view = (r: typeof messageReminders.$inferSelect, threadId: string | null): MessageReminderView => ({
  id: r.id,
  orgId: r.orgId,
  channelId: r.channelId,
  messageId: r.messageId,
  threadId,
  remindAt: r.remindAt.toISOString(),
  note: r.note,
  doneAt: r.doneAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

/** The least lead time a reminder may have: enough for the job to be claimed on time. */
const MIN_LEAD_MS = 30_000;

export async function remindAboutMessage(
  db: Database,
  actorId: string,
  orgId: string,
  channelId: string,
  messageId: string,
  remindAt: Date,
  note?: string | null,
): Promise<MessageReminderView> {
  await requireChannelAccess(db, actorId, orgId, channelId);
  const message = await getMessage(db, orgId, messageId);
  if (!message || message.channelId !== channelId || message.deletedAt) throw new NotFoundError("Message not found");
  if (Number.isNaN(remindAt.getTime())) throw new ValidationError("remindAt must be a valid date");
  if (remindAt.getTime() < Date.now() + MIN_LEAD_MS) throw new ValidationError("remindAt must be in the future");

  const trimmed = note?.trim() || null;
  const [row] = await db
    .insert(messageReminders)
    .values({ orgId, channelId, messageId, userId: actorId, remindAt, note: trimmed })
    .onConflictDoUpdate({
      target: [messageReminders.userId, messageReminders.messageId],
      set: { remindAt, note: trimmed, doneAt: null },
    })
    .returning();
  if (!row) throw new Error("reminder upsert returned no row");
  await enqueue(db, {
    orgId,
    kind: "reminder.due",
    payload: { reminderId: row.id },
    runAt: remindAt,
    dedupeKey: `reminder.due:${row.id}:${remindAt.toISOString()}`,
  });
  return view(row, message.threadId);
}

/** A person's reminders, soonest first; `done` picks upcoming (default) or fired ones. */
export async function listMessageReminders(
  db: Database,
  userId: string,
  orgId: string,
  done = false,
  limit = 100,
): Promise<MessageReminderView[]> {
  const rows = await db
    .select()
    .from(messageReminders)
    .where(
      and(
        eq(messageReminders.userId, userId),
        eq(messageReminders.orgId, orgId),
        done ? isNotNull(messageReminders.doneAt) : isNull(messageReminders.doneAt),
      ),
    )
    .orderBy(asc(messageReminders.remindAt))
    .limit(limit);
  return rows.map((r) => view(r, null));
}

/** Cancels a reminder the person owns; deleting is fine — a fired one stays history-free. */
export async function cancelMessageReminder(
  db: Database,
  userId: string,
  orgId: string,
  reminderId: string,
): Promise<void> {
  await db
    .delete(messageReminders)
    .where(
      and(eq(messageReminders.id, reminderId), eq(messageReminders.userId, userId), eq(messageReminders.orgId, orgId)),
    );
}

/**
 * Job `reminder.due`: fires once per scheduled instant. A row already done, or
 * rescheduled later, is left alone; otherwise it is stamped and the person is
 * notified with the message's snippet and their note.
 */
export async function messageReminderDue(
  deps: { db: Database; pubsub?: PubSub; now?: () => Date },
  payload: { reminderId?: string },
): Promise<void> {
  const reminderId = payload.reminderId;
  if (!reminderId) return;
  const now = deps.now?.() ?? new Date();
  const [row] = await deps.db.select().from(messageReminders).where(eq(messageReminders.id, reminderId));
  if (!row || row.doneAt || row.remindAt.getTime() > now.getTime() + 60_000) return;
  const [done] = await deps.db
    .update(messageReminders)
    .set({ doneAt: now })
    .where(and(eq(messageReminders.id, reminderId), isNull(messageReminders.doneAt)))
    .returning({ id: messageReminders.id });
  if (!done) return;

  const message = await getMessage(deps.db, row.orgId, row.messageId);
  const [channel] = await deps.db
    .select({ name: channels.name, kind: channels.kind })
    .from(channels)
    .where(and(eq(channels.id, row.channelId), eq(channels.orgId, row.orgId)));
  const snippet = message ? notificationSnippet(message.body) : "";
  const text = [snippet, row.note].filter(Boolean).join(" — ") || undefined;
  await notify(deps, {
    orgId: row.orgId,
    userIds: [row.userId],
    kind: "reminder",
    groupKey: `reminder:${row.id}`,
    source: {
      channelId: row.channelId,
      messageId: row.messageId,
      threadId: message?.threadId ?? undefined,
      label: channel?.name ?? undefined,
    },
    latest: { text },
  }).catch(() => []);
}
