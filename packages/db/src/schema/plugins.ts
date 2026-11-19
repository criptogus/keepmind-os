import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";

/** Declarative workspace plugins. All mutations lock one row, including grants and record revisions. */
export const workspacePlugins = pgTable(
  "workspace_plugins",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    manifest: jsonb().$type<Record<string, unknown>>().notNull(),
    digest: text().notNull(),
    enabled: boolean().notNull().default(false),
    agentIds: uuid().array().notNull().default([]),
    records: jsonb().$type<PluginRecord[]>().notNull().default([]),
    revision: integer().notNull().default(1),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("workspace_plugins_org_slug").on(t.orgId, t.slug)],
);

export interface PluginRecord {
  interactions?: Array<{
    requestId: string;
    note: string;
    source: string;
    occurredAt: string;
    recordedAt: string;
    agentId: string;
    runId: string | null;
  }>;

  history?: Array<{
    revision: number;
    values: Record<string, string | number | boolean>;
    changedAt: string;
    agentId: string;
    runId: string | null;
  }>;

  id: string;
  requestId: string;
  fingerprint: string;
  values: Record<string, string | number | boolean>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
