import { afterEach, beforeEach, expect, test } from "bun:test";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({ reply: () => ({ chunks: ["done"], usage: { inputTokens: 10, outputTokens: 5 } }) });
});
afterEach(() => t.close());

test("schedule a message: create, list, cancel — own only", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);

  const at = new Date(Date.now() + 3600_000).toISOString();
  const created = await api(`/channels/${channelId}/scheduled-messages`, {
    json: { body: "bom dia, time!", sendAt: at, clientId: "draft-1" },
  });
  expect(created.status).toBe(200);
  const scheduled = (await created.json()) as {
    id: string;
    body: string;
    sendAt: string;
    sentAt: string | null;
  };
  expect(scheduled.body).toBe("bom dia, time!");
  expect(scheduled.sentAt).toBeNull();
  expect(new Date(scheduled.sendAt).toISOString()).toBe(at);

  // A resend with the same clientId moves the send, not a second row.
  const later = new Date(Date.now() + 7200_000).toISOString();
  const again = await api(`/channels/${channelId}/scheduled-messages`, {
    json: { body: "bom dia, time! v2", sendAt: later, clientId: "draft-1" },
  });
  expect(again.status).toBe(200);
  const moved = (await again.json()) as { id: string; sendAt: string };
  expect(moved.id).toBe(scheduled.id);
  expect(new Date(moved.sendAt).toISOString()).toBe(later);

  // A second member sees none of it and cannot cancel it.
  const member = await joinByInvitation(t, owner, orgId, "bia@example.com");
  const memberApi = (path: string, init?: Parameters<typeof member>[1]) =>
    member(`/api/app/organizations/${orgId}${path}`, init);
  const theirs = (await (await memberApi("/scheduled-messages")).json()) as { messages: unknown[] };
  expect(theirs.messages).toHaveLength(0);

  const mine = (await (await api("/scheduled-messages")).json()) as { messages: (typeof scheduled)[] };
  expect(mine.messages.map((m) => m.id)).toEqual([scheduled.id]);

  const cancelled = await api(`/scheduled-messages/${scheduled.id}`, { method: "DELETE" });
  expect(cancelled.status).toBe(204);
  const after = (await (await api("/scheduled-messages")).json()) as { messages: unknown[] };
  expect(after.messages).toHaveLength(0);
});

test("schedule validation: past sendAt, empty body, unknown channel", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);

  const past = await api(`/channels/${channelId}/scheduled-messages`, {
    json: { body: "oi", sendAt: new Date(Date.now() - 1000).toISOString() },
  });
  expect(past.status).toBe(400);

  const empty = await api(`/channels/${channelId}/scheduled-messages`, {
    json: { body: "   ", sendAt: new Date(Date.now() + 3600_000).toISOString() },
  });
  expect(empty.status).toBe(400);

  const missing = await api(`/channels/${crypto.randomUUID()}/scheduled-messages`, {
    json: { body: "oi", sendAt: new Date(Date.now() + 3600_000).toISOString() },
  });
  expect(missing.status).toBe(404);
});
