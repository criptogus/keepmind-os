# KeepMind OS — Implementation Plan (Strategy → Ship)

Derived from the competitive analysis of `keepmind-os` (v0.1.9). Goal: make it
**unique** (governed agent workspace), **effortless** (Cmd+K, templates,
plain language), **powerful** (dry-run, receipts, plugins, smart routing) and
**open source** (MIT, reproducible builds, community skills).

Sequence is ordered by leverage: governance trust first, then ease of use,
then ecosystem, then distribution.

---

## Phase 1 — Predictive governance (the moat)

Governance today is *reactive* (approve each sensitive tool call). Phase 1
makes it *preventive*: see the plan before anything executes, and produce
exportable proof of what happened.

### 1.1 Dry-run / simulation mode

Agents run normally, but every tool call is intercepted and **never
executed** — the model receives a simulated result describing what it would
have done. The output is a concrete action plan a human can approve.

- `src/main/tools/registry.ts`
  - `ExecutionPolicy.dryRun?: boolean`
  - `ToolRegistry.execute()`: when `policy.dryRun`, return
    `[dry-run] would execute <name> with <args summary>` before the gate and
    before the handler. No approvals are created, nothing runs.
- `src/main/agent/AgentManager.ts`
  - `executeAgent(..., opts?: { dryRun?: boolean })` → merges `dryRun` into
    `execPolicy`; marks `execution.output.dryRun = true` and appends a
    `plannedActions` list collected from tool_call events.
- `src/main/main.ts`
  - `runAgentExecution(agentId, input, opts?: { userId?; dryRun? })`
  - IPC `agents:executeDryRun` → same path with `dryRun: true`, audit action
    `agent_dry_run`.
- `src/preload/preload.ts` → `executeAgentDryRun(id, input)`.
- Renderer
  - `AgentExecutionView` / `AgentList`: "Simulate" (dry-run) button next to
    Run; execution cards badge `DRY-RUN`; plan view lists planned actions.
  - i18n keys (en/pt).

**Acceptance:** running an agent with file_write/shell_exec tools in dry-run
produces a final answer + list of would-be actions, zero side effects, zero
approval prompts, audit entry marked `dry_run`.

### 1.2 Audit receipts (exportable proof)

- `src/main/storage/StorageManager.ts`
  - `getAuditLogs` already exists; add `exportAuditReceipt(filters)` building
    a JSON receipt: entries + SHA-256 hash chain (`prevHash → entryHash`),
    generated-at timestamp, app version, filter metadata.
- `src/main/main.ts` + preload
  - `audit:exportReceipt` → `dialog.showSaveDialog` (.json) and
    `audit:exportReceiptHtml` → printable HTML receipt (browser-print to PDF).
- `src/renderer/components/logs/AuditLogs.tsx`
  - "Export receipt" button (JSON / PDF-ready HTML). Plain-language explainer.

**Acceptance:** exported JSON verifies chain integrity; HTML renders a clean,
branded receipt suitable for compliance review.

---

## Phase 2 — Effortless UX

### 2.1 Command palette (Cmd/Ctrl+K)

- `src/renderer/components/common/CommandPalette.tsx` (new)
  - Mantine Modal + searchable command list; fuzzy filter.
  - Commands: navigate to every section, "New agent from template…",
    "Run agent…" (pick agent + prompt), "Go to approvals", toggle theme,
    open settings. All actions reuse existing stores/navigation.
- `src/renderer/App.tsx`
  - Global `mod+k` listener, palette state, `onNavigate` wiring.
- i18n keys for palette strings.

**Acceptance:** Cmd+K opens palette anywhere; every sidebar destination and
the top-3 daily actions are reachable in ≤2 keystrokes.

### 2.2 Niche template packs

`src/renderer/lib/agentTemplates.ts` already groups role templates. Extend
with ready-made **team-in-a-box** packs per niche (BR-friendly first):

- `legal` (advocacia): intake, research, drafting, deadline controller
- `clinic` (clínica/saúde): scheduling assistant, patient comms, billing
- `accounting` (contabilidade): reconciliation, fiscal deadlines, reports
- `realestate` (imobiliária): lead qualification, listings, follow-up
- `personal` (pessoal): family admin, learning, finances

Each pack = array of `AgentTemplate`s sharing a `group` + `pack` id so the
creation picker can offer "install pack" (creates N agents + optional team).
Team creation reuses `teams:create`.

