import { z } from "zod";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,23}$/);
export const pluginManifest = z
  .object({
    id: key,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1000),
    version: z.literal(1),
    autonomy: z.enum(["assisted", "records"]).default("assisted"),
    kind: z.literal("records"),
    fields: z
      .array(
        z
          .object({
            key,
            label: z.string().trim().min(1).max(80),
            type: z.enum(["string", "number", "boolean"]),
            required: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    actions: z
      .array(
        z
          .object({
            name: key,
            description: z.string().trim().min(1).max(300),
            operation: z.enum(["list", "create", "update", "review", "interact"]),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((m, ctx) => {
    for (const names of [m.fields.map((f) => f.key), m.actions.map((a) => a.name)]) {
      if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "Names must be unique" });
    }
    if (
      m.fields.some((f) =>
        ["id", "revision", "created_at", "updated_at", "constructor", "prototype", "__proto__"].includes(f.key),
      )
    ) {
      ctx.addIssue({ code: "custom", message: "Reserved field name" });
    }
  });
export type PluginManifest = z.infer<typeof pluginManifest>;
export const speechCrm: PluginManifest = {
  id: "crm_palestras",
  name: "CRM de palestras",
  description: "Oportunidades e próximos contatos. Não envia mensagens externas.",
  version: 1,
  autonomy: "assisted",
  kind: "records",
  fields: [
    { key: "nome", label: "Nome", type: "string", required: true },
    { key: "empresa", label: "Empresa", type: "string", required: false },
    { key: "etapa", label: "Etapa", type: "string", required: false },
    { key: "proximo_contato", label: "Próximo contato", type: "string", required: false },
    { key: "notas", label: "Notas", type: "string", required: false },
  ],
  actions: [
    { name: "buscar", description: "Buscar oportunidades", operation: "list" },
    { name: "cadastrar", description: "Cadastrar oportunidade", operation: "create" },
    { name: "atualizar", description: "Atualizar oportunidade", operation: "update" },
  ],
};

export const autonomousCrm: PluginManifest = {
  ...speechCrm,
  id: "crm_relacionamentos",
  name: "CRM autônomo de relacionamentos",
  description:
    "Organiza registros e identifica próximos contatos automaticamente. Não envia mensagens, exclui registros ou assume compromissos.",
  autonomy: "records",
  fields: [
    ...speechCrm.fields.map((field) =>
      field.key === "proximo_contato" ? { ...field, label: "Próximo contato (AAAA-MM-DD, UTC)" } : field,
    ),
    { key: "email", label: "Email", type: "string", required: false },
    { key: "valor", label: "Valor da oportunidade", type: "number", required: false },
    { key: "moeda", label: "Moeda", type: "string", required: false },
    { key: "ultimo_contato", label: "Último contato (AAAA-MM-DD)", type: "string", required: false },
    { key: "fonte", label: "Fonte verificável", type: "string", required: false },
  ],
  actions: [
    ...speechCrm.actions,
    { name: "registrar_interacao", description: "Registrar interação com data e fonte", operation: "interact" },
    { name: "priorizar", description: "Identificar próximos contatos e possíveis duplicatas", operation: "review" },
  ],
};
