# Batch Agent Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create several agents from ready-made role templates in one pass through the existing "Criar agente" wizard.

**Architecture:** The role step becomes multi-select; 2+ picks switch the wizard to batch mode (role → where → model → review). A new engine `createAgents` runs `createAgent` per item inside one transaction with server-side handle dedupe; a new `POST /organizations/{orgId}/agents/batch` route exposes it. The client then loops the same post-creation calls single-create uses (brain, channels, levels, skills), best-effort per agent.

**Tech Stack:** Bun/TypeScript, Hono OpenAPI routes, Drizzle/PGlite, React wizard in `apps/web`, i18n via `packages/client` locales.

**Spec:** `docs/superpowers/specs/2026-11-18-batch-agent-creation-design.md`

## Global Constraints

- House copy rules: no semicolons, no em dashes in product copy; i18n keys in en + pt-BR sources, then 12 locales + `identical.json`.
- UI kit numbers only (tokens, no raw px for spacing/heights); geometry check must stay green.
- `custom` role never joins a batch.
- Single-agent flow (1 pick) must remain byte-for-byte behaviorally identical.
- Personal workspaces keep `PERSONAL_STARTERS` flow untouched.
- Engine transactions: pass `tx as unknown as Database` like `createTeam` does (`team-proposals.ts` ~line 560).

## Review Focus

- Two templates whose names slug to the same handle (e.g. `people` vs `exec_people` both "People"): server must suffix, never 409 the whole batch.
- A mid-batch `createAgent` failure (permission, budget, invalid field): whole transaction rolls back, route returns the coded error, nothing partial persists.
- Batch on a workspace where the shared AI plan can't be saved for one agent: that agent still exists; post-step failure toasts per agent, flow still ends on the created list.
- 30+ roles selected: review list and role grid must not break layout (break-ui worst case).
- Restricted roles (`RESTRICTED_ROLE_IDS`) in a batch: their empty `levels` presets apply; no implicit connections.

---

### Task 1: Engine `createAgents`

**Files:**
- Modify: `packages/engine/src/agents.ts` (append near `createAgent`, ~line 490)
- Test: `packages/engine/test/agents-batch.test.ts` (create)

**Interfaces:**
- Consumes: `createAgent(db, actorId, orgId, input, NEW_AGENT_DEFAULTS, options)`, `takenHandles(db, orgId)`, `freeHandle(base, taken)` (both already exported from `./agents`), `setAgentAppearance`, `setAgentAudience` (check exact signatures in `agent-appearance.ts`/`audience.ts` before use).
- Produces:

```ts
export interface BatchAgentItem {
  name: string;
  handle?: string;
  role?: string;
  instructions?: string;
  appearance?: AgentAppearance | null;
  setup?: { role: string | null } & SetupExtras;
}

export async function createAgents(
  db: Database,
  actorId: string,
  orgId: string,
  items: BatchAgentItem[],
  shared: Omit<AgentInput, "name" | "handle" | "role" | "instructions"> & {
    autonomy?: CommandApproval;
    audienceMode?: Agent["audienceMode"];
    audience?: AgentAudience;
  },
  defaults: { model: string },
  options: { remember?: boolean; via?: string; pubsub?: PubSub } = {},
): Promise<Agent[]>
```

- [ ] **Step 1: Write failing tests** in `packages/engine/test/agents-batch.test.ts` using the `setup()` fixture pattern from `endpoints.test.ts`/`agent-proposals.test.ts`:
  - creates N agents in order, each with its own name/role/instructions/appearance/setup
  - shared fields (ownerUserId, credentialId, monthlyBudgetNanoUsd, autonomy, audience) land on every row
  - handle dedupe: two items with same base handle → second gets `-2` suffix; collision with existing agent also suffixes
  - item without handle derives one from name (slug: lowercase, non `[a-z0-9_-]` → `-`, trim `-`, fallback `agent`)
  - mid-batch failure (e.g. second item invalid) → zero agents persisted (transaction rollback)
  - non-admin creating for another ownerUserId → ForbiddenError (inherited from createAgent)