**Acceptance:** a new user in "personal" or "corporate" mode can install a
niche pack and get a working multi-agent team in one click.

---

## Phase 3 — Open-source ecosystem

### 3.1 Skill marketplace

- `docs/skills-marketplace.json` (new, in-repo curated manifest)
  - Entries: `{ name, description, source (github url or local path),
    tags, audience, version }`. Community PRs add entries — the manifest IS
    the marketplace index.
- `src/main/integrations/SkillImporter.ts`
  - `listMarketplace()` reads the bundled manifest; reuse existing GitHub
    import path for `source`.
- `src/main/main.ts` + preload → `skills:listMarketplace`,
  `skills:installMarketplace(id)`.
- `src/renderer/components/skills/SkillsPanel.tsx`
  - "Explore" tab: searchable marketplace grid, Install button, provenance
    badge. Reuses existing import UI patterns.

### 3.2 Plugin manifest + local import

Formalize the de-facto plugin format: a folder with `plugin.json`
(`{name, version, description, skills: [{file}]}`) or a single `SKILL.md`.

- `src/main/integrations/SkillImporter.ts`
  - `importFromFolder(path)` — validates manifest, imports text-only skills,
    records `source: 'local:<path>'` provenance.
- IPC `skills:importFolder` + SkillsPanel "Import from folder" button
  (directory picker via `dialog.showOpenDialog`).
- `docs/PLUGINS.md` — authoring guide so external devs can publish plugins.

**Acceptance:** `npx degit`-style community plugin folders install with one
click; marketplace entries install from the Explore tab.

---

## Phase 4 — Smart routing by outcome

Routing today uses keyword heuristics + task-complexity. Upgrade to
**outcome-weighted routing**: prefer models/skills that historically
produced successful executions for similar tasks.

- `src/main/agent/AgentManager.ts` already emits `UsageRecord` and execution
  status; `MemoryManager` already weights recall by outcomes.
- `src/main/main.ts` model/skill routers:
  - Load per-agent/per-skill success stats (executions joined to routing
    decisions) and feed as a prior into `routeModelForTask` /
    `autoSkillSelector` scoring; log the blended reason in
    `RoutingDecision.reason`.
- Storage: reuse `agent_executions` + `routing_decisions` tables; add
  `storageManager.getOutcomeStats(scope)` helper if needed.

**Acceptance:** routing decisions cite outcome history in `reason`; agents
with chronically failing models get rerouted to better performers, visible
in the routing log.

---

## Phase 5 — Distribution & remote trust

### 5.1 Remote approvals (LAN companion)

Human-in-the-loop breaks when you're away from the desk. Add a minimal,
opt-in local HTTP server:

- `src/main/approvals/RemoteApprovalServer.ts` (new)
  - `node:http` server bound to LAN interface, random port, token in URL.
  - Serves a single self-contained HTML page (no build step): lists pending
    approvals, Approve/Reject buttons → POST back to same server.
  - Token-gated; only exposes approvals (no other data); toggle in Settings.
- Settings UI: "Remote approvals" card with start/stop, QR/link copy.

**Acceptance:** opening the link on a phone on the same Wi-Fi shows pending
approvals and decisions sync to the desktop queue.

### 5.2 Code signing & notarization

Cannot ship certs, but can remove all friction:

- `build/` + `electron-builder` config: `mac.identity`, `hardenedRuntime`,
  `notarize` via `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`
  env vars; `win.certificateFile`/`CSC_LINK` support.
- `.github/workflows/release.yml`: document secrets, add unsigned→signed
  path selection.
- `docs/RELEASE.md`: step-by-step signing guide (Apple Developer + Azure
  Trusted Signing for Windows).

**Acceptance:** maintainer with certs runs `npm run dist:mac` and gets a
notarized, Gatekeeper-clean DMG; without certs, current unsigned flow still
works.

---

## Explicitly out of scope (for now)

- True multi-user workspaces/cloud sync — LocalAuth roles already exist;
  revisit after remote approvals prove demand.
- Mobile native apps — the LAN approvals page covers the critical mobile
  moment without app-store overhead.
- Windows/Linux as primary targets — keep `dist:win` working, macOS first.

## Cross-cutting requirements

- Every user-facing string goes through `i18n.tsx` (en + pt).
- No new runtime dependencies unless justified (palette/receipts/server are
  dependency-free).
- `npm run typecheck` + `npm test` green after each phase.
- Audit-log every governance-relevant action (dry-run, receipt export,
  marketplace install, remote approval).
