import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, isNull, schema } from "@keepmind/db";
import { builtinSkills, deleteSkill, ensureBuiltinSkills, ensureBuiltinSkillsForOrg, listSkills } from "../src";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const teamSkills = () =>
  f.db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.orgId, f.org.id), isNull(schema.skills.ownerUserId)));

describe("built-in skills", () => {
  test("a new org gets every built-in skill as an assignable team skill", async () => {
    f = await setup();
    const rows = await teamSkills();
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    for (const s of builtinSkills()) {
      const row = bySlug.get(s.slug);
      expect(row, s.slug).toBeDefined();
      expect(row?.source).toBe("builtin");
      expect(row?.defaultForNewAgents).toBe(false);
      expect(row?.metadata).toMatchObject({ builtin: true });
      expect((row?.metadata as { upstream?: { repo?: string } } | undefined)?.upstream?.repo).toBeTruthy();
      expect(row?.body.length).toBeGreaterThan(100);
    }
    // They list like any other team skill.
    const listed = await listSkills(f.db, f.owner.id, f.org.id);
    expect(listed.some((s) => s.name === "tdd")).toBe(true);
  });

  test("seeding is idempotent and the boot sweep converges", async () => {
    f = await setup();
    expect(await ensureBuiltinSkillsForOrg(f.db, f.org.id)).toBe(0);
    // Delete one built-in: its row still holds the slug, so nothing is re-seeded.
    const [tdd] = await f.db
      .select()
      .from(schema.skills)
      .where(and(eq(schema.skills.orgId, f.org.id), eq(schema.skills.slug, "tdd")));
    if (!tdd) throw new Error("tdd missing");
    await deleteSkill(f.db, f.owner.id, f.org.id, tdd.id);
    expect(await ensureBuiltinSkillsForOrg(f.db, f.org.id)).toBe(0);
    const [still] = await f.db.select().from(schema.skills).where(eq(schema.skills.id, tdd.id));
    expect(still?.deletedAt).not.toBeNull();
    // The sweep finds no org missing a built-in (deleted rows still count).
    expect(await ensureBuiltinSkills(f.db)).toBe(0);
  });

  test("an org's own skill with a built-in slug keeps its content", async () => {
    f = await setup();
    // Simulate an org that had its own "tdd" before built-ins shipped: replace body, then re-seed must not touch it.
    await f.db
      .update(schema.skills)
      .set({ body: "custom tdd", metadata: { custom: true } })
      .where(and(eq(schema.skills.orgId, f.org.id), eq(schema.skills.slug, "tdd")));
    expect(await ensureBuiltinSkillsForOrg(f.db, f.org.id)).toBe(0);
    const [row] = await f.db
      .select()
      .from(schema.skills)
      .where(and(eq(schema.skills.orgId, f.org.id), eq(schema.skills.slug, "tdd")));
    expect(row?.body).toBe("custom tdd");
  });
});
