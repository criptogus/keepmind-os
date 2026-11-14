/** Offline only: creates a NEW private directory. Never reads server env, starts workers or connects providers. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDiskBlobStore, createMemoryPubSub, singleStoreResolver } from "@agenteschat/adapters";
import { createDatabase, eq, schema } from "@agenteschat/db";
import { createOrganization } from "@agenteschat/engine";
import { type KeepMindLegacySnapshot, stageKeepMindLegacy } from "../../../packages/engine/src/keepmind-legacy";

const [input, destination] = process.argv.slice(2);
if (!input || !destination)
  throw new Error("Usage: bun apps/server/scripts/keepmind-legacy-stage.ts PRIVATE_SNAPSHOT.json NEW_DIRECTORY");
process.umask(0o077);
const root = resolve(destination);
await mkdir(root, { mode: 0o700 }); // EEXIST is intentional: never point at a running/live database.
const raw = await readFile(resolve(input), "utf8");
const snapshot = JSON.parse(raw) as KeepMindLegacySnapshot;
await writeFile(`${root}/source.json`, raw, { mode: 0o600, flag: "wx" });
const url = `pglite://${root}/db`;
let handle = createDatabase({ url, poolMax: 1 });
try {
  await handle.migrate();
  const actorId = crypto.randomUUID();
  await handle.db
    .insert(schema.users)
    .values({ id: actorId, name: "KeepMind Migration", email: `${actorId}@migration.invalid` });
  const { organization } = await createOrganization(handle.db, actorId, { name: "KeepMind — migração isolada" });
  // Only the just-created staging workspace's factory agent; no existing user data is ever here.
  await handle.db.delete(schema.agents).where(eq(schema.agents.orgId, organization.id));
  const deps = {
    db: handle.db,
    pubsub: createMemoryPubSub(),
    blobs: singleStoreResolver(createDiskBlobStore(`${root}/files`)),
  };
  const first = await stageKeepMindLegacy(deps, actorId, organization.id, snapshot);
  await handle.close();
  handle = createDatabase({ url, poolMax: 1 });
  const second = await stageKeepMindLegacy({ ...deps, db: handle.db }, actorId, organization.id, snapshot);
  if (second.items.some((i) => i.action !== "unchanged")) throw new Error("Repeat import changed data");
  const persistedAgents = await handle.db.select().from(schema.agents);
  const persistedRoutines = await handle.db.select().from(schema.routines);
  const ledger = await handle.db.select().from(schema.importItems);
  const target = (kind: string, key: unknown) => ledger.find((i) => i.kind === kind && i.key === key)?.targetId;
  const fail = () => {
    throw new Error("Staging readback differs from source or containment policy");
  };
  for (const source of snapshot.agents) {
    const saved = persistedAgents.find((a) => a.id === target("agent", source.id));
    const config = typeof source.config === "string" ? JSON.parse(source.config) : source.config;
    if (
      !saved ||
      saved.name !== String(source.name).trim() ||
      saved.instructions !== String(config.systemPrompt ?? "").trim() ||
      !saved.operatorHoldAt ||
      saved.audienceMode !== "owner" ||
      saved.consultable ||
      saved.credentialId ||
      saved.brainAccountId
    )
      fail();
  }
  const persistedSkills = await handle.db.select().from(schema.skills);
  for (const source of snapshot.skills) {
    const saved = persistedSkills.find((s) => s.id === target("skill", source.id));
    if (
      !saved ||
      saved.body.trim() !== String(source.prompt).trim() ||
      saved.ownerUserId !== actorId ||
      saved.autoUpdate
    )
      fail();
  }
  const rooms = await handle.db.select().from(schema.channels);
  const memberships = await handle.db.select().from(schema.channelMembers);
  for (const team of snapshot.teams) {
    const room = rooms.find((r) => r.id === target("channel", team.id));
    const original = typeof team.agent_ids === "string" ? JSON.parse(team.agent_ids) : team.agent_ids;
    const expected = original.map((id: string) => target("agent", id)).sort();
    const actual = memberships
      .filter((m) => m.channelId === room?.id && m.agentId)
      .map((m) => m.agentId)
      .sort();
    if (room?.visibility !== "private" || JSON.stringify(expected) !== JSON.stringify(actual)) fail();
  }
  if (persistedRoutines.some((r) => r.active || r.nextRunAt || r.ownActions.length)) fail();
  const counts = {
    agents: (await handle.db.select().from(schema.agents)).length,
    skills: (await handle.db.select().from(schema.skills)).length,
    teams: first.items.filter((i) => i.kind === "channel").length,
    routines: (await handle.db.select().from(schema.routines)).length,
    memories: (await handle.db.select().from(schema.contextItems)).length,
    scopes: (await handle.db.select().from(schema.agentScopes)).length,
  };
  if (
    counts.agents !== snapshot.agents.length ||
    counts.skills !== snapshot.skills.length ||
    counts.teams !== snapshot.teams.length ||
    counts.memories !== snapshot.memory_items.length ||
    counts.scopes !== 0
  )
    fail();
  await writeFile(
    `${root}/report.json`,
    JSON.stringify(
      { organizationId: organization.id, actorId, counts, restartAndRepeat: "passed", result: first },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ counts, restartAndRepeat: "passed", pendingReview: first.review.length }));
} finally {
  await handle.close();
}
