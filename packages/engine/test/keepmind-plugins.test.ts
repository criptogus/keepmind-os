import { afterEach, expect, test } from "bun:test";
import { and, eq, schema } from "@agenteschat/db";
import {
  createPluginToolSource,
  createToolGateway,
  decideApproval,
  grantScopes,
  insertMessage,
  type ToolContext,
  updateAgent,
} from "../src";
import { pluginManifest, speechCrm } from "../src/plugins/manifest";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});
const source = createPluginToolSource();
async function context(userId = f.owner.id): Promise<ToolContext> {
  const msg = await insertMessage(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    author: { type: "person", userId },
    body: "Crie um CRM de palestras para mim.",
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
  if (!run) throw new Error("Missing run");
  return {
    db: f.db,
    orgId: f.org.id,
    agentId: f.agent.id,
    runId: run.id,
    channelId: f.general.id,
    threadRootId: msg.id,
    triggerMessageId: msg.id,
  };
}
async function call(ctx: ToolContext, name: string, input: Record<string, unknown>) {
  const tool = (await source.tools(ctx)).find((t) => t.name === name);
  if (!tool) throw new Error(`Missing ${name}`);
  return tool.execute(input, ctx);
}
async function activate(ctx: ToolContext) {
  const draft = await call(ctx, "propose_plugin", { template: "speech_crm" });
  expect(draft.isError).toBeUndefined();
  const saved = JSON.parse(draft.content);
  const args = { id: saved.id, digest: saved.digest, revision: saved.revision, agentIds: [ctx.agentId] };
  const active = await call({ ...ctx, approved: true }, "activate_plugin", args);
  expect(active.isError).toBeUndefined();
  return args;
}

test("CRM draft, explicit activation, records, idempotency, revisions and disable preserve data", async () => {
  f = await setup();
  const ctx = await context();
  const draft = JSON.parse((await call(ctx, "propose_plugin", { template: "speech_crm" })).content);
  expect((await source.tools(ctx)).some((t) => t.name.startsWith("plugin_crm"))).toBe(false);
  const args = { id: draft.id, digest: draft.digest, revision: draft.revision, agentIds: [ctx.agentId] };
  expect((await call(ctx, "activate_plugin", args)).isError).toBe(true);
  await activate(ctx);
  const create = { requestId: "lead-1", values: { nome: "Acme fictícia", etapa: "Prospecção" } };
  const first = JSON.parse((await call(ctx, "plugin_crm_palestras_cadastrar", create)).content);
  const again = JSON.parse((await call(ctx, "plugin_crm_palestras_cadastrar", create)).content);
  expect(again.id).toBe(first.id);
  expect((await call(ctx, "plugin_crm_palestras_cadastrar", { ...create, values: { nome: "Changed" } })).isError).toBe(
    true,
  );
  const updated = JSON.parse(
    (await call(ctx, "plugin_crm_palestras_atualizar", { id: first.id, revision: 1, values: { etapa: "Proposta" } }))
      .content,
  );
  expect(updated.revision).toBe(2);
  expect(
    (await call(ctx, "plugin_crm_palestras_atualizar", { id: first.id, revision: 1, values: { etapa: "Old" } }))
      .isError,
  ).toBe(true);
  const found = JSON.parse((await call(ctx, "plugin_crm_palestras_buscar", { query: "ficticia", limit: 1 })).content);
  expect(found.total).toBe(1);
  expect(found.records[0].values.etapa).toBe("Proposta");
  const held = (await source.tools(ctx)).find((t) => t.name === "plugin_crm_palestras_buscar");
  await call(ctx, "disable_plugin", { id: draft.id });
  expect((await held?.execute({}, ctx))?.isError).toBe(true);
  expect((await call({ ...ctx, approved: true }, "activate_plugin", args)).isError).toBe(true);
  const [row] = await f.db
    .select()
    .from(schema.workspacePlugins)
    .where(and(eq(schema.workspacePlugins.orgId, ctx.orgId), eq(schema.workspacePlugins.slug, draft.id)));
  expect(row?.records).toHaveLength(1);
  expect(row?.enabled).toBe(false);
  await activate(ctx);
  const freshSource = createPluginToolSource();
  const restored = (await freshSource.tools(ctx)).find((t) => t.name === "plugin_crm_palestras_buscar");
  expect(JSON.parse((await restored?.execute({}, ctx))?.content ?? "{}").records[0].revision).toBe(2);
});

test("manager, tenant, assignment and input boundaries are enforced", async () => {
  f = await setup();
  const ctx = await context();
  const member = await addMember(f.db, f.org.id, "member", "member");
  expect((await call(await context(member.id), "propose_plugin", { template: "speech_crm" })).isError).toBe(true);
  await activate(ctx);
  const before = await source.tools(ctx);
  expect(
    (await source.tools({ ...ctx, orgId: crypto.randomUUID() })).some((t) => t.name.startsWith("plugin_crm")),
  ).toBe(false);
  const held = before.find((t) => t.name === "plugin_crm_palestras_buscar");
  expect((await held?.execute({}, { ...ctx, orgId: crypto.randomUUID() }))?.isError).toBe(true);
  expect(
    (await source.tools({ ...ctx, agentId: crypto.randomUUID() })).some((t) => t.name.startsWith("plugin_crm")),
  ).toBe(false);
  expect((await held?.execute({}, { ...ctx, agentId: crypto.randomUUID() }))?.isError).toBe(true);
  expect((await call(ctx, "plugin_crm_palestras_cadastrar", { requestId: "bad", values: { nome: 12 } })).isError).toBe(
    true,
  );
  expect(
    (await call(ctx, "plugin_crm_palestras_cadastrar", { requestId: "bad", values: { nome: "A", unknown: true } }))
      .isError,
  ).toBe(true);
  expect(pluginManifest.safeParse({ ...speechCrm, fields: [...speechCrm.fields, speechCrm.fields[0]] }).success).toBe(
    false,
  );
  expect(pluginManifest.safeParse({ ...speechCrm, code: "arbitrary code" }).success).toBe(false);
});

test("gateway shows a concrete approval and rechecks stale drafts before execution", async () => {
  f = await setup();
  const ctx = await context();
  await grantScopes(f.db, f.org.id, f.agent.id, [{ scope: "setup:write", connectionId: null }], f.owner.id);
  const draft = JSON.parse((await call(ctx, "propose_plugin", { template: "speech_crm" })).content);
  const gateway = createToolGateway({ sources: [source] });
  const input = {
    id: draft.id,
    digest: draft.digest,
    revision: draft.revision,
    agentIds: [ctx.agentId],
    why: "Criar o CRM solicitado, somente neste workspace.",
  };
  const pending = await gateway.invoke(ctx, { name: "activate_plugin", input, toolUseId: "activate-1" });
  expect(pending.type).toBe("approval");
  if (pending.type !== "approval") throw new Error(JSON.stringify(pending));
  expect(pending.approval.title).toContain("CRM de palestras");
  expect(pending.approval.detail).toContain("Nome");
  expect(pending.approval.detail).toContain(f.agent.name);
  await call(ctx, "disable_plugin", { id: draft.id });
  const result = await gateway.executeApproved(ctx, { ...pending.approval, status: "approved" });
  expect(result.isError).toBe(true);
  expect(result.content).toContain("changed");
});

test("activation requires a one-time manager approval even for an agent that never asks", async () => {
  f = await setup();
  const ctx = await context();
  await grantScopes(f.db, f.org.id, f.agent.id, [{ scope: "setup:write", connectionId: null }], f.owner.id);
  await updateAgent(f.db, f.owner.id, f.org.id, f.agent.id, { approvalsLevel: "never" });
  const draft = JSON.parse((await call(ctx, "propose_plugin", { template: "speech_crm" })).content);
  const gateway = createToolGateway({ sources: [source] });
  const pending = await gateway.invoke(ctx, {
    name: "activate_plugin",
    input: {
      id: draft.id,
      digest: draft.digest,
      revision: draft.revision,
      agentIds: [ctx.agentId],
      why: "Liberar o CRM solicitado para este agente.",
    },
    toolUseId: "activate-never",
  });
  expect(pending.type).toBe("approval");
  if (pending.type !== "approval") throw new Error(JSON.stringify(pending));
  expect(pending.approval.approveAlways).toBeNull();
  await decideApproval({ db: f.db, pubsub: f.pubsub }, f.owner.id, ctx.orgId, pending.approval.id, {
    decision: "approve",
  });
  const [approved] = await f.db.select().from(schema.approvals).where(eq(schema.approvals.id, pending.approval.id));
  if (!approved) throw new Error("No approval");
  const result = await gateway.executeApproved(ctx, approved);
  expect(result.isError).not.toBe(true);
  expect(JSON.parse(result.content).enabled).toBe(true);
  expect((await source.tools(ctx)).some((t) => t.name === "plugin_crm_palestras_cadastrar")).toBe(true);
});

test("concurrent retries create once and concurrent edits cannot lose an update", async () => {
  f = await setup();
  const ctx = await context();
  await activate(ctx);
  const input = { requestId: "concurrent", values: { nome: "Synthetic" } };
  const results = await Promise.all([
    call(ctx, "plugin_crm_palestras_cadastrar", input),
    call(ctx, "plugin_crm_palestras_cadastrar", input),
  ]);
  const ids = results.map((r) => JSON.parse(r.content).id);
  expect(ids[0]).toBe(ids[1]);
  const edits = await Promise.all(
    ["A", "B"].map((etapa) =>
      call(ctx, "plugin_crm_palestras_atualizar", { id: ids[0], revision: 1, values: { etapa } }),
    ),
  );
  expect(edits.filter((r) => r.isError)).toHaveLength(1);
  const found = JSON.parse((await call(ctx, "plugin_crm_palestras_buscar", {})).content);
  expect(found.total).toBe(1);
  expect(found.records[0].revision).toBe(2);
});

test("chat can define a custom plugin and typed actions beyond the CRM template", async () => {
  f = await setup();
  const ctx = await context();
  const manifest = {
    id: "estoque",
    name: "Estoque",
    description: "Controle interno fictício",
    version: 1,
    kind: "records",
    fields: [
      { key: "produto", label: "Produto", type: "string", required: true },
      { key: "quantidade", label: "Quantidade", type: "number", required: true },
      { key: "ativo", label: "Ativo", type: "boolean", required: false },
    ],
    actions: [
      { name: "registrar", description: "Registrar produto", operation: "create" },
      { name: "consultar", description: "Consultar estoque", operation: "list" },
    ],
  };
  const proposal = await call(ctx, "propose_plugin", { manifest });
  expect(proposal.isError).not.toBe(true);
  const draft = JSON.parse(proposal.content);
  expect(
    (
      await call({ ...ctx, approved: true }, "activate_plugin", {
        id: draft.id,
        digest: draft.digest,
        revision: draft.revision,
        agentIds: [ctx.agentId],
      })
    ).isError,
  ).not.toBe(true);
  const input = { requestId: "stock-1", values: { produto: "Livro", quantidade: 3, ativo: false } };
  expect((await call(ctx, "plugin_estoque_registrar", input)).isError).not.toBe(true);
  const records = JSON.parse((await call(ctx, "plugin_estoque_consultar", {})).content).records;
  expect(records[0].values).toEqual(input.values);
  expect(
    (
      await call(ctx, "plugin_estoque_registrar", {
        requestId: "stock-2",
        values: { produto: "Outro", quantidade: "three" },
      })
    ).isError,
  ).toBe(true);
  await call(ctx, "disable_plugin", { id: draft.id });
  expect(
    (await call(ctx, "propose_plugin", { manifest: { ...manifest, fields: manifest.fields.slice(0, 1) } })).isError,
  ).toBe(true);
});

test("one-time approval grants bounded background record operations and revocation is immediate", async () => {
  f = await setup();
  const ctx = await context();
  const draft = JSON.parse((await call(ctx, "propose_plugin", { template: "autonomous_crm" })).content);
  const activation = { id: draft.id, digest: draft.digest, revision: draft.revision, agentIds: [ctx.agentId] };
  expect((await call(ctx, "activate_plugin", activation)).isError).toBe(true);
  expect((await call({ ...ctx, approved: true }, "activate_plugin", activation)).isError).toBeUndefined();
  if (!ctx.runId) throw new Error("Expected persisted run");
  await f.db.update(schema.agentRuns).set({ background: true }).where(eq(schema.agentRuns.id, ctx.runId));
  const unattended = { ...ctx, background: true };
  await grantScopes(
    f.db,
    f.org.id,
    f.agent.id,
    [
      { scope: "memory:write", connectionId: null },
      { scope: "context:read", connectionId: null },
    ],
    f.owner.id,
  );
  const gateway = createToolGateway({ sources: [source] });
  const automatic = await gateway.invoke(unattended, {
    name: "plugin_crm_relacionamentos_cadastrar",
    input: { requestId: "gateway-1", values: { nome: "Background lead" } },
    toolUseId: "background-crm",
  });
  expect(automatic.type).toBe("result");
  if (automatic.type !== "result") throw new Error(JSON.stringify(automatic));
  expect(automatic.output.isError).toBeUndefined();
  const first = JSON.parse(
    (
      await call(unattended, "plugin_crm_relacionamentos_cadastrar", {
        requestId: "routine-1",
        values: { nome: "Acme", proximo_contato: "2020-01-01", fonte: "meeting:123" },
      })
    ).content,
  );
  expect(first.revision).toBe(1);
  expect((await call(unattended, "propose_plugin", { template: "autonomous_crm" })).isError).toBe(true);
  const result = await call(unattended, "plugin_crm_relacionamentos_atualizar", {
    id: first.id,
    revision: 1,
    values: { notas: "Confirmed in meeting:123" },
  });
  const updated = JSON.parse(result.content);
  expect(updated.history[0].values.nome).toBe("Acme");
  expect(updated.history[0].runId).toBe(ctx.runId);
  const review = JSON.parse((await call(unattended, "plugin_crm_relacionamentos_priorizar", {})).content);
  expect(review.items[0].reasons).toContain("overdue");
  const filtered = JSON.parse(
    (await call(unattended, "plugin_crm_relacionamentos_priorizar", { query: "acme", limit: 1 })).content,
  );
  expect(filtered.items.map((item: { id: string }) => item.id)).toEqual([first.id]);
  expect(filtered.matchingAttentionCount).toBe(1);
  expect(filtered.nextOffset).toBeNull();
  const interaction = {
    id: first.id,
    revision: 2,
    requestId: "meeting-123",
    note: "Customer requested a proposal",
    source: "meeting:123",
    occurredAt: "2026-11-14T15:00:00-03:00",
  };
  const logged = JSON.parse(
    (await call(unattended, "plugin_crm_relacionamentos_registrar_interacao", interaction)).content,
  );
  expect(logged.interactions).toHaveLength(1);
  expect(logged.interactions[0].runId).toBe(ctx.runId);
  const retry = JSON.parse(
    (await call(unattended, "plugin_crm_relacionamentos_registrar_interacao", interaction)).content,
  );
  expect(retry.revision).toBe(logged.revision);
  expect(
    (await call(unattended, "plugin_crm_relacionamentos_registrar_interacao", { ...interaction, note: "Changed" }))
      .isError,
  ).toBe(true);
  const held = (await source.tools(unattended)).find((t) => t.name === "plugin_crm_relacionamentos_buscar");
  if (!held) throw new Error("Expected assigned CRM tool");
  expect((await held.execute({}, { ...unattended, runId: crypto.randomUUID() })).isError).toBe(true);
  const admin = await context();
  await call(admin, "disable_plugin", { id: draft.id });
  expect((await held.execute({}, unattended)).isError).toBe(true);
});
