# Chief-of-Staff Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Kivo's existing interview/proposal machinery into first-run and the Team page, surface a live "Agora" strip on the Team page, and let Kivo proactively suggest team fixes — all reusing existing engine tools.

**Architecture:** Three independent workstreams. (1) Web-only: auto-send a starter message into Kivo's DM from the team-template dialog and from a new Team-page CTA via a `?say=` route param. (2) Web-only: a `TeamNow` component reusing `useTaskManager` + `agoraSections` (the same data the Agora popover reads). (3) Engine: a `team-drift.ts` module computing four cheap signals, gated and deduped, injected as prompt lines in `rightHandPrompt`.

**Tech Stack:** Bun + Hono + Drizzle (engine), React + TanStack Router + `@keepmind/client` hooks + `@keepmind/ui` (web), i18next (`en.ts`/`pt-BR.ts` sources).

**Spec:** `docs/design/chief-of-staff-gaps.md`

## Global Constraints

- i18n: author new keys in `packages/i18n/src/en.ts` AND `packages/i18n/src/pt-BR.ts`; verify the widening pipeline (`locales/*.json`) picks them up.
- UI: `packages/ui` kit components + tokens only; ui-polish rules (32/40/48 control heights, spacing tokens, dark mode). Run `bun test scripts/geometry/check.test.ts` before claiming UI done.
- Engine prompt text is English (all existing nudge lines are); UI copy is i18n'd.
- `rightHandPrompt` runs on EVERY DM turn — drift queries must be gated (`inDm && !personal && !cardOpen && team.length > 0`) and scoped to `seen` agents (`seesAgentDetails`).
- No auto-apply: every suggestion stays a conversational offer; proposals remain cards the person approves.
- Personal workspaces (`isPersonalWorkspace`): board shows, drift nudges excluded (product choice per spec).
- Mobile `FirstRun.tsx` is a separate port — OUT of scope for this plan (follow-up).

## Review Focus

- `?say=` param with an unknown/garbage value must not send anything (input class: untrusted URL param).
- `resend`/`send` auto-fire must happen exactly once per mount, not on every re-render or refetch.
- Drift lines must not fire while `cardOpen` (first-run checklist active) or duplicate existing `checklist`/`teamThings` nudges (e.g. "agent in no channel" vs idle-agent drift).
- Drift stats computed over `seen` only — an agent the viewer can't see must not leak via idle/failed counts.
- TeamNow must not leak work items the viewer can't see — `useTaskManager` already filters (`hidden` count exists); do not bypass it.
- Billing hold: interview CTA hidden/disabled same as the dialog's `held` gate.

---

### Task 1: Interview auto-send — "describe it yourself" actually sends

**Files:**
- Modify: `apps/web/src/components/TeamPlan.tsx:773-792` (the `teamPlan.templates.none` item)
- Modify: `packages/i18n/src/en.ts`, `packages/i18n/src/pt-BR.ts` (new keys)
- Test: `apps/web` has no component test harness for this — verify via geometry check + manual reasoning; engine-side interview already tested.

**Interfaces:**
- Consumes: `ChannelActions.resend(body: string)` (`channel-actions.tsx:13`) — sends immediately as the user.
- Produces: nothing later tasks need.

- [ ] **Step 1: Add i18n keys**

In `en.ts` and `pt-BR.ts`, under the `teamPlan.templates` block, add a starter-message key per workspace mode. `modeKey(org, key)` already picks personal vs business variants — follow the existing `teamPlan.templates.noneSub` pattern (check how `modeKey` resolves; it prefixes or suffixes for personal workspaces — mirror whatever `noneSub` does).

