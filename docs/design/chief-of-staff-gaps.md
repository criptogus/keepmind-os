# Chief-of-Staff experience gaps — design

Date: 2026-11-20 · Status: proposal · Scope approved by owner (3 items)
Revised after builder check (subagent review of code claims).

## Intent and why

Rerun's headline feature is a "Chief of Staff" that interviews you and assembles a
team. KeepMind OS already has that machinery — the built-in `right_hand` agent
(**Kivo**) runs a guided interview (`offer_answers` chips, max 3 questions) and
proposes the whole team in one `propose_team` card, and first run offers team
templates without a model call. What is missing is *reach*: the interview only
starts if the person thinks to ask, there is no single live "who is doing what"
board, and Kivo never proposes restructuring a team that already exists. This
doc closes those three gaps by wiring existing engine tools into the places
people actually look — verified against the code, with corrections from review.

## What exists today (verified)

- `packages/engine/src/right-hand.ts` — Kivo, seeded per org.
- `packages/engine/src/right-hand-prompt.ts` — `TEAM_INTERVIEW` and
  `PERSONAL_INTERVIEW` sections, injected **only in DM runs**
  (`input.inDm`, ~line 349). Nudge block (`firstThings`/`laterThings`/
  `teamThings`/`checklist`, ~lines 242–315) computed live per run from agents,
  people, channels+seats, budgets, apps, computers, invitations — **not** from
  works, run history, message activity, or approvals.
- `packages/engine/src/team-proposals.ts` — `TEAM_PROPOSAL_CARD`,
  `offer_answers`/`propose_team` tools, `MAX_TEAM_AGENTS=6`, `TEAM_UNDO_MS=24h`,
  one transaction via `createTeam`; `postTeamCard` supersedes older pending
  team cards in the same channel; at most one pending team card per DM.
- `packages/engine/src/team-templates.ts` — 6 business + 6 personal templates;
  `listTeamTemplates` returns only the mode-appropriate 6.
- `apps/web/src/components/FirstRun.tsx` — first-run checklist. **Important:**
  the card renders *inside Kivo's DM* (`RightHandIntro.tsx`, `DmPage.tsx`), and
  the `team` step exists **only in personal workspaces**
  (`setup-checklist.ts:264` — `Boolean(may.personal) && may.createAgents`).
  Business workspaces got their team during onboarding and never see the row.
- `TeamTemplatesDialog` (`TeamPlan.tsx:697`) **already has a "describe it
  yourself" item** — but it only calls `actions?.focusComposer()`
  (~line 773–792); it does not send. The real delta is smaller than "add an
  entry point": it's *auto-send a starter message*.
- **Auto-send precedent exists**: `firstRunAsks` uses
  `ChannelActionsContext.resend = send(body)` (`channel-actions.tsx:13`,
  `ChannelPage.tsx:2327`). No `openPersonAgentDm` web path exists — that's
  engine-internal (`dms.ts:188`).
- **Team-step "done" needs no new signal**: `facts.team = team.length > 0`
  (`FirstRun.tsx:101`, `setup-checklist.ts:303`) — any created agent flips it.
- **Live board data is already HTTP-exposed** (better than expected):
  `GET /organizations/{orgId}/agent-status` (`apps/server/src/routes/app/
  agents.ts:759-866`) returns per-agent `presence`, `status`, `activeAt`,
  `working`, and a `work` object (`state`, `since`, `channelId`,
  `channelName`, `runId`, `count`). Client hook `useAgentStatuses`
  (`queries.ts:2807`) refetches on `agent.status` WS events **and** every 30 s —
  realtime is solved. `liveWorksByAgent` (`works.ts:1448`) and `team_status`
  (`team-status.ts`) are engine-internal, **not** HTTP routes.
- Pending approvals per agent: `Approval.agentId` (`types.ts:2053`);
  `useApprovals` (`queries.ts:2008`) — count `status==="pending" && agentId`,
  cheap, no N+1.
- Team page is a **segmented view switcher** (list/chart/map/sectors/usage,
  `TeamPage.tsx:34-56`), not a scroll page; route is a thin wrapper.
- **Daily-cap machinery exists**: `saidOnce`/`saidKey`
  (`right-hand-proactive.ts:108-130`) — outbox dedupe keys
  `right_hand.said:<org>:<key>`, once-ever; a dated key gives per-day for free.
  Caveat: it *consumes* the key — there is no peek; injecting the suggestion
  line IS the once-per-day event.
