import { and, eq, inArray, schema } from "@agenteschat/db";
import { sha256 } from "./crypto";
import { applyImport, type ImportDeps, type MigrationBundle } from "./imports";
import { mapLegacyPermissions, mapLegacyWorkflows } from "./keepmind-legacy-mapping";
import { requirePermission } from "./organizations";
import { canonicalJson } from "./tools/json-schema";

/** A private export of the legacy SQLite tables. Keep the original snapshot beside it: never upload it as a bundle. */
export interface KeepMindLegacySnapshot {
  sourceRef: string;
  timezone: string;
  agents: Record<string, unknown>[];
  teams: Record<string, unknown>[];
  skills: Record<string, unknown>[];
  memory_items: Record<string, unknown>[];
  triggers: Record<string, unknown>[];
  governance_rules?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
}
const text = (value: unknown) => (typeof value === "string" ? value : "");
function json(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}
function object(value: unknown): Record<string, unknown> {
  const parsed = json(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid legacy object");
  return parsed as Record<string, unknown>;
}
function strings(value: unknown): string[] {
  const parsed = json(value ?? []);
  if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) throw new Error("Invalid legacy references");
  return parsed;
}
const key = (row: Record<string, unknown>) => {
  if (!text(row.id)) throw new Error("Missing legacy id");
  return text(row.id);
};
const slug = (prefix: string, id: string) => `${prefix}-${sha256(id).slice(0, 20)}`;

const namedSlug = (prefix: string, id: string, name: unknown) => {
  const stem = text(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 19)
    .replace(/-$/, "");
  return `${stem || prefix}-${sha256(id).slice(0, 12)}`;
};

/** Pure conversion. No secrets/tools/grants are copied; full originals remain in the private SQLite backup. */
export function planKeepMindLegacy(snapshot: KeepMindLegacySnapshot) {
  if (!snapshot.sourceRef) throw new Error("Missing source identity");
  new Intl.DateTimeFormat("en", { timeZone: snapshot.timezone }).format();
  for (const rows of [snapshot.agents, snapshot.teams, snapshot.skills, snapshot.memory_items, snapshot.triggers]) {
    if (new Set(rows.map(key)).size !== rows.length) throw new Error("Duplicate legacy id");
  }
  const managers = new Map(snapshot.agents.map((row) => [key(row), text(row.manager_id)]));
  for (const id of managers.keys()) {
    const seen = new Set<string>();
    let current = id;
    while (current) {
      if (seen.has(current)) throw new Error("Cyclic legacy management relationship");
      seen.add(current);
      current = managers.get(current) ?? "";
    }
  }
  const agentKeys = new Set(snapshot.agents.map(key));
  const skillKeys = new Set(snapshot.skills.map(key));
  const requireRef = (id: string, keys: Set<string>) => {
    if (!keys.has(id)) throw new Error("Dangling legacy reference; original snapshot preserved");
    return id;
  };
  const review: { kind: string; key: string; reason: string }[] = [];
  const bundle: MigrationBundle = {
    format: "agenteschat.bundle",
    version: 1,
    source: { app: "keepmind-os-legacy", ref: snapshot.sourceRef, name: "KeepMind OS legado", files: [] },
    agents: snapshot.agents.map((row) => {
      const config = object(row.config);
      object(row.permissions); // Reject corrupt access records instead of interpreting them as unrestricted.
      const skills = strings(config.skillIds).map((id) => requireRef(id, skillKeys));
      if (row.manager_id) requireRef(text(row.manager_id), agentKeys);
      review.push({
        kind: "agent",
        key: key(row),
        reason: "Access, sharing, budgets and model require mapping; agent held with no scopes",
      });
      return {
        key: key(row),
        name: text(row.name),
        handle: namedSlug("legacy", key(row), row.name),
        role: text(row.description),
        instructions: text(config.systemPrompt),
        model: null,
        appearance: {},
        skills,
      };
    }),
    skills: snapshot.skills.map((row) => ({
      key: key(row),
      markdown: `---\nname: ${namedSlug("legacy", key(row), row.name)}\ndescription: ${JSON.stringify(text(row.description) || text(row.name))}\nmetadata:\n  originalName: ${JSON.stringify(text(row.name))}\n  sourceVersion: ${JSON.stringify(row.version ?? 1)}\n  category: ${JSON.stringify(text(row.category))}\n  tags: ${JSON.stringify(strings(row.tags))}\n---\n${text(row.prompt)}`,
    })),
    channels: snapshot.teams.map((row) => {
      review.push({
        kind: "team",
        key: key(row),
        reason: "Membership preserved in private room; legacy workflow retained in snapshot, not executed",
      });
      return {
        key: key(row),
        name: namedSlug("time", key(row), row.name),
        topic: text(row.description).length <= 500 ? text(row.description) : "",
        agents: strings(row.agent_ids).map((id) => ({ key: requireRef(id, agentKeys), autoReply: false })),
      };
    }),
    routines: [],
    notes: [],
    todo: [],
    leftOut: [],
  };
  for (const row of snapshot.triggers) {
    const agent = requireRef(text(row.agentId), agentKeys);
    const days = row.daysOfWeek ?? [];
    if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
      throw new Error("Invalid weekdays");
    // Intervals in the old app were measured from lastRunAt. Never silently replace them with wall-clock cron.
    if (row.kind !== "daily" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(text(row.timeOfDay))) {
      review.push({
        kind: "routine",
        key: key(row),
        reason: "Interval/webhook semantics require review; preserved in snapshot, not activated",
      });
      continue;
    }
    const [hour, minute] = text(row.timeOfDay).split(":").map(Number);
    bundle.routines.push({
      key: key(row),
      name: text(row.name),
      agent,
      prompt: text(row.prompt),
      channel: null,
      trigger: { cron: `${minute} ${hour} * * ${days.length ? days.join(",") : "*"}`, timezone: snapshot.timezone },
    });
  }
  for (const row of snapshot.memory_items) {
    // Old validity, supersession and evidence cannot be represented losslessly by generic notes.
    review.push({
      kind: "memory",
      key: key(row),
      reason: "Imported as private archived memory; original validity and evidence remain in snapshot for review",
    });
  }
  return { bundle, review, permissions: mapLegacyPermissions(snapshot), workflows: mapLegacyWorkflows(snapshot) };
}

