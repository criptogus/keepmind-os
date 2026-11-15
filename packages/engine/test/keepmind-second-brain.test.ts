import { afterEach, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  createContextToolSource,
  createSecondBrainToolSource,
  createToolGateway,
  insertMessage,
  type ToolContext,
} from "../src";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

test("Second Brain retains native scopes and persists, corrects and archives a sourced memory", async () => {
  f = await setup();
  const msg = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "person", userId: f.owner.id },
    body: "Lembre que a palestra fictícia tem 45 minutos. Depois corrija para 60 minutos e arquive a nota de teste.",
  });
  const [run] = await f.db
    .insert(schema.agentRuns)
    .values({
      orgId: f.org.id,
      agentId: f.agent.id,
      channelId: f.general.id,
      triggerMessageId: msg.id,
      threadRootId: msg.id,
      trigger: "mention",
      hop: 1,
      status: "done",
    })
    .returning();
  if (!run) throw new Error("No run");
  const ctx: ToolContext = {
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: run.id,
    channelId: f.general.id,
    threadRootId: msg.id,
    triggerMessageId: msg.id,
  };
  const source = createSecondBrainToolSource(f.context);
  const native = await createContextToolSource(f.context).tools(ctx);
  const migrated = await source.tools(ctx);
  expect(migrated.map((t) => [t.name, t.scope, t.inputSchema])).toEqual(
    native.map((t) => [t.name, t.scope, t.inputSchema]),
  );
  const gateway = createToolGateway({ sources: [source] });
  const call = async (name: string, input: Record<string, unknown>) => {
    const out = await gateway.invoke(ctx, { name, input, toolUseId: crypto.randomUUID() });
    if (out.type !== "result") throw new Error(JSON.stringify(out));
    expect(out.output.isError).not.toBe(true);
    return out.output;
  };
  const saved = await call("remember", {
    content: "A palestra fictícia tem 45 minutos.",
    kind: "fact",
    basis: "person_said",
  });
  expect(saved.data?.memoryStore).toBe("workspace");
  let [item] = await f.db.select().from(schema.contextItems).where(eq(schema.contextItems.orgId, ctx.orgId));
  expect(item?.content).toContain("45 minutos");
  if (!item) throw new Error("Memory was not saved");
  // A fresh source instance reads persistent data, not an in-memory copy.
  const search = (await createSecondBrainToolSource(f.context).tools(ctx)).find((t) => t.name === "search_context");
  const found = await search?.execute({ query: "palestra fictícia", kinds: ["context_item"] }, ctx);
  expect(found?.content).toContain("45 minutos");
  await call("update_memory", { item_id: item.id, content: "A palestra fictícia tem 60 minutos." });
  [item] = await f.db
    .select()
    .from(schema.contextItems)
    .where(and(eq(schema.contextItems.orgId, ctx.orgId), eq(schema.contextItems.status, "active")));
  expect(item?.content).toContain("60 minutos");
  if (!item) throw new Error("No memory");
  await call("forget", { item_id: item.id });
  const [archived] = await f.db.select().from(schema.contextItems).where(eq(schema.contextItems.id, item.id));
  expect(archived?.status).toBe("archived");
  expect(archived?.content).toContain("60 minutos");
});