- Pending proposal cards detectable via `meta.actionCard.kind`/`state`
  (`team-proposals.ts:178-181`).

## Goals (revised)

### 1. Interview auto-send in first run + Team page

- In `TeamTemplatesDialog`, change the existing "describe it yourself" item
  from `focusComposer()` to **send a fixed starter message** via
  `actions.resend(starter)` — inside first run this lands directly in Kivo's
  DM where `PERSONAL_INTERVIEW`/`TEAM_INTERVIEW` (whichever applies to the
  workspace mode) takes over.
- Starter message is i18n'd **per locale and per workspace mode** (personal
  interview wording differs from team interview). Sources: `en.ts` +
  `pt-BR.ts`; verify the widening pipeline picks up new keys.
- **Business workspaces** (no first-run team row) get the same affordance on
  the Team page: a "Descrever/pedir time ao Kivo" action that navigates to
  Kivo's DM **with an auto-send** — needs a new mechanism since `resend` only
  exists inside `ChannelActionsContext`. Precedent: `?m=`/`?paid` search
  params on `org.$orgId.dm.agent.$agentId.tsx:8-17` — add e.g. `?say=<key>`
  that maps to an i18n starter and sends once on mount.
- Gate both paths: `may.createAgents`/`can(org,"create_agents")` on the Team
  page CTA (a viewer must not trigger a proposal they can't approve), and
  hidden on billing hold the same way the dialog hides "none" today
  (`TeamPlan.tsx:773`).
- Mobile has a **separate mirrored** `FirstRun.tsx`
  (`apps/mobile/src/features/right-hand/FirstRun.tsx`) — port required, not a
  deep link. Decide in plan whether mobile ships in v1 or follows up.

### 2. "Now" board on the Team page

- Build on `useAgentStatuses` + `useApprovals` + `useTeam` — covers ~90% of
  the spec with realtime already wired. **Do not** build on
  `liveWorksByAgent`/`team_status` (not exposed via HTTP).
- Placement decision needed: TeamPage swaps whole views via `Segmented`. Two
  options — (a) always-on strip above the `Segmented` visible in every view,
  (b) a new "Agora/Now" segment. Recommend (a) for glanceability; (b) keeps
  views clean. Builder picks; default (a).
- Per agent row: name/avatar, `work.state` (working/waiting_approval/
  waiting_input/queued/later/you), `work.since` elapsed, `work.channelName`,
  pending-approvals count badge, `activeAt` for "ocioso desde …".
- Row destination: `work.channelId`/`channelKind`/`messageId` already give a
  deep link — verify a route exists for `channelKind:"task"`/`dm` targets
  before choosing; fall back to agent DM.
- **Empty-state conflict**: page's `team.empty*` state replaces everything
  when `agents.length===0`; the board's own empty state + interview CTA must
  not double-render — pick one (recommend: board empty state wins inside the
  board region; page empty state unchanged).
- **Audience filtering**: confirm `GET /agent-status` filters per viewer
  (`seesAgentDetails`); board must not leak agents/works the viewer can't
  see. Mirror `teamStatus`'s `readsOrMayJoin` logic if the endpoint doesn't.
- Personal workspaces: board shows their agents if the Team page is
  reachable there; verify.
- Kivo pointer: one line in the right-hand snapshot linking the board URL —
  no new tool unless the snapshot proves insufficient.

### 3. Proactive team-drift suggestions (Kivo)

- Extend the nudge block in `right-hand-prompt.ts` with a **team-drift**
  check — but the four signals are NOT in the current snapshot; each needs a
  new cheap indexed query, and this function runs **on every DM turn**.
  Mitigations (all required):
  - Compute drift **only when** `input.inDm && team.length > 0 &&
    !isPersonalWorkspace && no cardOpen checklist active` (lines ~306–315
    already suppress nudges during first run — drift must too, or it fights
    the interview).
  - Scope every signal to `seen` agents (`seesAgentDetails`, ~line 181) —
    idle/failed stats for invisible agents would leak existence/activity.
  - Keep queries minimal: one aggregate pass, reuse `team-status.ts` query
    shapes (`agent_runs` aggregation ~lines 89–97), indexed filters only.
- Signals (revised — the doc's original four need re-mapping):
  - agent idle >7d with routines → suggest pause/re-scope
  - channel zero messages in 14d → suggest archive/re-purpose
  - ≥3 failed runs in 24h on one agent → suggest setup review
  - standing approvals backlog → suggest an approval rule
    (`approval-rules` machinery exists, `types.ts:2124`)
- **Dedupe with existing nudges**: `checklist`/`teamThings` already emit
  "agent in no channel", "budget ≥80%" — drift lines must not duplicate.
  Follow the existing "raise only the first that fits, once" pattern
  (line ~347); define priority order drift-vs-setup nudges.
- **Rate limit, engine-enforced**: inject the suggestion line only when a
  `saidOnce`-style dated key (`team_drift:YYYY-MM-DD:<channelId>`) is fresh.
  Since `saidOnce` consumes on write and there's no peek, the cleanest
  mechanism is: build prompt → if drift qualifies, attempt the dedupe write;
  if the key already exists, omit the line. Builder confirms whether
  `right-hand-proactive.ts` exposes an existence check or whether the
  consume-on-inject semantics suffice (injecting the line *is* the once/day
  event — acceptable if a non-injected day doesn't burn the key; it does
  burn it, so a peek/existence check is likely needed).
- **Tool mapping** (hardest unspecified part): `propose_team` is for
  start/rebuild — whether it handles "pause/re-scope one agent" gracefully is
  untested. Small changes should route to `propose_settings_change`/
  `propose_instruction_change` (named in prompt ~lines 360–361). The prompt
  text must map drift type → correct tool; engine enforces nothing here, so
  the instruction wording matters.
- All suggestions phrased as offers ("quer que eu…?"), consistent with
  existing nudge style; declining is one word.
- Personal workspaces: excluded from drift nudges — **product choice**, note
  they DO have agents that drift; exclusion rationale = no "team" to
  restructure, though `PERSONAL_INTERVIEW` exists. Keep exclusion, document
  it.

## Non-goals

- No new agent types, no new tools beyond wiring.
- No auto-applying team changes — every proposal stays a card the person
  approves.
- No redesign of the Team page; the board is an added element.
- No changes to templates, personas, or the approval/gateway model.

## Anti-goals

- Notification spam: engine-side daily cap + pending-card suppression.
- A second "assistant": everything goes through Kivo.
- New polling loops: board uses existing WS + 30s refetch; drift is
  prompt-time only.

## Constraints

- i18n: author in `en.ts` + `pt-BR.ts`; verify widening/translation pipeline.
- UI uses `packages/ui` kit + tokens; ui-polish rules apply (32/40/48 heights,
  spacing tokens, dark mode, geometry check green).
- Read-only board: no mutations, no N+1 queries.
- `rightHandPrompt` latency: drift queries must be gated and cheap.

## Approaches considered

1. **Wire existing tools into UX surfaces (chosen).** Matches how the
   codebase works — Kivo's prompt, `propose_team`, `agent-status` endpoint,
   `saidOnce` dedupe are all built; the gap is reach.
2. **New orchestrator agent / Chief-of-Staff persona.** Rejected: duplicates
   Kivo, splits grants/prompt, violates "no second assistant".
3. **Rerun-style board as standalone page.** Rejected for v1: agent-status
   data + Team page reach the same audience cheaper.

## What's left to the builder (updated)

- Auto-send mechanism for the Team-page CTA (`?say=` param vs other).
- Board placement: strip above `Segmented` vs new segment (recommend strip).
- Board row destination after verifying `channelKind` route coverage.
- Whether `agent-status` endpoint filters per viewer audience (verify
  handler body past line 869).
- `saidOnce` peek vs consume-on-inject for the daily drift cap.
- Drift→tool mapping wording in the prompt.
- Mobile: port `FirstRun.tsx` change or defer.
- Exact i18n key names + widening pipeline check.

## Verification

- Engine tests: interview auto-send completes team step (`team.length>0`);
  proposal card creation still transactional; drift suggestion respects
  daily cap, pending-card suppression, `cardOpen` suppression, `seen`
  scoping, personal exclusion; dedupe vs existing checklist nudges.
- Server: `GET /agent-status` per-viewer filtering test if not covered.
- Web: geometry check (`bun test scripts/geometry/check.test.ts`),
  screenshots 1280/390 light+dark for board + new first-run action.
- i18n keys present in en + pt-BR; widening pipeline verified.
