import { and, eq, isNull, schema, sql } from "@agenteschat/db";
import { z } from "zod";
import { recordAudit } from "../audit";
import { looksLikeSecret } from "../context/items";
import { sha256 } from "../crypto";
import { requirePermission } from "../organizations";
import { personBehindCall } from "../requester";
import type { ToolContext, ToolDefinition, ToolSource } from "../tools/types";
import { type PluginManifest, pluginManifest, speechCrm } from "./manifest";

const { workspacePlugins, agents } = schema;
const ref = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/) }).strict();
const activation = ref.extend({
  digest: z.string().length(64),
  revision: z.number().int().positive(),
  agentIds: z.array(z.string().uuid()).min(1).max(50),
});
const fingerprint = (value: unknown): string => sha256(JSON.stringify(value));
const where = (ctx: ToolContext, slug: string) =>
  and(eq(workspacePlugins.orgId, ctx.orgId), eq(workspacePlugins.slug, slug));
const nameOf = (m: PluginManifest, action: string) => `plugin_${m.id}_${action}`;
const json = (value: unknown) => ({ content: JSON.stringify(value) });

/** A plugin never impersonates its installer: each call still acts for a current workspace manager. */
async function manager(ctx: ToolContext) {
  const person = await personBehindCall(ctx);
  if (!person) throw new Error("A person must request this action in the chat.");
  await requirePermission(ctx.db, person, ctx.orgId, "manage_agents");
  return person;
}
function protectedTool(tool: ToolDefinition): ToolDefinition {
  const execute = tool.execute;
  return {
    ...tool,
    async execute(input, ctx) {
      try {
        await manager(ctx);
        return await execute(input, ctx);
      } catch (error) {
        return { content: error instanceof Error ? error.message : "Plugin action failed", isError: true };
      }
    },
  };
}
const audit = (ctx: ToolContext, id: string, action: string) =>
  recordAudit(ctx.db, {
    orgId: ctx.orgId,
    actor: { type: "agent", id: ctx.agentId },
    action,
    target: { type: "plugin", id },
  });
const view = (row: typeof workspacePlugins.$inferSelect) => ({
  id: row.slug,
  manifest: row.manifest,
  digest: row.digest,
  enabled: row.enabled,
  agentIds: row.agentIds,
  recordCount: row.records.length,
  revision: row.revision,
});

