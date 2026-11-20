import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@keepmind/db";
import { createOrganization, recordAudit, verifyAuditChain } from "../src";
import { addUser, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(() => f?.close());

/** setup() itself audits (org.create…): start each test from an empty log. */
async function fresh() {
  f = await setup();
  await f.db.delete(schema.auditLog);
}

const entry = (action: string, details: Record<string, unknown> = {}) => ({
  orgId: f.org.id,
  actor: { type: "person" as const, id: f.owner.id },
  action,
  target: { type: "test", id: null },
  details,
});

describe("audit hash chain", () => {
  test("appends link and verify clean", async () => {
    await fresh();
    await recordAudit(f.db, entry("one.test", { a: 1 }));
    await recordAudit(f.db, entry("two.test", { b: [1, 2] }));
    await recordAudit(f.db, entry("three.test"));

    const rows = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.orgId, f.org.id));
    expect(rows).toHaveLength(3);
    expect(rows[0]?.prevHash).toBeNull();
    expect(rows[1]?.prevHash).toBe(rows[0]?.chainHash);
    expect(rows[2]?.prevHash).toBe(rows[1]?.chainHash);
    expect(new Set(rows.map((r) => r.chainHash)).size).toBe(3);

    expect(await verifyAuditChain(f.db, f.org.id)).toEqual({ ok: true, checked: 3, unhashed: 0 });
  });

  test("a changed field breaks the chain at that row", async () => {
    await fresh();
    await recordAudit(f.db, entry("one.test"));
    await recordAudit(f.db, entry("two.test"));
    await recordAudit(f.db, entry("three.test"));

    const [middle] = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "two.test"));
    await f.db.update(schema.auditLog).set({ action: "two.tampered" }).where(eq(schema.auditLog.id, middle!.id));

    const report = await verifyAuditChain(f.db, f.org.id);
    expect(report.ok).toBe(false);
    expect(report.reason).toBe("hash_mismatch");
    expect(report.badId).toBe(middle!.id);
    expect(report.checked).toBe(1);
  });

  test("a deleted chained row breaks the next link", async () => {
    await fresh();
    await recordAudit(f.db, entry("one.test"));
    await recordAudit(f.db, entry("two.test"));
    await recordAudit(f.db, entry("three.test"));

    await f.db.delete(schema.auditLog).where(eq(schema.auditLog.action, "two.test"));

    const report = await verifyAuditChain(f.db, f.org.id);
    expect(report.ok).toBe(false);
    expect(report.reason).toBe("prev_mismatch");
  });

  test("pre-chain rows stay unhashed and outside the chain", async () => {
    await fresh();
    await f.db.insert(schema.auditLog).values({
      orgId: f.org.id,
      actorType: "person",
      actorId: f.owner.id,
      action: "legacy.test",
      targetType: "test",
      targetId: null,
      details: {},
    });
    await recordAudit(f.db, entry("new.test"));

    const report = await verifyAuditChain(f.db, f.org.id);
    expect(report).toEqual({ ok: true, checked: 1, unhashed: 1 });
  });

  test("chains are per org", async () => {
    await fresh();
    const other = await addUser(f.db, "bia");
    const { organization: org2 } = await createOrganization(f.db, other.id, { name: "Second" });

    await recordAudit(f.db, entry("one.test"));
    await recordAudit(f.db, { ...entry("x.test"), orgId: org2.id, actor: { type: "person", id: other.id } });
    await recordAudit(f.db, entry("two.test"));

    const [a] = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.orgId, f.org.id));
    const [b] = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.orgId, org2.id));
    expect(a?.prevHash).toBeNull();
    expect(b?.prevHash).toBeNull();
    expect(a?.chainHash).not.toBe(b?.chainHash);
    expect(await verifyAuditChain(f.db, f.org.id)).toEqual({ ok: true, checked: 2, unhashed: 0 });
    expect(await verifyAuditChain(f.db, org2.id)).toEqual({ ok: true, checked: 1, unhashed: 0 });
  });
});
