import type { PubSub } from "@keepmind/adapters";
import type { Database } from "@keepmind/db";
import { and, asc, desc, eq, isNotNull, isNull, schema } from "@keepmind/db";
import { postRefusal, requireChannelAccess } from "./channels";
import { ConflictError, ValidationError } from "./errors";
import type { Judge } from "./judge";
import { attachmentRefsFor, postPersonMessage } from "./messages";
import { can } from "./organizations";
import { enqueue } from "./outbox";
import { closedRefusal } from "./standing";

const { scheduledMessages } = schema;

/**
 * Scheduled send (Slack's schedule message): a person writes now and a
 * `scheduled.send` outbox job posts it as them at `sendAt`, through the same
 * `postPersonMessage` a live send uses (mentions, routing, threads, files).
 * Resending the same `clientId` moves the pending send instead of queueing a
 * second one; cancel deletes the row. `sentAt`/`sentMessageId` mark it went out.
 */

export interface ScheduledMessageView {
  id: string;
  orgId: string;
  channelId: string;
  threadId: string | null;
  body: string;
  replyTo: string | null;
  attachments: string[];
  sendAt: string;
  sentAt: string | null;
  sentMessageId: string | null;
  createdAt: string;
}

const view = (r: typeof scheduledMessages.$inferSelect): ScheduledMessageView => ({
  id: r.id,
  orgId: r.orgId,
  channelId: r.channelId,
  threadId: r.threadId,
  body: r.body,
  replyTo: r.replyTo,
  attachments: r.attachments,
  sendAt: r.sendAt.toISOString(),
  sentAt: r.sentAt?.toISOString() ?? null,
  sentMessageId: r.sentMessageId,
  createdAt: r.createdAt.toISOString(),
});

/** The least lead a scheduled send may have: enough for the job to be claimed on time. */
const MIN_LEAD_MS = 30_000;
/** And the most: a year out, like the phone's remind sheet allows. */
const MAX_AHEAD_MS = 366 * 86_400_000;

export async function scheduleMessage(
  db: Database,
  userId: string,
  orgId: string,
  channelId: string,
  input: {
    body: string;
    threadId?: string | null;
    replyTo?: string | null;
    attachments?: string[];
    sendAt: Date;
    clientId?: string | null;
  },
): Promise<ScheduledMessageView> {
  const { membership, workspace } = await requireChannelAccess(db, userId, orgId, channelId);
  const closed = closedRefusal(membership.standing);
  if (closed) throw closed;
  if (!can(membership, "post")) throw postRefusal(workspace);
  const body = input.body.trim();
  const attachments = input.attachments ?? [];
  if (!body && attachments.length === 0) throw new ValidationError("A scheduled message needs text or a file");
  // Same file rules as a live send, checked now so a bad pick fails at schedule time, not at send time.
  if (attachments.length) await attachmentRefsFor(db, userId, orgId, channelId, attachments);
  if (Number.isNaN(input.sendAt.getTime())) throw new ValidationError("sendAt must be a valid date");
  const now = Date.now();
  if (input.sendAt.getTime() < now + MIN_LEAD_MS) throw new ValidationError("sendAt must be at least 30 seconds ahead");
  if (input.sendAt.getTime() > now + MAX_AHEAD_MS) throw new ValidationError("sendAt is too far ahead");

  const clientId = input.clientId?.trim().slice(0, 64) || null;
  const values = {
    orgId,
    userId,
    channelId,
    threadId: input.threadId ?? null,
    body,
    replyTo: input.replyTo ?? null,
    attachments,
    sendAt: input.sendAt,
    clientId,
  };
  // A resend of the same draft moves its send (and its job); a fresh one inserts.
  const [row] = clientId
    ? await db
        .insert(scheduledMessages)
        .values(values)
        .onConflictDoUpdate({
          target: [scheduledMessages.orgId, scheduledMessages.userId, scheduledMessages.clientId],
          set: {
            channelId: values.channelId,
            threadId: values.threadId,
            body: values.body,
            replyTo: values.replyTo,
            attachments: values.attachments,
            sendAt: values.sendAt,
            sentAt: null,
            sentMessageId: null,
          },
          // Only a pending send moves: a sent one's row stays as history.
          setWhere: isNull(scheduledMessages.sentAt),
        })
        .returning()
    : await db.insert(scheduledMessages).values(values).returning();
  if (!row) throw new ConflictError("That message already went out");
  await enqueue(db, {
    kind: "scheduled.send",
    orgId,
    payload: { scheduledMessageId: row.id, sendAt: row.sendAt.toISOString() },
    runAt: row.sendAt,
    dedupeKey: `scheduled.send:${row.id}:${row.sendAt.getTime()}`,
  });
  return view(row);
}

