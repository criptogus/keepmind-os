import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@keepmind/db";
import {
  addChannelMember,
  cancelMessageReminder,
  createChannel,
  drainOutbox,
  listMessageReminders,
  listNotifications,
  messageReminderDue,
  NotFoundError,
  postPersonMessage,
  remindAboutMessage,
  ValidationError,
} from "../src";
import { addMember, setup, type Fixture } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const HOUR = 3600_000;
const inAnHour = () => new Date(Date.now() + HOUR);
const inbox = (userId: string) => listNotifications({ db: f.db, pubsub: f.pubsub }, userId, f.org.id);

async function say(body = "lembra disso", userId = f.owner.id, channelId = f.general.id) {
  return postPersonMessage({ db: f.db, pubsub: f.pubsub }, userId, f.org.id, channelId, { body });
}

describe("message reminders", () => {
  test("reminding a message stores it, schedules reminder.due and lists it", async () => {
    f = await setup();
    const msg = await say("revisar o contrato");
    const at = inAnHour();
    const r = await remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, msg.id, at, "  ligar pro jurídico  ");

    expect(r.messageId).toBe(msg.id);
    expect(r.channelId).toBe(f.general.id);
    expect(r.note).toBe("ligar pro jurídico");
    expect(r.doneAt).toBeNull();
    expect(new Date(r.remindAt).toISOString()).toBe(at.toISOString());

    const jobs = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.kind, "reminder.due"), eq(schema.outbox.orgId, f.org.id)));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toEqual({ reminderId: r.id });
    expect(jobs[0]!.nextAttemptAt.toISOString()).toBe(at.toISOString());

    const list = await listMessageReminders(f.db, f.owner.id, f.org.id);
    expect(list.map((x) => x.id)).toEqual([r.id]);
  });

  test("re-reminding the same message moves the time instead of duplicating", async () => {
    f = await setup();
    const msg = await say();
    const first = await remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, msg.id, inAnHour());
    const later = new Date(Date.now() + 2 * HOUR);
    const second = await remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, msg.id, later);

    expect(second.id).toBe(first.id);
    expect(new Date(second.remindAt).toISOString()).toBe(later.toISOString());
    const rows = await f.db.select().from(schema.messageReminders);
    expect(rows).toHaveLength(1);
    // The first job stays (harmless: it wakes early and does nothing); the second carries the new time.
    const jobs = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "reminder.due"));
    expect(jobs.length).toBeGreaterThanOrEqual(2);
  });

  test("refuses a past time, a missing message and a message of another channel", async () => {
    f = await setup();
    const msg = await say();
    await expect(
      remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, msg.id, new Date(Date.now() - 1000)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, crypto.randomUUID(), inAnHour()),
    ).rejects.toBeInstanceOf(NotFoundError);

    // The message lives in #general: naming another channel is a 404, not a reminder there.
    const other = await createChannel(f.db, f.owner.id, f.org.id, { name: "outro" });
    await expect(
      remindAboutMessage(f.db, f.owner.id, f.org.id, other.id, msg.id, inAnHour()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a person only sees and cancels their own reminders, inside their org", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    await addChannelMember(f.db, f.owner.id, f.org.id, f.general.id, { userId: bia.id });
    const msg = await say();
    const r = await remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, msg.id, inAnHour());

    expect(await listMessageReminders(f.db, bia.id, f.org.id)).toHaveLength(0);
    await cancelMessageReminder(f.db, bia.id, f.org.id, r.id); // not theirs: no-op
    expect(await listMessageReminders(f.db, f.owner.id, f.org.id)).toHaveLength(1);

    // Another org id sees and touches nothing.
    const foreignOrg = crypto.randomUUID();
    expect(await listMessageReminders(f.db, f.owner.id, foreignOrg)).toHaveLength(0);
    await cancelMessageReminder(f.db, f.owner.id, foreignOrg, r.id);
    expect(await listMessageReminders(f.db, f.owner.id, f.org.id)).toHaveLength(1);

    await cancelMessageReminder(f.db, f.owner.id, f.org.id, r.id);
    expect(await listMessageReminders(f.db, f.owner.id, f.org.id)).toHaveLength(0);
    await cancelMessageReminder(f.db, f.owner.id, f.org.id, r.id); // again: harmless
  });

  test("due fires once: stamps doneAt and notifies with the snippet and the note", async () => {
    f = await setup();
    const msg = await say("o relatório trimestral sai sexta");
    const r = await remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, msg.id, inAnHour(), "pedir números");

    // Before the time: nothing happens.
    await messageReminderDue({ db: f.db, pubsub: f.pubsub }, { reminderId: r.id });
    expect(await listMessageReminders(f.db, f.owner.id, f.org.id)).toHaveLength(1);

    // At the time: done + one notification that opens the message.
    const fired = new Date(Date.now() + 2 * HOUR);
    await f.db.update(schema.messageReminders).set({ remindAt: fired }).where(eq(schema.messageReminders.id, r.id));
    await messageReminderDue(
      { db: f.db, pubsub: f.pubsub, now: () => new Date(fired.getTime() + 1000) },
      { reminderId: r.id },
    );

    const done = await listMessageReminders(f.db, f.owner.id, f.org.id, true);
    expect(done.map((x) => x.id)).toEqual([r.id]);
    expect(done[0]!.doneAt).not.toBeNull();

    const { items } = await inbox(f.owner.id);
    const note = items.find((n) => n.kind === "reminder");
    expect(note).toBeDefined();
    expect(note!.source.channelId).toBe(f.general.id);
    expect(note!.source.messageId).toBe(msg.id);
    expect(note!.latest.text ?? "").toContain("relatório trimestral");

    // Firing again (a duplicate job) is a no-op.
    await messageReminderDue(
      { db: f.db, pubsub: f.pubsub, now: () => new Date(fired.getTime() + 2000) },
      { reminderId: r.id },
    );
    const { items: again } = await inbox(f.owner.id);
    expect(again.filter((n) => n.kind === "reminder")).toHaveLength(1);
  });

  test("a reminder rescheduled later ignores the earlier job", async () => {
    f = await setup();
    const msg = await say();
    const r = await remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, msg.id, inAnHour());
    const later = new Date(Date.now() + 3 * HOUR);
    await remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, msg.id, later);

    // The first job wakes "on time" for the old instant: the row is still pending and later.
    await messageReminderDue(
      { db: f.db, pubsub: f.pubsub, now: () => new Date(Date.now() + HOUR + 1000) },
      { reminderId: r.id },
    );
    expect(await listMessageReminders(f.db, f.owner.id, f.org.id)).toHaveLength(1);
    const { items } = await inbox(f.owner.id);
    expect(items.filter((n) => n.kind === "reminder")).toHaveLength(0);
  });

  test("end to end: the outbox job fires the reminder through the worker", async () => {
    f = await setup();
    const msg = await say("ligar pro fornecedor");
    const at = new Date(Date.now() + 40_000);
    const r = await remindAboutMessage(f.db, f.owner.id, f.org.id, f.general.id, msg.id, at);

    // Move both clocks to the past so the worker claims the job now.
    const past = new Date(Date.now() - 1000);
    await f.db.update(schema.messageReminders).set({ remindAt: past }).where(eq(schema.messageReminders.id, r.id));
    await f.db.update(schema.outbox).set({ nextAttemptAt: past }).where(eq(schema.outbox.kind, "reminder.due"));

    await drainOutbox(f.db, f.handlers);

    const done = await listMessageReminders(f.db, f.owner.id, f.org.id, true);
    expect(done.map((x) => x.id)).toEqual([r.id]);
    const { items } = await inbox(f.owner.id);
    expect(items.filter((n) => n.kind === "reminder")).toHaveLength(1);
  });
});