- [ ] **Step 2: Run tests, verify they fail** — `bun test packages/engine/test/agents-batch.test.ts`
- [ ] **Step 3: Implement `createAgents` + `slugHandle` helper** in `agents.ts`. Inside `db.transaction`: load `takenHandles` once, per item resolve handle (`item.handle?.toLowerCase() ?? slugHandle(item.name)`, then `freeHandle` against taken ∪ batch-so-far), call `createAgent(tx as unknown as Database, ...)` with `{...sharedFields, ...itemFields, handle}`, apply `setAgentAppearance`/`setAgentAudience` per item when present (verify those functions accept a tx), collect `Agent`s, return in order. Empty `items` → ValidationError.
- [ ] **Step 4: Run tests, verify pass** + `bunx tsc --noEmit -p packages/engine`
- [ ] **Step 5: Commit** `feat(engine): batch agent creation`.

### Task 2: Batch route

**Files:**
- Modify: `apps/server/src/routes/app/agents.ts` (after the single `POST /agents` route, ~line 1060)
- Test: extend the existing agents route test file (find via `grep -rln "agents" apps/server/test | head`)

**Interfaces:**
- Consumes: `createAgents` from Task 1, `AgentFields` zod schema (line ~173), `budget()` helper, `setAgentAudience`, `publishAgentsChanged`.
- Produces: `POST /organizations/{orgId}/agents/batch` → `201` `{ agents: Agent[] }`.

Request body:

```ts
{
  agents: Array<{
    name: string; handle?: string; role?: string; instructions?: string;
    appearance?: AgentAppearance | null;
    setup?: { role: string | null; hello?: string; starter?: string; apps?: Record<string, "read"|"write"> };
  }>  // 1..30 items
  shared?: Omit<AgentFields-shape, per-agent fields> // ownerUserId, audience, credentialId, monthlyBudgetUsd, autonomy, model, mediaReplies, brakes, approvalsLevel
}
```

- [ ] **Step 1: Failing route test** — POST batch with 2 agents + shared audience/credential → 201, both rows exist with shared fields; POST with 0 agents → 400; POST as member without `create_agents` → 403.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement route** mirroring the single-create route: validate body, call `createAgents(db, user.id, orgId, items, sharedMapped, NEW_AGENT_DEFAULTS, {remember: true, pubsub})`, apply shared `audience` via `setAgentAudience` per agent + `publishAgentsChanged` once, return `{ agents }`.
- [ ] **Step 4: Run tests + typecheck** (`bunx tsc --noEmit -p apps/server`)
- [ ] **Step 5: Commit** `feat(server): POST /agents/batch`.

### Task 3: Client API

**Files:**
- Modify: `packages/client/src/api/types.ts` (~line 1060, after `AgentInput`), `packages/client/src/api/http.ts` (or wherever `agents.create` lives), `packages/client/src/api/fake.ts`, `packages/client/src/api/queries.ts` (~line 782)
- Test: existing client/api tests if present

**Interfaces:**
- Produces:

```ts
export interface AgentBatchItemInput { name: string; handle?: string; role?: string; instructions?: string; appearance?: AgentLookInput | null; setup?: AgentInput["setup"] }
export interface AgentBatchInput { agents: AgentBatchItemInput[]; shared?: Omit<AgentInput, "name"|"handle"|"role"|"instructions"|"appearance"|"setup"|"proposal"> }
// api.agents.createBatch(orgId, input: AgentBatchInput): Promise<{ agents: Agent[] }>
// useCreateAgents(orgId) mutation — same invalidations as useCreateAgent
```

- [ ] **Step 1: Add types + http method + fake implementation + query hook** following the `create`/`useCreateAgent` pattern exactly.
- [ ] **Step 2: Typecheck client** (`bunx tsc --noEmit -p packages/client`)
- [ ] **Step 3: Commit** `feat(client): agents.createBatch API`.

### Task 4: Batch state helpers in `new-agent.ts`

**Files:**
- Modify: `packages/client/src/lib/new-agent.ts`
- Test: `packages/client/test/new-agent.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
export const BATCH_SKIPPED_STEPS: readonly NewAgentStep[] = ["identity", "instructions", "tools"];
export interface BatchDraft { roleId: RoleId; name: string; agentName: string; instructions: string; look: RoleLook; handleBase: string; channels: string[] /* preset channel ids */; levels: Record<string, Level> }
export function batchDrafts(roles: readonly RoleId[], t: TFunction, myChannels: {id:string;name:string}[], connectedIds: string[], personal?: boolean): BatchDraft[]
```