/** My scheduled sends, soonest first (`sent`: the ones that went out, latest first). */
export async function listScheduledMessages(
  db: Database,
  userId: string,
  orgId: string,
  sent = false,
  limit = 100,
): Promise<ScheduledMessageView[]> {
  const rows = await db
    .select()
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.userId, userId),
        eq(scheduledMessages.orgId, orgId),
        sent ? isNotNull(scheduledMessages.sentAt) : isNull(scheduledMessages.sentAt),
      ),
    )
    .orderBy(sent ? desc(scheduledMessages.sendAt) : asc(scheduledMessages.sendAt))
    .limit(limit);
  return rows.map(view);
}

/** Cancels one of my pending sends; deleting is fine — a sent one stays as history. */
export async function cancelScheduledMessage(
  db: Database,
  userId: string,
  orgId: string,
  scheduledMessageId: string,
): Promise<void> {
  await db
    .delete(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.id, scheduledMessageId),
        eq(scheduledMessages.userId, userId),
        eq(scheduledMessages.orgId, orgId),
        isNull(scheduledMessages.sentAt),
      ),
    );
}

/**
 * The `scheduled.send` job: posts the message as its person through `postPersonMessage` and stamps `sentAt`.
 * A row already sent (a retried job) or rescheduled past this job's time does nothing; a person who lost
 * access by then fails for good (`sentAt` stays null, the job's retries exhaust).
 */
export async function scheduledMessageSend(
  deps: { db: Database; pubsub: PubSub; judge?: Judge; now?: () => Date },
  scheduledMessageId: string,
  sendAt?: string,
): Promise<void> {
  if (!scheduledMessageId) return;
  const now = deps.now?.() ?? new Date();
  const [row] = await deps.db.select().from(scheduledMessages).where(eq(scheduledMessages.id, scheduledMessageId));
  if (!row || row.sentAt) return;
  // A stale job (the send was moved later) wakes early and does nothing.
  if (sendAt && row.sendAt.toISOString() !== sendAt) return;
  if (row.sendAt.getTime() > now.getTime() + 60_000) return;
  const [claimed] = await deps.db
    .update(scheduledMessages)
    .set({ sentAt: now })
    .where(and(eq(scheduledMessages.id, scheduledMessageId), isNull(scheduledMessages.sentAt)))
    .returning({ id: scheduledMessages.id });
  if (!claimed) return;
  try {
    const message = await postPersonMessage(
      { db: deps.db, pubsub: deps.pubsub, judge: deps.judge },
      row.userId,
      row.orgId,
      row.channelId,
      {
        body: row.body,
        threadId: row.threadId,
        replyTo: row.replyTo,
        attachments: row.attachments.length ? row.attachments : undefined,
      },
    );
    await deps.db
      .update(scheduledMessages)
      .set({ sentMessageId: message.id })
      .where(eq(scheduledMessages.id, scheduledMessageId));
  } catch (e) {
    // The claim stays: the row reads as sent-ish but never reached the channel — clear it so a retry can post.
    await deps.db.update(scheduledMessages).set({ sentAt: null }).where(eq(scheduledMessages.id, scheduledMessageId));
    throw e;
  }
}
