import { type Database, rowsOf, sql } from "@keepmind/db";
import { saidAlready, saidOnce } from "./right-hand-proactive";

/**
 * Team drift (chief-of-staff gaps, item 3): the signals that say an existing team stopped fitting, phrased as
 * offers the right hand may raise in a DM. Computed per run but gated by the caller (`inDm`, not personal, no
 * open checklist card, team non-empty) and scoped to the agents the person may see — never to anyone else.
 *
 * At most one line per person per day: `saidAlready` peeks the dated outbox key, `saidOnce` spends it only when a
 * line is actually injected, so a day with no drift doesn't burn the slot and two racing runs can't both say it.
 */

const DAY = 24 * 3600_000;
const WEEK = 7 * DAY;
const FORTNIGHT = 14 * DAY;
/** A channel this old with no message in FORTNIGHT is drift, not a new channel still finding its feet. */
const CHANNEL_IDLE_MIN_AGE = FORTNIGHT;
/** Pending approvals at or above this across the seen agents: a rule could carry them. */
const APPROVAL_BACKLOG = 5;
/** Channels examined for silence: the person's visible list is already small; this bounds the `any()` array. */
const CHANNELS_CHECKED = 20;

export interface DriftAgent {
  id: string;
  handle: string;
  name: string;
  /** Agent row's creation time: a routine on a day-old agent is setup, not drift. */
  createdAt?: Date | string | null;
}

export interface DriftChannel {
  id: string;
  name: string;
  createdAt?: Date | string | null;
}

const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;

const asTime = (v: Date | string | null | undefined) => (v == null ? 0 : new Date(v).getTime());

/**
 * The day's drift line for this person, or none: the first signal that fires, in priority order (failed runs is
 * the most actionable). English, offer-style, matching the other nudge lines in `right-hand-prompt.ts`.
 */
export async function teamDrift(
  db: Database,
  opts: {
    orgId: string;
    personId: string;
    /** Agents the person may see (`seesAgentDetails` already applied). */
    seen: DriftAgent[];
    /** Channels the person sees (`named` in the prompt: public-only outside a DM). */
    channels: DriftChannel[];
    now?: Date;
  },
): Promise<string[]> {
  const { orgId, personId, seen, channels } = opts;
  const now = opts.now ?? new Date();
  const ids = seen.map((a) => a.id);
  if (ids.length === 0) return [];
  const key = `team_drift:${now.toISOString().slice(0, 10)}:${personId}`;
  if (await saidAlready(db, orgId, key)) return [];

  const line = await firstDrift(db, orgId, seen, channels, ids, now);
  if (!line) return [];
  return (await saidOnce(db, orgId, key)) ? [line] : [];
}

async function firstDrift(
  db: Database,
  orgId: string,
  seen: DriftAgent[],
  channels: DriftChannel[],
  ids: string[],
  now: Date,
): Promise<string | null> {
  const idArray = uuidArray(ids);
  const dayAgo = new Date(now.getTime() - DAY).toISOString();
  const weekAgo = new Date(now.getTime() - WEEK).toISOString();
  const fortnightAgo = new Date(now.getTime() - FORTNIGHT).toISOString();
  const byId = new Map(seen.map((a) => [a.id, a]));
  const handle = (id: string) => `@${byId.get(id)?.handle ?? "agent"}`;

  const [failed, routineAgents, recentRuns, activeChannels, backlog] = await Promise.all([
    // ≥3 failed runs in a day on one agent: its setup probably stopped fitting.
    rowsOf<{ agent_id: string; c: number | string }>(
      await db.execute(sql`select r.agent_id, count(*) as c from agent_runs r
        where r.org_id = ${orgId}::uuid and r.agent_id = any(${idArray}::uuid[])
          and r.status = 'failed' and r.created_at >= ${dayAgo}::timestamptz
        group by r.agent_id having count(*) >= 3 order by r.agent_id`),
    ),
    // Agents with an active routine: candidates for the idle check below.
    rowsOf<{ agent_id: string }>(
      await db.execute(sql`select distinct rt.agent_id from routines rt
        where rt.org_id = ${orgId}::uuid and rt.active and rt.deleted_at is null
          and rt.agent_id = any(${idArray}::uuid[])`),
    ),
    // Agents that ran in the last week: an idle check only makes sense against these.
    rowsOf<{ agent_id: string }>(
      await db.execute(sql`select distinct r.agent_id from agent_runs r
        where r.org_id = ${orgId}::uuid and r.agent_id = any(${idArray}::uuid[])
          and r.created_at >= ${weekAgo}::timestamptz`),
    ),
    // Channels with any message in the last fortnight: everything else visible is a silence candidate.
    channels.length
      ? rowsOf<{ channel_id: string }>(
          await db.execute(sql`select distinct m.channel_id from messages m
            where m.org_id = ${orgId}::uuid and m.channel_id = any(${uuidArray(
              channels.slice(0, CHANNELS_CHECKED).map((c) => c.id),
            )}::uuid[]) and m.created_at >= ${fortnightAgo}::timestamptz`),
        )
      : Promise.resolve([] as { channel_id: string }[]),
    // Pending approvals waiting on the seen agents.
    rowsOf<{ c: number | string }>(
      await db.execute(sql`select count(*) as c from approvals a
        where a.org_id = ${orgId}::uuid and a.status = 'pending' and a.agent_id = any(${idArray}::uuid[])`),
    ),
  ]);

  const fail = failed[0];
  if (fail)
    return `${handle(fail.agent_id)} had ${Number(fail.c)} failed runs in the last day: offer to review its setup (propose_settings_change or propose_instruction_change).`;

  const ranRecently = new Set(recentRuns.map((r) => r.agent_id));
  const idle = routineAgents
    .map((r) => byId.get(r.agent_id))
    .filter(
      (a): a is DriftAgent =>
        !!a && !ranRecently.has(a.id) && asTime(a.createdAt) < now.getTime() - WEEK,
    )
    .sort((a, b) => a.handle.localeCompare(b.handle));
  if (idle.length)
    return `${handle(idle[0]!.id)} has routines but hasn't run in over a week: offer to check they still fit or pause them (propose_settings_change).`;

  // Only the checked slice is eligible: activity was only queried for it, so a channel past it would
  // read as silent no matter how busy it is.
  const active = new Set(activeChannels.map((c) => c.channel_id));
  const silent = channels
    .slice(0, CHANNELS_CHECKED)
    .filter(
      (c) =>
        c.createdAt != null &&
        asTime(c.createdAt) < now.getTime() - CHANNEL_IDLE_MIN_AGE &&
        !active.has(c.id),
    )
    .slice(0, 2);
  if (silent.length) {
    const names = silent.map((c) => `#${c.name}`).join(", ");
    return `${names} saw no messages in two weeks: offer to revisit or archive ${silent.length > 1 ? "them" : "it"}.`;
  }

  const waiting = Number(backlog[0]?.c ?? 0);
  if (waiting >= APPROVAL_BACKLOG)
    return `${waiting} approvals are waiting across the team: offer to see which could be pre-approved (approval rules).`;

  return null;
}