`batchDrafts` derives per role: `name`/`instructions` from `newAgent.roles.{id}.*` i18n, `look`/`levels`/`channels` from `ROLE_DEFAULTS` + `presetLevels`/`presetChannels`, `handleBase` via `handleForName(agentName)`. Exclude `custom`.

- [ ] **Step 1: Failing tests** — 2 roles → 2 drafts with correct i18n names, looks, preset channels (first existing match per role), levels only for connected apps; `custom` filtered out; empty → [].
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run + typecheck. Commit** `feat(client): batch draft helpers`.

### Task 5: Wizard batch UI

**Files:**
- Modify: `apps/web/src/pages/NewAgentPage.tsx`, `apps/web/src/styles/` (find the new-agent stylesheet via `grep -rn "newag__role" apps/web/src --include="*.css" -l`)
- Test: existing NewAgentPage tests if any (`grep -rln "NewAgent" apps/web/test packages/client/test`)

**Interfaces:**
- Consumes: `batchDrafts`, `BATCH_SKIPPED_STEPS` (Task 4), `api.agents.createBatch`/`useCreateAgents` (Task 3).

Behavior:
- `role` step: cards toggle a `picked: RoleId[]` set; `aria-pressed` reflects membership; picking a 2nd role enters batch mode (rail skips identity/instructions/tools via existing `skipped` mechanism — merge `BATCH_SKIPPED_STEPS` when `picked.length > 1`); `custom` card disabled with hint when batch active.
- `where` step (batch): existing channel picker + audience apply to all; per-agent preset channels computed at submit.
- `model` step: unchanged, shared.
- `review` step (batch): list of drafts (face, name, @handle, role) + shared config summary + submit label `newAgent.batch.create` with count.
- `submit` (batch): build `AgentBatchItemInput[]` from drafts (handles deduped client-side against loaded taken handles + each other via `freeHandle`), call `createBatch`, then per agent loop: `setTarget`+`setBrain` (shared plan/start), `setChannels` (shared picks + that role's preset first-match channel), `saveLevels` (`presetLevels` per role), `skills.setForAgent` defaults — each wrapped in the existing `savePart` failure collection.
- Success: `created` state becomes a list; success screen lists agents with links (adapt existing created view minimally).
- [ ] **Step 1: Implement UI + CSS** (selected-card style may already exist via `[aria-pressed]`; add `.newag__batch*` only where needed).
- [ ] **Step 2: Typecheck web + run related tests + geometry check** (`bun test scripts/geometry/check.test.ts`).
- [ ] **Step 3: Commit** `feat(web): batch agent creation in Criar agente`.

### Task 6: i18n

**Files:** `packages/client/src/i18n/locales/{en,pt-BR,…12}.ts` + `identical.json` (follow the exact pattern used for the SEO agent commit `24f8062` — check `git show 24f8062 --stat` for the file list).

Keys (en / pt-BR draft):
- `newAgent.batch.hint`: "Pick one or more ready-made roles" / "Escolha um ou mais papéis prontos"
- `newAgent.batch.create`: "Create {count} agents" / "Criar {count} agentes"
- `newAgent.batch.created`: "{count} agents created" / "{count} agentes criados"
- `newAgent.batch.customLocked`: "Custom can't join a batch" / "Personalizado não entra no lote"
- `newAgent.batch.reviewTitle`: "Your new team" / "Seu novo time"

- [ ] **Step 1: Add keys to en + pt-BR, run the locale sync script** used previously, **Step 2: locales test green** (only the 12 known pre-existing failures allowed), **Step 3: Commit** `feat(i18n): batch creation strings`.

### Task 7: Final verification

- [ ] `bun test` on touched packages' related test files
- [ ] `bunx tsc --noEmit` on engine, server, client, web
- [ ] `bunx biome check` on changed files
- [ ] boundary check (repo's boundaries script — find in CLAUDE.md commands)
- [ ] geometry check green
- [ ] Manual smoke: 3 templates → create → verify agents/handles/channels/brain in UI