/** Declarative records only: no eval, SQL, process launch, outbound URL or embedded credentials. */
export function createPluginToolSource(): ToolSource {
  const management: ToolDefinition[] = [
    {
      name: "list_plugins",
      scope: "setup:write",
      description:
        "List this workspace's plugins and the ready speech CRM template. Use before creating a CRM or custom tools. For external MCP connectors use offer_connect_app; never ask for credentials in chat.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      looksOnly: () => true,
      async execute(_input, ctx) {
        const rows = await ctx.db.select().from(workspacePlugins).where(eq(workspacePlugins.orgId, ctx.orgId));
        return json({ plugins: rows.map(view), templates: { speech_crm: speechCrm } });
      },
    },
    {
      name: "propose_plugin",
      scope: "setup:write",
      description:
        "Prepare a persistent draft for a CRM/custom record plugin from the person's goal. Use template speech_crm, or supply a declarative records manifest with fields and list/create/update actions. Infer reasonable fields; ask only missing consequential choices. Creates no running tools and grants nobody access. Then activate_plugin with the returned digest and explicitly chosen agent IDs to show one approval. For MCP services use offer_connect_app instead.",
      inputSchema: {
        type: "object",
        properties: {
          template: { type: "string", enum: ["speech_crm"] },
          manifest: {
            type: "object",
            description:
              "version:1, kind:records, id lowercase slug, name, description, fields[{key,label,type:string|number|boolean,required}], actions[{name,description,operation:list|create|update}]",
          },
        },
        additionalProperties: false,
      },
      async execute(input, ctx) {
        if (input.template && input.manifest) throw new Error("Choose template or manifest, not both.");
        const manifest = pluginManifest.parse(input.template === "speech_crm" ? speechCrm : input.manifest);
        if (looksLikeSecret(JSON.stringify(manifest)))
          throw new Error("Keep credentials in the protected connector dialog, not in plugin definitions.");
        const digest = fingerprint(manifest);
        await ctx.db
          .insert(workspacePlugins)
          .values({ orgId: ctx.orgId, slug: manifest.id, manifest, digest })
          .onConflictDoNothing();
        const result = await ctx.db.transaction(async (tx) => {
          const [row] = await tx.select().from(workspacePlugins).where(where(ctx, manifest.id)).for("update");
          if (!row) throw new Error("Plugin unavailable");
          if (row.digest === digest) return view(row);
          if (row.enabled) throw new Error("Disable the plugin before revising its draft. Records remain saved.");
          const previous = pluginManifest.parse(row.manifest);
          if (row.records.length && JSON.stringify(previous.fields) !== JSON.stringify(manifest.fields))
            throw new Error("Existing records require the same fields. Create a new plugin for a different schema.");
          const [saved] = await tx
            .update(workspacePlugins)
            .set({ manifest, digest, agentIds: [], revision: row.revision + 1, updatedAt: new Date() })
            .where(where(ctx, manifest.id))
            .returning();
          if (!saved) throw new Error("Plugin unavailable");
          return view(saved);
        });
        await audit(ctx, manifest.id, "plugin.proposed");
        return json(result);
      },
    },
    {
      name: "activate_plugin",
      scope: "setup:write",
      sensitive: true,
      description:
        "Activate the exact saved plugin draft for the named agents after the person approves. Requires its current digest and revision. Does not send records externally. Approval lists the fields, actions and agents; tools become available through find_tools on the next turn. Never claim activation before success.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          digest: { type: "string" },
          revision: { type: "integer", minimum: 1 },
          agentIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 },
        },
        required: ["id", "digest", "revision", "agentIds"],
        additionalProperties: false,
      },
      describe: (input) => ({
        title: "Ativar plugin",
        detail: `Plugin: ${String(input.id)}. Agentes: ${(input.agentIds as string[]).join(", ")}. Dados ficam neste workspace.`,
      }),
      async checkCall(input, ctx) {
        try {
          await manager(ctx);
          const a = activation.parse(input);
          const [row] = await ctx.db.select().from(workspacePlugins).where(where(ctx, a.id));
          if (!row || row.digest !== a.digest || row.revision !== a.revision)
            throw new Error("Plugin changed. Review the current draft again.");
          return { ok: true };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : "Not allowed" };
        }
      },
      async execute(input, ctx) {
        if (!ctx.approved) throw new Error("Explicit approval is required to activate plugin access.");
        const a = activation.parse(input);
        const result = await ctx.db.transaction(async (tx) => {
          const [row] = await tx.select().from(workspacePlugins).where(where(ctx, a.id)).for("update");
          if (!row || row.digest !== a.digest || row.revision !== a.revision)
            throw new Error("Plugin changed. Review its current draft again.");
          const available = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.orgId, ctx.orgId), isNull(agents.archivedAt)));
          if (a.agentIds.some((id) => !available.some((agent) => agent.id === id)))
            throw new Error("Agent not in this workspace");
          const [saved] = await tx
            .update(workspacePlugins)
            .set({
              enabled: true,
              agentIds: [...new Set(a.agentIds)],
              revision: row.revision + 1,
              updatedAt: new Date(),
            })
            .where(where(ctx, a.id))
            .returning();
          if (!saved) throw new Error("Plugin unavailable");
          return view(saved);
        });
        await audit(ctx, a.id, "plugin.activated");
        return json(result);
      },
    },
    {
      name: "disable_plugin",
      scope: "setup:write",
      description:
        "Disable a workspace plugin immediately; keeps its records and manifest. Existing tool handles stop working too. To restore, activate the reviewed draft again.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(input, ctx) {
        const a = ref.parse(input);
        const rows = await ctx.db
          .update(workspacePlugins)
          .set({ enabled: false, agentIds: [], revision: sql`${workspacePlugins.revision} + 1`, updatedAt: new Date() })
          .where(where(ctx, a.id))
          .returning();
        if (!rows.length) throw new Error("Plugin not found");
        await audit(ctx, a.id, "plugin.disabled");
        return json({ disabled: true, recordsPreserved: true });
      },
    },
  ];
  return {
    name: "keepmind_plugins",
    async tools(ctx) {
      const rows = await ctx.db.select().from(workspacePlugins).where(eq(workspacePlugins.orgId, ctx.orgId));
      const dynamic = rows
        .filter((row) => row.enabled && row.agentIds.includes(ctx.agentId))
        .flatMap((row) => {
          const m = pluginManifest.parse(row.manifest);
          return m.actions.map((action) => recordTool(m, row.digest, action));
        });
      const people = await ctx.db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(and(eq(agents.orgId, ctx.orgId), isNull(agents.archivedAt)));
      return [
        ...management.map((tool) =>
          tool.name !== "activate_plugin"
            ? tool
            : {
                ...tool,
                describe(input: Record<string, unknown>) {
                  const row = rows.find((r) => r.slug === input.id);
                  const manifest = row ? pluginManifest.parse(row.manifest) : null;
                  const names = Array.isArray(input.agentIds)
                    ? input.agentIds.map((id) => people.find((a) => a.id === id)?.name ?? "Agente indisponível")
                    : [];
                  return {
                    title: `Ativar ${manifest?.name ?? "plugin"}`,
                    detail: `${manifest?.description ?? ""}\nCampos: ${manifest?.fields.map((f) => f.label).join(", ") ?? ""}\nAções: ${manifest?.actions.map((a) => a.description).join("; ") ?? ""}\nAgentes: ${names.join(", ")}\nDados ficam neste workspace; não há envio externo.`,
                  };
                },
              },
        ),
        ...dynamic,
      ].map(protectedTool);
    },
  };
}

