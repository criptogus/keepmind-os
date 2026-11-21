import { and, desc, type Executor, eq, gt, isNotNull, schema, sql } from "@keepmind/db";
import { sha256 } from "./crypto";

export interface AuditEntry {
  orgId: string;
  actor: { type: "person" | "agent" | "system"; id: string | null };
  /** e.g. `storage.activated`, `artifact.version_created`. */
  action: string;
  target: { type: string; id: string | null };
  /** Never secrets: hints at most. */
  details?: Record<string, unknown>;
  /** An agent's: the run, its conversation and the person behind it (agent-audit.ts). */
  runId?: string | null;
  channelId?: string | null;
  onBehalfOfUserId?: string | null;
  outcome?: schema.AuditOutcome | null;
}

/** JSON with object keys sorted at every level, so jsonb's own key order can't change the hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

interface ChainFields {
  orgId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  runId: string | null;
  channelId: string | null;
  onBehalfOfUserId: string | null;
  outcome: schema.AuditOutcome | null;
  prevHash: string | null;
}

/** The first format (bare hex): the row's fields and the previous hash, without its id or time. Read only. */
export function auditEntryHash(f: ChainFields): string {
  return sha256(canonical({ v: 1, ...f }));
}

const V2 = "v2:";

/**
 * The current format (ADR 0187): also seals the row's own id and time, so neither can be changed and a row
 * can't be moved to another place in the log. The prefix says which format a stored hash is in.
 */
export function auditEntryHashV2(f: ChainFields & { id: string; createdAt: Date }): string {
  const { createdAt, ...rest } = f;
  return `${V2}${sha256(canonical({ ...rest, v: 2, createdAt: createdAt.toISOString() }))}`;
}

/**
 * Appends to the org's audit log (in the caller's transaction when given one). The row joins the org's
 * tamper-evident chain: an advisory lock serializes appends per org, `prevHash` links to the org's latest
 * chained row and `chainHash` seals this one. Rows written before the chain keep both null and sit outside it.
 */
export async function recordAudit(db: Executor, entry: AuditEntry) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`audit:${entry.orgId}`}))`);
    const [prev] = await tx
      .select({ chainHash: schema.auditLog.chainHash })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.orgId, entry.orgId), isNotNull(schema.auditLog.chainHash)))
      .orderBy(desc(schema.auditLog.id))
      .limit(1);
    const fields: ChainFields = {
      orgId: entry.orgId,
      actorType: entry.actor.type,
      actorId: entry.actor.id,
      action: entry.action,
      targetType: entry.target.type,
      targetId: entry.target.id,
      details: entry.details ?? {},
      runId: entry.runId || null,
      channelId: entry.channelId || null,
      onBehalfOfUserId: entry.onBehalfOfUserId ?? null,
      outcome: entry.outcome ?? null,
      prevHash: prev?.chainHash ?? null,
    };
    // The id and the time are made here, under the lock, so the hash seals them and ids follow append order.
    const sealed = { ...fields, id: Bun.randomUUIDv7(), createdAt: new Date() };
    await tx.insert(schema.auditLog).values({ ...sealed, chainHash: auditEntryHashV2(sealed) });
  });
}

export interface AuditChainReport {
  ok: boolean;
  /** Chained rows verified. */
  checked: number;
  /** Rows predating the chain (both hashes null): outside it, not verifiable. */
  unhashed: number;
  /**
   * The latest verified row's hash, null with none. Rows removed from the END of the log leave a chain that
   * still verifies: only this value, kept somewhere outside the database and compared later, shows it.
   */
  head: string | null;
  /** The first row that broke the chain, when `ok` is false. */
  badId?: string;
  reason?: "prev_mismatch" | "hash_mismatch";
}

/** Rows read per query while verifying: the whole log never sits in memory. */
const VERIFY_PAGE = 1000;

/**
 * Walks the org's log in append order and recomputes every chained row: `prevHash` must equal the previous
 * chained row's `chainHash` and `chainHash` must match the row's own fields, in the format its prefix names.
 * A changed, deleted or reordered chained row fails at the first break. Unchained (pre-chain) rows are
 * counted, not verified.
 */
export async function verifyAuditChain(db: Executor, orgId: string): Promise<AuditChainReport> {
  let expectedPrev: string | null = null;
  let checked = 0;
  let unhashed = 0;
  let after: string | null = null;
  for (;;) {
    const rows: (typeof schema.auditLog.$inferSelect)[] = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.orgId, orgId), after ? gt(schema.auditLog.id, after) : undefined))
      .orderBy(schema.auditLog.id)
      .limit(VERIFY_PAGE);
    for (const row of rows) {
      if (row.chainHash == null) {
        unhashed += 1;
        continue;
      }
      const broken = (reason: AuditChainReport["reason"]): AuditChainReport => ({
        ok: false,
        checked,
        unhashed,
        head: expectedPrev,
        badId: row.id,
        reason,
      });
      if (row.prevHash !== expectedPrev) return broken("prev_mismatch");
      const fields: ChainFields = {
        orgId: row.orgId,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        details: row.details,
        runId: row.runId,
        channelId: row.channelId,
        onBehalfOfUserId: row.onBehalfOfUserId,
        outcome: row.outcome,
        prevHash: row.prevHash,
      };
      const recomputed = row.chainHash.startsWith(V2)
        ? auditEntryHashV2({ ...fields, id: row.id, createdAt: row.createdAt })
        : auditEntryHash(fields);
      if (recomputed !== row.chainHash) return broken("hash_mismatch");
      expectedPrev = row.chainHash;
      checked += 1;
    }
    const last = rows.at(-1);
    if (!last || rows.length < VERIFY_PAGE) break;
    after = last.id;
  }
  return { ok: true, checked, unhashed, head: expectedPrev };
}

/**
 * A change to one of the installation's own secrets (`instance_secrets`): every workspace works with it, so each
 * workspace's log says who changed it.
 */
export async function auditEveryOrg(
  tx: Executor,
  secret: string,
  actor: AuditEntry["actor"],
  action: string,
  details: Record<string, unknown>,
) {
  const orgs = await tx.select({ id: schema.organizations.id }).from(schema.organizations);
  for (const org of orgs) {
    await recordAudit(tx, { orgId: org.id, actor, action, target: { type: "instance_secret", id: secret }, details });
  }
}
