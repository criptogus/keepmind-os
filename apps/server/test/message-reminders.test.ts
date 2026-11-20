import { afterEach, beforeEach, expect, test } from "bun:test";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({ reply: () => ({ chunks: ["done"], usage: { inputTokens: 10, outputTokens: 5 } }) });
});
afterEach(() => t.close());

test("remind me about a message: set, list, cancel — own only", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);

  const msg = (await (
    await api(`/channels/${channelId}/messages`, { json: { body: "revisar o contrato" } })
  ).json()) as { id: string };
  const at = new Date(Date.now() + 3600_000).toISOString();

  const created = await api(`/channels/${channelId}/messages/${msg.id}/reminder`, {
    json: { remindAt: at, note: "ligar pro jurídico" },
  });
  expect(created.status).toBe(200);
  const reminder = (await created.json()) as {
    id: string;
    messageId: string;
    remindAt: string;
    note: string | null;
    doneAt: string | null;
  };
  expect(reminder.messageId).toBe(msg.id);
  expect(reminder.note).toBe("ligar pro jurídico");
  expect(reminder.doneAt).toBeNull();

  // A second member sees none of it and cannot cancel it.
  const member = await joinByInvitation(t, owner, orgId, "bia@example.com");
  const memberApi = (path: string, init?: Parameters<typeof member>[1]) =>
    member(`/api/app/organizations/${orgId}${path}`, init);
  const theirs = (await (await memberApi("/message-reminders")).json()) as { reminders: unknown[] };
  expect(theirs.reminders).toHaveLength(0);
  const steal = await memberApi(`/message-reminders/${reminder.id}`, { method: "DELETE" });
  expect(steal.status).toBe(204); // no-op, not an error

  const mine = (await (await api("/message-reminders")).json()) as { reminders: typeof reminder[] };
  expect(mine.reminders.map((r) => r.id)).toEqual([reminder.id]);

  const cancelled = await api(`/message-reminders/${reminder.id}`, { method: "DELETE" });
  expect(cancelled.status).toBe(204);
  const after = (await (await api("/message-reminders")).json()) as { reminders: unknown[] };
  expect(after.reminders).toHaveLength(0);
});

test("reminder validation: past time, unknown message, unreadable channel", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);

  const msg = (await (
    await api(`/channels/${channelId}/messages`, { json: { body: "oi" } })
  ).json()) as { id: string };

  const past = await api(`/channels/${channelId}/messages/${msg.id}/reminder`, {
    json: { remindAt: new Date(Date.now() - 60_000).toISOString() },
  });
  expect(past.status).toBe(400);

  const missing = await api(`/channels/${channelId}/messages/${crypto.randomUUID()}/reminder`, {
    json: { remindAt: new Date(Date.now() + 3600_000).toISOString() },
  });
  expect(missing.status).toBe(404);

  const foreign = await api(`/channels/${crypto.randomUUID()}/messages/${msg.id}/reminder`, {
    json: { remindAt: new Date(Date.now() + 3600_000).toISOString() },
  });
  expect(foreign.status).toBe(404);
});
