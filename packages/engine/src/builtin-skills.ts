import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, type Database, type Executor, eq, isNull, schema, sql } from "@keepmind/db";
import { parseSkillMarkdown } from "./skills";

/**
 * Built-in skills shipped with the server (`assets/skills/<slug>.md`): vendored, adapted methodology the org's
 * agents can load like any team skill. They live as ordinary `skills` rows per org — assignable, editable,
 * auditable — marked `metadata.builtin` so a re-seed never overwrites an org's changes and a deleted one stays
 * deleted (the row still holds the slug).
 */

const DIR = join(import.meta.dir, "../assets/skills");

/** slug → upstream source, for attribution in `metadata.upstream`. */
export const BUILTIN_SKILL_SOURCES: Record<string, { repo: string; path: string; license: string }> = {
  tdd: { repo: "https://github.com/mattpocock/skills", path: "skills/engineering/tdd", license: "MIT" },
  "diagnosing-bugs": {
    repo: "https://github.com/mattpocock/skills",
    path: "skills/engineering/diagnosing-bugs",
    license: "MIT",
  },
  "to-spec": { repo: "https://github.com/mattpocock/skills", path: "skills/engineering/to-spec", license: "MIT" },
  "improve-codebase-architecture": {
    repo: "https://github.com/mattpocock/skills",
    path: "skills/engineering/improve-codebase-architecture",
    license: "MIT",
  },
  "grill-with-docs": {
    repo: "https://github.com/mattpocock/skills",
    path: "skills/productivity/grilling + skills/engineering/domain-modeling",
    license: "MIT",
  },
  triage: { repo: "https://github.com/mattpocock/skills", path: "skills/engineering/triage", license: "MIT" },
  brainstorming: { repo: "https://github.com/obra/superpowers", path: "skills/brainstorming", license: "MIT" },
  "writing-plans": { repo: "https://github.com/obra/superpowers", path: "skills/writing-plans", license: "MIT" },
  "executing-plans": { repo: "https://github.com/obra/superpowers", path: "skills/executing-plans", license: "MIT" },
  "systematic-debugging": {
    repo: "https://github.com/obra/superpowers",
    path: "skills/systematic-debugging",
    license: "MIT",
  },
  "verification-before-completion": {
    repo: "https://github.com/obra/superpowers",
    path: "skills/verification-before-completion",
    license: "MIT",
  },
  "engineering-discipline": {
    repo: "https://github.com/multica-ai/andrej-karpathy-skills",
    path: "skills/karpathy-guidelines",
    license: "MIT",
  },
};

let cache:
  | { slug: string; name: string; description: string; body: string; metadata: Record<string, unknown> }[]
  | null = null;

/** The shipped skills, parsed once per process. A missing dir (odd packaging) yields none, not a crash. */
export function builtinSkills() {
  if (cache) return cache;
  let files: string[] = [];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
  } catch {
    cache = [];
    return cache;
  }
  cache = files.map((file) => {
    const slug = file.slice(0, -3);
    const parsed = parseSkillMarkdown(readFileSync(join(DIR, file), "utf8"));
    const upstream = BUILTIN_SKILL_SOURCES[slug];
    return {
      slug,
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      metadata: {
        ...parsed.metadata,
        builtin: true,
        ...(upstream ? { upstream: { ...upstream, adapted: "keepmind" } } : {}),
      },
    };
  });
  return cache;
}

/**
 * Give one org every built-in skill it has no row for (any state, deleted included — the slug stays taken so a
 * deleted built-in is not silently resurrected). Safe to run twice and inside a transaction.
 */
export async function ensureBuiltinSkillsForOrg(db: Executor, orgId: string) {
  const have = await db
    .select({ slug: schema.skills.slug })
    .from(schema.skills)
    .where(and(eq(schema.skills.orgId, orgId), isNull(schema.skills.ownerUserId)));
  const present = new Set(have.map((r) => r.slug));
  const missing = builtinSkills().filter((s) => !present.has(s.slug));
  for (const s of missing) {
    await db
      .insert(schema.skills)
      .values({
        orgId,
        slug: s.slug,
        name: s.name,
        description: s.description,
        body: s.body,
        metadata: s.metadata,
        source: "builtin",
        defaultForNewAgents: false,
      })
      .onConflictDoNothing();
  }
  return missing.length;
}

/**
 * Boot sweep (mirrors `ensureRightHands`): orgs missing at least one built-in slug get the rest. The count
 * includes soft-deleted rows, so an org that deleted a built-in converges and is not rescanned forever.
 */
export async function ensureBuiltinSkills(db: Database, batch = 200): Promise<number> {
  const slugs = builtinSkills().map((s) => s.slug);
  if (slugs.length === 0) return 0;
  let made = 0;
  for (;;) {
    const rows = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(
        and(
          isNull(schema.organizations.deletionDueAt),
          sql`(select count(distinct s.slug) from ${schema.skills} s where s.org_id = ${schema.organizations.id} and s.owner_user_id is null and s.slug in (${sql.join(
            slugs.map((s) => sql`${s}`),
            sql`, `,
          )})) < ${slugs.length}`,
        ),
      )
      .limit(batch);
    for (const org of rows) made += await db.transaction((tx) => ensureBuiltinSkillsForOrg(tx, org.id));
    if (rows.length < batch) return made;
  }
}