/** Isolated staging only. Not a live-workspace importer. All DB changes and containment commit together. */
export async function stageKeepMindLegacy(
  deps: ImportDeps,
  actorId: string,
  orgId: string,
  snapshot: KeepMindLegacySnapshot,
) {
  await requirePermission(deps.db, actorId, orgId, "manage_agents");
  const plan = planKeepMindLegacy(snapshot);
  return deps.db.transaction(async (tx) => {
    const members = await tx
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.orgId, orgId));
    if (members.length !== 1 || members[0]?.userId !== actorId || members[0]?.role !== "owner")
      throw new Error("Staging requires a sole-owner workspace");
    const existing = await tx.select().from(schema.importItems).where(eq(schema.importItems.orgId, orgId));
    if (existing.some((row) => row.sourceApp !== plan.bundle.source.app || row.sourceRef !== snapshot.sourceRef))
      throw new Error("Staging contains another import");
    const original = new Set(existing.filter((row) => row.kind === "agent").map((row) => row.targetId));
    const agents = await tx.select().from(schema.agents).where(eq(schema.agents.orgId, orgId));
    if (agents.some((a) => !original.has(a.id))) throw new Error("Staging must contain no unrelated agents");
    // The generic importer only adopts public rooms / team skills. These temporary changes are
    // invisible outside this transaction and are restored to private before commit.
    const priorRooms = existing.filter((i) => i.kind === "channel").map((i) => i.targetId);
    if (priorRooms.length)
      await tx.update(schema.channels).set({ visibility: "public" }).where(inArray(schema.channels.id, priorRooms));
    const priorSkills = existing.filter((i) => i.kind === "skill").map((i) => i.targetId);
    if (priorSkills.length)
      await tx.update(schema.skills).set({ ownerUserId: null }).where(inArray(schema.skills.id, priorSkills));
    const result = await applyImport(
      { ...deps, db: tx },
      actorId,
      orgId,
      { bundle: plan.bundle, dryRun: false },
      { model: "claude-sonnet-5-5" },
    );
    if (result.items.some((i) => i.action === "skip" || i.trimmed?.length))
      throw new Error(
        `Import would skip or truncate data; transaction rolled back: ${JSON.stringify(result.items.filter((i) => i.action === "skip" || i.trimmed?.length).map((i) => ({ kind: i.kind, reason: i.reason, trimmed: i.trimmed })))}`,
      );
    const ids = (kind: string) =>
      result.items.filter((i) => i.kind === kind && i.targetId).map((i) => i.targetId as string);
    const agentIds = ids("agent");
    if (agentIds.length) {
      await tx
        .update(schema.agents)
        .set({
          operatorHoldAt: new Date(),
          operatorHoldReason: "legacy_migration_review",
          audienceMode: "owner",
          consultable: false,
          credentialId: null,
          brainAccountId: null,
        })
        .where(inArray(schema.agents.id, agentIds));
      await tx.delete(schema.agentScopes).where(inArray(schema.agentScopes.agentId, agentIds));
    }
    const channelIds = ids("channel");
    if (channelIds.length)
      await tx.update(schema.channels).set({ visibility: "private" }).where(inArray(schema.channels.id, channelIds));
    const routineIds = ids("routine");
    if (routineIds.length)
      await tx
        .update(schema.routines)
        .set({ active: false, nextRunAt: null, ownActions: [] })
        .where(inArray(schema.routines.id, routineIds));
    const skillIds = ids("skill");
    if (skillIds.length)
      await tx
        .update(schema.skills)
        .set({ ownerUserId: actorId, autoUpdate: false, agentsImprove: false })
        .where(inArray(schema.skills.id, skillIds));
    // Native memory rows are archived and tied to an invite-only room with no agent members.
    // Legacy evidence is not upgraded to verified evidence by migration.
    if (snapshot.memory_items.length) {
      const roomName = slug("legacy-memories", snapshot.sourceRef);
      let [room] = await tx
        .select()
        .from(schema.channels)
        .where(and(eq(schema.channels.orgId, orgId), eq(schema.channels.name, roomName)));
      if (!room)
        [room] = await tx
          .insert(schema.channels)
          .values({ orgId, name: roomName, visibility: "private", createdByUserId: actorId })
          .returning();
      if (room?.visibility !== "private") throw new Error("Invalid memory staging room");
      const memoryIds = new Map<string, string>();
      for (const row of snapshot.memory_items) {
        const previous = existing.find((i) => i.kind === "note" && i.key === key(row));
        const hash = sha256(JSON.stringify(row));
        if (previous && previous.hash !== hash) throw new Error("Changed legacy memory requires a fresh staging copy");
        const id = previous?.targetId ?? crypto.randomUUID();
        memoryIds.set(key(row), id);
        if (previous) continue;
        await tx.insert(schema.contextItems).values({
          id,
          orgId,
          kind: "note",
          scopeType: "channel",
          scopeId: room.id,
          channelIds: [room.id],
          content: text(row.content),
          status: "archived",
          trust: "low",
          verified: false,
          createdByKind: "person",
          createdById: actorId,
        });
        await tx.insert(schema.importItems).values({
          orgId,
          sourceApp: plan.bundle.source.app,
          sourceRef: snapshot.sourceRef,
          kind: "note",
          key: key(row),
          targetId: id,
          hash,
          createdByUserId: actorId,
        });
      }
      for (const row of snapshot.memory_items) {
        const relatedIds = strings(row.related_ids).map((id) => {
          const mapped = memoryIds.get(id);
          if (!mapped) throw new Error("Dangling memory relationship");
          return mapped;
        });
        const supersededBy = row.superseded_by ? memoryIds.get(text(row.superseded_by)) : null;
        if (row.superseded_by && !supersededBy) throw new Error("Dangling memory supersession");
        await tx
          .update(schema.contextItems)
          .set({ relatedIds, supersededBy })
          .where(eq(schema.contextItems.id, memoryIds.get(key(row)) as string));
      }
    }
    const imported = await tx
      .select()
      .from(schema.importItems)
      .where(and(eq(schema.importItems.orgId, orgId), eq(schema.importItems.sourceRef, snapshot.sourceRef)));
    const mapped = (kind: string, id: string) => imported.find((i) => i.kind === kind && i.key === id)?.targetId;
    for (const row of snapshot.agents) {
      if (row.manager_id)
        await tx
          .update(schema.agents)
          .set({ reportsToAgentId: mapped("agent", text(row.manager_id)) })
          .where(eq(schema.agents.id, mapped("agent", key(row)) as string));
    }
    for (const permission of plan.permissions) {
      // Only the explicit spend ceiling has a native, enforceable equivalent. Nothing grants tool access.
      await tx
        .update(schema.agents)
        .set({ monthlyBudgetNanoUsd: permission.monthlyBudgetNanoUsd })
        .where(eq(schema.agents.id, mapped("agent", permission.agentId) as string));
    }
    const permissions = plan.permissions.map((p) => ({ ...p, targetAgentId: mapped("agent", p.agentId) }));
    const workflows = plan.workflows.map((w) => ({
      ...w,
      targetChannelId: mapped("channel", w.teamId),
      steps: w.steps.map((s) => ({ ...s, targetAgentId: mapped("agent", s.agentId) })),
    }));
    return {
      ...result,
      review: plan.review,
      preparation: {
        version: 1,
        sourceDigest: sha256(canonicalJson(snapshot)),
        readyForCutover: false,
        permissions,
        workflows,
        governance: {
          captured: snapshot.governance_rules !== undefined,
          rules: snapshot.governance_rules?.length ?? 0,
          status: "requires_semantic_mapping",
        },
        identities: {
          captured: snapshot.users !== undefined,
          users: snapshot.users?.length ?? 0,
          status: "no_identity_grants",
        },
      },
    };
  });
}