Keys (names are the contract; adjust prefix to match `noneSub`'s convention):
- business: something like `teamPlan.templates.describeSend` = `"I want to set up my team. Can you interview me?"` / `"Quero montar meu time. Pode me entrevistar?"`
- personal variant (whatever `modeKey` convention yields): `"I want to set up my agents. Can you interview me?"` / `"Quero configurar meus agentes. Pode me entrevistar?"`

The exact key names must match how `modeKey` composes — read `modeKey` in `TeamPlan.tsx`/`lib` first and mirror `noneSub` exactly.

- [ ] **Step 2: Change the "none" item to send**

In `TeamPlan.tsx` ~line 778-781, replace `actions?.focusComposer()` with `actions?.resend(t(modeKey(org, "teamPlan.templates.describeSend")))`. Keep `onClose()` first. If `actions` is null (dialog used outside a channel context — check other call sites of `TeamTemplatesDialog`), fall back to `focusComposer()`.

Check other `TeamTemplatesDialog` call sites (`grep -rn "TeamTemplatesDialog\|TeamPlan" apps/web/src`) — if any render outside `ChannelActionsContext`, the fallback covers them.

- [ ] **Step 3: Verify i18n widening**

Run the i18n pipeline check (find it: `grep -rn "widen\|locales" packages/i18n/package.json packages/i18n/scripts/ 2>/dev/null` or check how other keys propagate). Confirm the new keys appear in generated locale files or that fallback works. If there's a generate script, run it.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/TeamPlan.tsx packages/i18n/
git commit -m "feat(web): team template 'describe it yourself' sends the interview starter"
```

---

### Task 2: Team-page CTA → Kivo DM with auto-send (`?say=`)

**Files:**
- Modify: `apps/web/src/routes/org.$orgId.dm.agent.$agentId.tsx` (validateSearch + prop)
- Modify: `apps/web/src/pages/DmPage.tsx` (accept + forward)
- Modify: `apps/web/src/pages/ChannelPage.tsx` (auto-send once)
- Modify: `apps/web/src/pages/TeamPage.tsx` (CTA button in PageHeader actions)
- Modify: `packages/i18n/src/en.ts`, `packages/i18n/src/pt-BR.ts`

**Interfaces:**
- Consumes: `isRightHand(agent)` (`@keepmind/client/lib/right-hand`), `useDirectory(org.id).agentById` (Map of all agents incl. right hand), `makesAgents(org)` (`@keepmind/client/lib/permissions`), `send(body)` inside ChannelPage (the same fn `resend` wraps, ~line 2327).
- Produces: `?say=<key>` search param on the agent-DM route; `DmPage` prop `say?: string`; `ChannelPage` prop `sayOnce?: string`.

- [ ] **Step 1: i18n keys**

Add `rightHand.say.team` / personal-mode equivalent via `modeKey` (mirror Task 1's keys — reuse the same starter strings; the CTA and the dialog send the SAME message). Also add `team.askKivo` (button label): en `"Describe it to {name}"` / pt-BR `"Descreva pro {name}"` — check existing `rightHand` label key for the agent's display name; use `t("rightHand.label")` if the name isn't needed.

Actually simpler: button label `t("team.askKivo")` = en `"Tell {name} what you need"`, pt-BR `"Conte ao {name} o que você precisa"` with `{name}` = right hand's name from directory.

- [ ] **Step 2: `?say=` param on the route**

In `org.$orgId.dm.agent.$agentId.tsx` `validateSearch`, add `say` as an optional string restricted to a whitelist: `say === "team" || say === "agents"` → `{ say }`. Anything else → omit (Review Focus: garbage param must not send). Pass `say={Route.useSearch().say}` to `DmPage`.

- [ ] **Step 3: DmPage forwards resolved text**

`DmPage({ target, focusMessageId, say })`: resolve `say` → starter text via `t(modeKey-equivalent)`. DmPage doesn't have `modeKey` — check how it knows personal vs business: `isPersonalWorkspace` isn't client-side; look at how `FirstRun`/`Standing` detects personal (`personal` power or org flag — grep `isPersonal` in `packages/client`). Pass the resolved string (or undefined) to `ChannelPage` as `sayOnce`.

- [ ] **Step 4: ChannelPage auto-sends once**

Add optional prop `sayOnce?: string`. Inside ChannelPage, after `send` is defined and channel data is ready, a `useEffect` + `useRef` guard sends it exactly once:

```ts
const saySent = useRef(false);
useEffect(() => {
  if (sayOnce && !saySent.current && /* channel ready condition used elsewhere */) {
    saySent.current = true;
    send(sayOnce);
  }
}, [sayOnce, /* readiness deps */]);
```

Find the readiness condition by looking at how `send`/composer gate on loaded messages (there's likely a `channel`/`messages` query or `fallback` pattern — match it). If `send` is unstable, store it in a ref like `latestActions` does. Do NOT send while `chrome.locked` or `composerReplacement` is set — check those conditions and skip.

- [ ] **Step 5: TeamPage CTA**

In `TeamPage.tsx`, find the right hand agent: `[...dir.agentById.values()].find(isRightHand)` (verify `agentById` is iterable — it's a Map; if not, check `dir.agents`/`anyAgent` API). Render a `Button` in `PageHeader actions` (alongside `makes`, only when `maker`/`makesAgents(org)` is true and NOT `noAgents` — actually show it also in empty state? Keep it in `makes` fragment so it appears wherever create-agent does):

```tsx
<Button variant="ghost" icon="edit" asChild>
  <Link to="/org/$orgId/dm/agent/$agentId" params={{ orgId: org.id, agentId: rightHand.id }} search={{ say: personal ? "agents" : "team" }}>
    {t("team.askKivo", { name: rightHand.name })}
  </Link>
</Button>
```

Personal detection on TeamPage: grep how other components detect personal workspace client-side (`isPersonal`, `personal` power in `can()`). If none exists client-side, the `say` param can carry a single value `"team"` and DmPage resolves personal-vs-business itself (it has org context) — prefer this: ONE say value, DmPage picks the right i18n variant. Simplifies Step 2-3.

- [ ] **Step 6: Verify**

`bun run typecheck` (or repo's equivalent — check package.json scripts), geometry check, manual trace: Team page → click → lands in Kivo DM → message appears → Kivo replies with interview question.

- [ ] **Step 7: Commit**

---

### Task 3: "Agora" strip on the Team page

**Files:**
- Create: `apps/web/src/components/team/TeamNow.tsx`
- Modify: `apps/web/src/pages/TeamPage.tsx` (render it)
- Modify: `apps/web/src/styles/team.css` or `agora.css` (styles — reuse `agora-row` classes where possible)
- Modify: `packages/i18n/src/en.ts`, `packages/i18n/src/pt-BR.ts`

**Interfaces:**
- Consumes: `useTaskManager(orgId, { since: todayStart() })` (`queries.ts:6515`), `agoraSections(view.data)` → `{ you, working, waiting }` (`@keepmind/client/lib/agora`), `agoraPhrase(t, lang, item, forName, now)`, `agoraTime(lang, item, now)`, `useOpenTask()` (`components/tasks/TaskBits.tsx`), `useDirectory`, `useNow(WORK_TICK_MS/4)`, `AgentAvatar`, `WaitMark`, `GroupHeading`/`Card` from `@keepmind/ui`.
- Produces: `<TeamNow />` — self-contained, reads its own queries.

- [ ] **Step 1: i18n keys**

`team.now.title` = "Agora"/"Now"; `team.now.empty` = "No one is working right now"/"Ninguém trabalhando agora"; `team.now.open` = link to task manager (reuses `agora.openManager` key if it exists — check `en.ts` for `agora.openManager`, reuse it).

- [ ] **Step 2: Build `TeamNow.tsx`**

Mirror `AgoraList`'s data flow but as a persistent card, NOT a popover:

```tsx
export function TeamNow() {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const view = useTaskManager(org.id, { since: todayStart() });
  const now = useNow(WORK_TICK_MS / 4);
  const sections = useMemo(() => agoraSections(view.data), [view.data]);
  const openTask = useOpenTask();
  const dir = useDirectory(org.id);
  // render Card > GroupHeading "Agora" > rows for sections.working then sections.you (cap ~6 total)
}
```

Each row: `AgentAvatar` (state thinking/waiting/idle like `AgoraRow`), agent name + `agoraPhrase(...)` + `agoraTime(...)`, click → `openTask(item.task)` (for `kind === "task"`; for `kind === "return"` use `openTask({...item.ret, messageId: item.ret.replyMessageId})` — copy `AgoraList.open`'s logic exactly). NO stop/cancel actions in v1 (view-only; the popover and task-manager page keep those). Footer link → `/org/$orgId/task-manager` reusing `agora.openManager`.

Loading: `LoadingList count={2}`; error: `ErrorState` with refetch; empty (all sections empty AND `view.data.hidden?.total` falsy): the `team.now.empty` line.

- [ ] **Step 3: Mount in TeamPage**

Render `{data && agents.length > 0 && <TeamNow />}` between `</PageHeader>` and the loading/error/view blocks (~line 115). It must render in EVERY view (it's above the `Segmented` output, not inside a view). Personal workspaces: render too (agent-status/task-manager work there).

- [ ] **Step 4: Styles**

Reuse `.agora-row` classes from `agora.css` (import it or move shared bits — check if `agora.css` is already imported globally via `Agora.tsx`; TeamNow importing `"../agora.css"` or `"./agora.css"` path-wise is fine). Add only a `.team-now` wrapper class in `team.css` if spacing needs it. NO new visual language — this must look like a native section.

- [ ] **Step 5: Verify**

Geometry check + screenshots at 1280 and 390, light and dark (ui-polish routine). Confirm: rows show real work, click navigates to the task's place, empty state reads correctly, hidden-count line shows when `view.data.hidden.total > 0` (copy the `taskManager.hiddenLine` pattern from AgoraList).

- [ ] **Step 6: Commit**

---

### Task 4: Team-drift suggestions in `rightHandPrompt`

**Files:**
- Create: `packages/engine/src/team-drift.ts`
- Modify: `packages/engine/src/right-hand-prompt.ts` (gate + inject)
- Modify: `packages/engine/src/index.ts` (export, if the barrel exports siblings — check how `right-hand-proactive` is exported)
- Test: `packages/engine/test/team-drift.test.ts`

**Interfaces:**
- Consumes: `saidOnce(db, orgId, key)` / `saidKey` (`right-hand-proactive.ts:108-130`), `seesAgentDetails`, `isPersonalWorkspace`, schema tables `agentRuns`, `routines`, `messages`, `approvals`, `channels` (verify exact export names in `packages/db/src/schema/`).
- Produces: `teamDrift(db, opts): Promise<string[]>` — English prompt lines, max 1 (first that fits), or `[]`.

- [ ] **Step 1: Write the failing test** `packages/engine/test/team-drift.test.ts`

Follow `right-hand-proactive.test.ts`'s fixture pattern (`setup()` from `./fixtures`, `afterEach` close). Tests:

1. Fresh team, no drift signals → `teamDrift` returns `[]` (or rightHandPrompt output lacks "# Team drift").
2. Agent with ≥3 `failed` `agent_runs` in 24h → returns a line naming `@handle` and suggesting review (assert line contains handle + "failed"/"review" wording — you write the wording).
3. Same signal called twice same day → second call returns `[]` (dedupe via saidOnce dated key `team_drift:${YYYY-MM-DD}:${personId}`).
4. Agent NOT in `seen` (no `seesAgentDetails`) with failures → no line for it.
5. Personal workspace → `rightHandPrompt` output has no drift section (gate test at prompt level, not teamDrift level).
6. `cardOpen` active → no drift section in prompt.

For prompt-level tests (5,6), call `rightHandPrompt(deps, input)` like existing `right-hand*.test.ts` do — check one for the exact `deps`/`input` shape.

- [ ] **Step 2: Run test, verify it fails**

`cd packages/engine && bun test test/team-drift.test.ts` → FAIL (module doesn't exist).

- [ ] **Step 3: Implement `team-drift.ts`**

```ts
export async function teamDrift(
  db: Database,
  opts: {
    orgId: string;
    personId: string;
    seen: { id: string; handle: string; name: string }[];  // already permission-filtered
    channels: { id: string; name: string }[];              // channels the person sees (reuse `open`/`named` from prompt)
    now?: Date;
  },
): Promise<string[]>
```

Signals (each a small indexed query; run in `Promise.all`, scoped to `seen` ids):

1. **Failed runs**: `agent_runs` where `org_id`, `agent_id = any(seenIds)`, `status='failed'`, `created_at > now-24h` group by agent having count ≥ 3 → line: `@handle had N failed runs in the last day: offer to review its setup (propose_settings_change or propose_instruction_change).`
2. **Idle agent with routines**: agents in `seen` having ≥1 `active` routine AND no `agent_runs` row in last 7d → line suggesting pause/re-scope.
3. **Silent channel**: for the person's visible channels, `messages` max(created_at) < now-14d (or zero messages ever, older than channel creation + 14d) → line suggesting archive/re-purpose. CAREFUL: `messages` is partitioned (ADR 0009) — check how other queries bound it (`team-status.ts` has examples); keep the query cheap (limit channels examined, use the same partition-safe pattern).
4. **Approvals backlog**: `approvals` where `org_id`, `status='pending'`, `agent_id = any(seenIds)` count ≥ 5 → line suggesting an approval rule.

Return at most ONE line: first signal that fires, in the order above (failed runs is most actionable). All lines English, phrased as offers ("offer to…", "suggest…"), matching existing nudge style.

Dedupe: at the TOP, `const day = now.toISOString().slice(0,10); if (!await saidOnce(db, orgId, `team_drift:${day}:${personId}`)) return [];` — consume-on-inject semantics: building the prompt with drift present IS the once-per-day event (documented trade-off; a run where Kivo ignores it still burns the day — acceptable, prevents spam).

Wait — saidOnce writes to `outbox`. `rightHandPrompt` may run inside the run's transaction; verify `saidOnce`'s insert is safe there (it takes `Executor` — fine). BUT: if prompt build happens speculatively/retried, a consumed key with no visible suggestion is the accepted trade-off.

- [ ] **Step 4: Wire into `rightHandPrompt`**

After `cardOpen` is computed (~line 305) and before the `return`, compute:

```ts
const drift =
  input.inDm && !personal && !cardOpen && team.length > 0
    ? await teamDrift(db, { orgId, personId, seen, channels: named, now: new Date() })
    : [];
```

`named` is already the permission-filtered channel list (~line 198). `seen` is the filtered agents (~line 181) — but `teamDrift` needs handle/name: `seen` rows are full agent rows, fine.

Inject into the returned array as a new section AFTER the checklist block (~line 348):

```ts
drift.length
  ? `# Team drift\nThe team's work shows strain. Raise at most one of these, as an offer, once what they asked is done:\n${drift.map((l) => `- ${l}`).join("\n")}`
  : "",
```

Also add ONE line to the "# Your cards" section or the drift section itself mapping tools: small fixes → `propose_settings_change`/`propose_instruction_change`; structural → `propose_team`. Put it in the drift section header text to keep it self-contained.

- [ ] **Step 5: Run tests**

`cd packages/engine && bun test test/team-drift.test.ts test/right-hand-proactive.test.ts test/right-hand.test.ts` — all pass. Then broader: `bun test test/` if fast enough, or at least the right-hand* + team-* files.

- [ ] **Step 6: Commit**

---

### Task 5: Final verification + polish

- [ ] `bun run typecheck` (repo root or per-package — check root package.json)
- [ ] Engine tests: `cd packages/engine && bun test test/` (or the CI's test command)
- [ ] Web geometry: `bun test scripts/geometry/check.test.ts`
- [ ] ui-polish routine for TeamNow + TeamPage CTA (screenshots 1280/390, light/dark)
- [ ] i18n widening pipeline verified for all new keys
- [ ] Commit any fixes

## Self-Review Notes

- Spec coverage: item 1 → Tasks 1+2; item 2 → Task 3; item 3 → Task 4. Mobile port explicitly out.
- Type consistency: `say` param → `sayOnce` prop → `send()`; `teamDrift` signature consumed only by right-hand-prompt; `TeamNow` consumes only existing client libs.
- Known builder details left open (per spec): exact `modeKey` composition, ChannelPage readiness condition, `agentById` iteration, personal detection client-side, messages partition-safe query pattern — each step points at where to look.
