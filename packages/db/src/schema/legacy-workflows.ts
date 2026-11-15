import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { organizations } from "./tenancy";

export const legacyAgentPolicies = pgTable("legacy_agent_policies", {
  agentId: uuid()
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  orgId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean().notNull().default(false),
  ownerUserId: text().notNull(),
  monthlyRunCap: integer(),
  historyCaptured: boolean().notNull().default(false),
  priorRunsByMonth: jsonb().$type<Record<string, number>>().notNull().default({}),
  timeoutSeconds: integer().notNull(),
  // This first native adapter is text-only. No tool or computer capability is migrated implicitly.
  sourceDigest: text().notNull(),
});
export const legacyRunAdmissions = pgTable("legacy_run_admissions", {
  runId: uuid().primaryKey(),
  agentId: uuid()
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  orgId: uuid().notNull(),
  admittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deadline: timestamp({ withTimezone: true }).notNull(),
});
export interface LegacyWorkflowStep {
  id: string;
  agentId: string;
  inputs: Record<string, unknown>;
  dependsOn: string[];
  condition: { path: string[]; op: string; value: unknown } | null;
}
export const legacyWorkflows = pgTable(
  "legacy_workflows",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceRef: text().notNull(),
    sourceTeamId: text().notNull(),
    sourceDigest: text().notNull(),
    channelId: uuid().notNull(),
    ownerUserId: text().notNull(),
    enabled: boolean().notNull().default(false),
    mode: text().$type<"sequential" | "parallel" | "conditional">().notNull(),
    steps: jsonb().$type<LegacyWorkflowStep[]>().notNull(),
  },
  (t) => [unique().on(t.orgId, t.sourceRef, t.sourceTeamId)],
);
export interface LegacyStepState {
  id: string;
  status: "pending" | "queued" | "done" | "failed" | "skipped" | "blocked";
  runId?: string;
  output?: Record<string, unknown>;
}
export const legacyWorkflowRuns = pgTable(
  "legacy_workflow_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workflowId: uuid()
      .notNull()
      .references(() => legacyWorkflows.id),
    requestId: text().notNull(),
    inputHash: text().notNull(),
    actorId: text().notNull(),
    status: text().$type<"running" | "done" | "failed">().notNull().default("running"),
    states: jsonb().$type<LegacyStepState[]>().notNull(),
    context: jsonb().$type<Record<string, unknown>>().notNull(),
    poll: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.workflowId, t.requestId)],
);
