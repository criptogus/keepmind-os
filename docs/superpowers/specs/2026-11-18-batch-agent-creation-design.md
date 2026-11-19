# Batch agent creation from templates

## Intent

"Criar agente" today makes exactly one agent through a 7-step wizard. People assembling a team pick the same
screens over and over. This adds batch mode: select several ready-made role templates at once and create them all
with one shared configuration, without losing the single-agent flow.

## Goals

- Multi-select on the role step; 2+ picks switch the wizard into batch mode.
- Shared steps apply to the whole batch: channels/audience ("where"), who thinks ("model"), budget/autonomy.
- Per-agent identity (name, handle, look, instructions, app-level presets) comes from each template, no per-agent
  editing before creation.
- One engine call creates all agent rows atomically; post-creation steps (brain, channels, levels, skills) reuse the
  existing per-agent API calls, best-effort per agent like today.

## Non-goals

- No per-agent customization inside the batch wizard (edit each agent's page afterwards).
- `custom` role is not batchable (it's free-form, not a template).
- No routines/first tasks, no mailbox grants, no proposal cards in batch mode.
- Personal workspaces keep their own starter flow untouched.

## Constraints

- `create_agents` permission and owner rules identical to single create.
- Handle collisions (existing agents or inside the batch) resolve server-side with `-2`, `-3` suffixes.
- Restricted roles keep their no-implicit-connections rule; template `levels` presets apply as in single mode.
- i18n: en + pt-BR sources, 12 locales + `identical.json` like every wizard string.
- UI rules: kit numbers only, geometry check green, break-ui worst cases (long translated names, 30+ roles selected).

## Approaches (picked: A)

- **A — multi-select inside the wizard (picked).** Role cards get a selected state; 1 pick = today's flow, 2+ = batch
  mode with a reduced step rail. Reuses every existing step component.
- B — separate quick-create screen: less code but a second flow to maintain and no shared config steps; rejected.
- C — synthesize `createTeam` proposal cards: card is message-bound, wrong UX; rejected.

## Design

### Client (`packages/client`, `apps/web`)

- `new-agent.ts`: `roles: RoleId[]` batch state next to `role`; `batch = roles.length > 1`. Batch skips
  `identity`, `instructions`, `tools`; rail shows role → where → model → review. `stepAfter`/`skipped` already
  supports per-flow skips (PERSONAL_SKIPPED_STEPS precedent).
- Role step: cards toggle selection (checkbox affordance, kit styling); "custom" card excluded in batch mode
  (selecting it clears batch or is disabled with 2+ picks — builder's call, prefer disabled + hint).
- Where step (batch): one channel picker + audience applied to all agents. Each agent additionally joins the first
  existing channel matching its role's `presetChannels` hints (same rule as single mode); the review lists the
  resulting per-agent channels read-only.
- Model step (batch): unchanged — one plan/account/budget for all (the point of the feature: same OpenCode Go etc.).
- Review step (batch): list of the N agents (face, name, @handle, role) + shared config summary + "Criar N agentes".
- Submit: `api.agents.createBatch` → per returned agent, loop the same post-steps as single submit (setTarget,
  setBrain with the shared plan, setChannels with shared+preset channels, saveLevels from `presetLevels`,
  skills.setForAgent defaults), each failure collected like `savePart` today. Success screen lists the created
  agents with links; partial failures toast per agent.

### Server / engine

- `POST /organizations/{orgId}/agents/batch` (`apps/server/src/routes/app/agents.ts`): body
  `{ agents: [{ name, role, instructions, appearance?, setup? }], shared?: { ownerUserId?, audience?, credentialId?,
  monthlyBudgetUsd?, autonomy?, handle? } }` — `handle` optional per agent; server derives from name when absent.
- Engine `createAgents` (`packages/engine/src/agents.ts` or `agents-batch.ts`): one transaction; per item resolve
  handle (`takenHandles` + `freeHandle`-style suffix against DB and earlier items), then `createAgent` with
  `NEW_AGENT_DEFAULTS`; shared fields applied to each row. Returns created agents in request order.
- Permission/audience handling mirrors the single route (restricted roles born owner-only until audience set —
  batch applies shared audience after creation via `setAgentAudience` per agent inside the same flow, or pass
  `audienceMode` per item like single create does).

### i18n / copy

- Keys under `newAgent.batch.*`: selection hint, review title, "Criar N agentes", per-agent failure toast, success
  summary. No semicolons, no em dashes (house rules).

## Verification

- Engine test: `createAgents` creates N agents atomically, dedupes handles, enforces permissions, rolls back on
  mid-batch failure.
- Client tests: batch step skipping, role multi-select state, review payload.
- Route test: batch endpoint happy path + forbidden.
- `bun test` focused files, typecheck, biome, boundaries, geometry check.
- Manual: pick 3 templates → create → verify agents, handles, channels, brain.

## Builder's calls (made, reversible)

- Batch skips identity/instructions/tools steps entirely; templates fill them.
- Template channel hints auto-apply (first match) plus shared picks; mail and routines skipped.
- Skills library defaults apply per agent (`defaultForNewAgents`), same as single.
- `custom` role cannot join a batch.
