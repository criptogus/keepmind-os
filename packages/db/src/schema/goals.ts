import { doublePrecision, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./auth";
import { organizations } from "./tenancy";

/**
 * Goals (OKRs): a metric a person or an agent commits to, owned by one leader agent, tracked
 * against a target over a period. Agents propose them (`proposed`), a person activates them;
 * leaders move `current` and leave a `progressNote` on their routines' reviews.
 */
export const goals = pgTable(
  "goals",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text().notNull(),
    /** What is measured and how ("qualified leads per month"), in the proposer's words. */
    metric: text().notNull().default(""),
    /** The number that means done, in `unit`s (100 leads). Null: a goal with no number, judged in review. */
    target: doublePrecision(),
    /** Where it stands now; leaders move it on their reviews. */
    current: doublePrecision().notNull().default(0),
    unit: text().notNull().default(""),
    /** `daily`, `weekly`, `monthly`, `quarterly` or `yearly`; validated in code. */
    period: text().notNull().default("monthly"),
    /** The leader accountable for it (a C-level or team lead); null: the workspace's, unowned. */
    ownerAgentId: uuid().references(() => agents.id, { onDelete: "set null" }),
    /** `proposed` (an agent asked, a person hasn't said yes), `active`, `paused`, `achieved`, `dropped`. */
    status: text().notNull().default("proposed"),
    /** The latest line the owner left on a review ("3 of 10 demos booked; plan: …"). */
    progressNote: text().notNull().default(""),
    createdByUserId: text().references(() => users.id, { onDelete: "set null" }),
    /** Set when an agent proposed it (its handle is kept in `createdByAgent` for display). */
    createdByAgentId: uuid().references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.orgId, t.status), index().on(t.orgId, t.ownerAgentId), index().on(t.orgId, t.createdAt)],
);
