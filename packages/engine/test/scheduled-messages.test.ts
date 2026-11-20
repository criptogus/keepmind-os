import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, schema } from "@keepmind/db";
import {
  addChannelMember,
  cancelScheduledMessage,
  drainOutbox,
  listMessages,
  listScheduledMessages,
  NotFoundError,
  scheduledMessageSend,
  scheduleMessage,
  ValidationError,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const MIN = 60_000;
const soon = () => new Date(Date.now() + MIN);

describe("scheduled messages", () => {
  test("scheduling stores the draft, queues scheduled.send and lists it pending", async () => {
    f = await setup();
    const at = soon();
    const s = await scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, {
      body: "bom dia, time!",
      sendAt: at,
      clientId: "draft-1",
    });

    expect(s.body).toBe("bom dia, time!");
    expect(s.sentAt).toBeNull();
    expect(new Date(s.sendAt).toISOString()).toBe(at.toISOString());

    const jobs = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.kind, "scheduled.send"), eq(schema.outbox.orgId, f.org.id)));
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job?.payload).toMatchObject({ scheduledMessageId: s.id, sendAt: s.sendAt });
    expect(job?.nextAttemptAt.toISOString()).toBe(at.toISOString());

    const pending = await listScheduledMessages(f.db, f.owner.id, f.org.id);
    expect(pending.map((x) => x.id)).toEqual([s.id]);
  });

  test("the same clientId moves the send instead of queueing a second one", async () => {
    f = await setup();
    const first = await scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, {
      body: "v1",
      sendAt: soon(),
      clientId: "draft-1",
    });
    const later = new Date(Date.now() + 2 * 60 * MIN);
    const second = await scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, {
      body: "v2",
      sendAt: later,
      clientId: "draft-1",
    });

    expect(second.id).toBe(first.id);
    expect(second.body).toBe("v2");
    const rows = await f.db.select().from(schema.scheduledMessages);
    expect(rows).toHaveLength(1);
  });

  test("refuses a past sendAt, an empty draft and a channel the person can't post in", async () => {
    f = await setup();
    await expect(
      scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, {
        body: "oi",
        sendAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, { body: "   ", sendAt: soon() }),
    ).rejects.toBeInstanceOf(ValidationError);

    // A channel that doesn't exist is a 404, like a live post.
    await expect(
      scheduleMessage(f.db, f.owner.id, f.org.id, crypto.randomUUID(), { body: "oi", sendAt: soon() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a person only lists and cancels their own sends", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    await addChannelMember(f.db, f.owner.id, f.org.id, f.general.id, { userId: bia.id });
    const s = await scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, {
      body: "só pra mim",
      sendAt: soon(),
    });

    expect(await listScheduledMessages(f.db, bia.id, f.org.id)).toHaveLength(0);
    await cancelScheduledMessage(f.db, bia.id, f.org.id, s.id); // not theirs: no-op
    expect(await listScheduledMessages(f.db, f.owner.id, f.org.id)).toHaveLength(1);

    await cancelScheduledMessage(f.db, f.owner.id, f.org.id, s.id);
    expect(await listScheduledMessages(f.db, f.owner.id, f.org.id)).toHaveLength(0);
  });

  test("due posts the message as its person and stamps sentAt", async () => {
    f = await setup();
    const at = new Date(Date.now() + 2 * MIN);
    const s = await scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, {
      body: "mensagem agendada chegou",
      sendAt: at,
    });

    // Early wake (a stale or premature job): nothing posts.
    await scheduledMessageSend({ db: f.db, pubsub: f.pubsub }, s.id, s.sendAt);
    expect((await listScheduledMessages(f.db, f.owner.id, f.org.id)).length).toBe(1);

    const after = new Date(at.getTime() + 1000);
    await scheduledMessageSend({ db: f.db, pubsub: f.pubsub, now: () => after }, s.id, s.sendAt);

    const sent = await listScheduledMessages(f.db, f.owner.id, f.org.id, true);
    expect(sent.map((x) => x.id)).toEqual([s.id]);
    const sentMessageId = sent[0]?.sentMessageId;
    expect(sentMessageId).not.toBeNull();

    const messages = await listMessages(f.db, f.owner.id, f.org.id, f.general.id);
    const posted = messages.find((m) => m.id === sentMessageId);
    expect(posted?.body).toBe("mensagem agendada chegou");
    expect(posted?.author.type).toBe("person");

    // A retried job does not post twice.
    const before = messages.length;
    await scheduledMessageSend({ db: f.db, pubsub: f.pubsub, now: () => after }, s.id, s.sendAt);
    expect((await listMessages(f.db, f.owner.id, f.org.id, f.general.id)).length).toBe(before);
  });

  test("a send rescheduled later ignores the earlier job", async () => {
    f = await setup();
    const at = new Date(Date.now() + MIN);
    const s = await scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, {
      body: "moveu",
      sendAt: at,
      clientId: "draft-9",
    });
    const later = new Date(at.getTime() + 60 * MIN);
    await scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, {
      body: "moveu",
      sendAt: later,
      clientId: "draft-9",
    });

    // The first job wakes at the old time with the old sendAt: the row's sendAt moved, so it does nothing.
    await scheduledMessageSend(
      { db: f.db, pubsub: f.pubsub, now: () => new Date(at.getTime() + 1000) },
      s.id,
      at.toISOString(),
    );
    const pending = await listScheduledMessages(f.db, f.owner.id, f.org.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sentAt).toBeNull();
  });

  test("end to end: the outbox job posts the scheduled message", async () => {
    f = await setup();
    const at = new Date(Date.now() + MIN);
    const s = await scheduleMessage(f.db, f.owner.id, f.org.id, f.general.id, {
      body: "via fila",
      sendAt: at,
    });
    // Pull the job's run forward and drain: it posts as the person.
    await f.db
      .update(schema.outbox)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(schema.outbox.kind, "scheduled.send"));
    await drainOutbox(f.db, f.handlers);

    const sent = await listScheduledMessages(f.db, f.owner.id, f.org.id, true);
    expect(sent.map((x) => x.id)).toEqual([s.id]);
  });
});