function recordTool(m: PluginManifest, digest: string, action: PluginManifest["actions"][number]): ToolDefinition {
  const list = action.operation === "list";
  const create = action.operation === "create";
  const valueSchema = {
    type: "object" as const,
    properties: Object.fromEntries(m.fields.map((f) => [f.key, { type: f.type, description: f.label }])),
    required: create ? m.fields.filter((f) => f.required).map((f) => f.key) : [],
    additionalProperties: false,
  };
  return {
    name: nameOf(m, action.name),
    description: `${m.name}: ${action.description}. ${list ? "Paginated records; follow nextOffset to retrieve/export all results." : create ? "Reuse requestId on retries; never invent record values." : "Read the record first; revision prevents overwriting newer edits."}`,
    describe: (input) => ({
      title: `${m.name}: ${action.description}`,
      detail:
        input.values && typeof input.values === "object"
          ? m.fields
              .filter((f) => Object.hasOwn(input.values as object, f.key))
              .map((f) => `${f.label}: ${String((input.values as Record<string, unknown>)[f.key])}`)
              .join("\n")
              .slice(0, 2000)
          : m.description,
    }),
    scope: list ? "context:read" : "memory:write",
    external: true,
    looksOnly: () => list,
    inputSchema: list
      ? {
          type: "object",
          properties: {
            query: { type: "string", maxLength: 1000 },
            offset: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        }
      : {
          type: "object",
          properties: {
            values: valueSchema,
            ...(create
              ? { requestId: { type: "string", minLength: 1, maxLength: 100 } }
              : { id: { type: "string" }, revision: { type: "integer", minimum: 1 } }),
          },
          required: create ? ["values", "requestId"] : ["values", "id", "revision"],
          additionalProperties: false,
        },
    async execute(input, ctx) {
      const result = await ctx.db.transaction(async (tx) => {
        const [row] = await tx.select().from(workspacePlugins).where(where(ctx, m.id)).for("update");
        if (!row?.enabled || row.digest !== digest || !row.agentIds.includes(ctx.agentId))
          throw new Error("Plugin disabled, changed or not assigned to this agent.");
        const publicRecord = ({ requestId: _request, fingerprint: _hash, ...record }: schema.PluginRecord) => record;
        if (list) {
          const a = z
            .object({
              query: z.string().max(1000).default(""),
              offset: z.number().int().min(0).default(0),
              limit: z.number().int().min(1).max(100).default(50),
            })
            .strict()
            .parse(input);
          const fold = (s: string) =>
            s
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase();
          const matches = row.records.filter((r) => fold(JSON.stringify(r.values)).includes(fold(a.query)));
          return {
            total: matches.length,
            records: matches.slice(a.offset, a.offset + a.limit).map(publicRecord),
            nextOffset: a.offset + a.limit < matches.length ? a.offset + a.limit : null,
          };
        }
        const validators = Object.fromEntries(
          m.fields.map((f) => {
            const v =
              f.type === "string" ? z.string().max(5000) : f.type === "number" ? z.number().finite() : z.boolean();
            return [f.key, create && f.required ? v : v.optional()];
          }),
        );
        const values = z.object(validators).strict();
        if (looksLikeSecret(JSON.stringify(input.values)))
          throw new Error("Do not store credentials in plugin records. Use the protected Vault.");
        const now = new Date().toISOString();
        let record: schema.PluginRecord;
        if (create) {
          const a = z
            .object({ requestId: z.string().min(1).max(100), values })
            .strict()
            .parse(input);
          const hash = fingerprint(a.values);
          const existing = row.records.find((r) => r.requestId === a.requestId);
          if (existing) {
            if (existing.fingerprint !== hash) throw new Error("Request ID already used for different data");
            return publicRecord(existing);
          }
          if (row.records.length >= 2000) throw new Error("Record limit reached (2000)");
          record = {
            id: Bun.randomUUIDv7(),
            requestId: a.requestId,
            fingerprint: hash,
            values: a.values as schema.PluginRecord["values"],
            revision: 1,
            createdAt: now,
            updatedAt: now,
          };
          row.records.push(record);
        } else {
          const a = z
            .object({ id: z.string().uuid(), revision: z.number().int().positive(), values })
            .strict()
            .parse(input);
          const existing = row.records.find((r) => r.id === a.id);
          if (!existing) throw new Error("Record not found");
          if (existing.revision !== a.revision) throw new Error("Record changed. Read it again before updating.");
          record = existing;
          record.values = { ...record.values, ...a.values } as schema.PluginRecord["values"];
          record.revision++;
          record.updatedAt = now;
        }
        if (JSON.stringify(row.records).length > 5_000_000) throw new Error("Plugin storage limit reached (5 MB)");
        await tx.update(workspacePlugins).set({ records: row.records, updatedAt: new Date() }).where(where(ctx, m.id));
        return publicRecord(record);
      });
      if (!list) await audit(ctx, m.id, `plugin.record.${action.operation}`);
      return json(result);
    },
  };
}
