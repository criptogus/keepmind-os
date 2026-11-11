# KeepMind OS — Multi-user & corporate governance (design)

Date: 2026-11-11
Status: draft — awaiting approval

## Intent and why

KeepMind OS today is single-user: whoever installs it owns everything. The
goal is a corporate deployment where each employee installs the app on their
own machine, an admin controls who can do what, members can *use* shared
agents (e.g. run the CMO agent) without being able to create or modify them,
and agents reach the corporate second brain (KeepMind Corp) under explicit
read/write governance — including a read-only mode backed by GitHub
credentials that cannot push.

## What exists today (verified)

**KeepMind OS (this repo)**
- Local SQLite (`StorageManager`), agents/skills/teams, governance approval
  gate for sensitive tools, audit log, WhatsApp history, triggers.
- `SecondBrainManager` calls corp `POST /api/mcp/call` with a Bearer sync
  token stored in `CredentialStore`.
- No user accounts, no roles, no login.

**KeepMind Corp (`criptogus/keepmind-corp`, inspected via GitHub)**
- Members with roles `owner`/`admin`/`member`, teams, `/api/members` CRUD,
  OIDC login, org policy with autonomy ceiling, audit log.
- MCP tools exposed: `sb_search`, `sb_read`, `sb_append`, `sb_list`.
- Sync tokens (`ops/sync-tokens.json`, hashed) with scopes
  `mcp:invoke`, `memory:export`, `memory:import`. `mcp:invoke` currently
  covers **all** MCP tools including `sb_append` (write).
- GitHub vault sync uses a single `github` org secret (PAT) for both read
  and write.

**Bug found during recon**: `SecondBrainManager.remember()` calls
`sb_remember`, which does not exist on the corp — it now maps to
`sb_append` on `inbox/keepmind-os-captures.md` (fixed in this branch).

## Goals

1. Local roles in KeepMind OS: `owner` / `admin` / `member`.
2. First-run creates the owner; admins manage member profiles.
3. Members can chat/execute agents marked **shared**, but cannot create,
   edit, delete agents, skills, governance rules, or change settings that
   affect governance.
4. Second brain access is scope-aware: a read-only token/agent can search
   and read but never append.
5. Corp server gains `mcp:read` scope and a read-only GitHub secret path.

## Non-goals (this phase)

- No corp login/OIDC inside the OS yet (phase 2).
- No agent catalog sync from corp `/api/agents` yet (phase 2).
- No remote invites — members are created locally by an admin (phase 2
  replaces this with corp `/api/members`).
- No SSO, no password hashing hardening beyond a salted SHA-256 for local
  profiles (phase 2 moves auth to corp OIDC).

## Anti-goals

- Do NOT let a member escalate by editing `config.tools` — tool grants on
  shared agents are frozen at publish time.
- Do NOT store second-brain write capability in the agent prompt; it must
  be enforced by token scope + local tool filtering.

## Approaches considered

- **A — OS as corp client from day one**: rejected for phase 1; depends on
  corp deployment, OIDC, network. Kept as phase 2.
- **B — local RBAC only**: rejected; no central governance, admin can't
  control installs.
- **C — phased (chosen)**: phase 1 = local roles + scoped second-brain
  token + corp patch for `mcp:read`/`github_readonly`; phase 2 = corp
  login + shared agent catalog.

## Phase 1 design

### OS — local identity (`src/main/auth/LocalAuth.ts`, new)

- `users` table: `id, email, name, role, password_hash (salted sha256),
  created_at, created_by`.
- First launch with zero users → onboarding creates `owner`.
- Login screen before main window when users exist; session token in
  memory (renderer gets `currentUser` via IPC; no persistent session —
  acceptable for a local app, revisit in phase 2).
- `requireRole(min)` helper used by every mutating IPC.

### Permission matrix (enforced in IPC layer)

| Capability | owner | admin | member |
|---|---|---|---|
| create/edit/delete agents | ✓ | ✓ | ✗ |
| execute any agent | ✓ | ✓ | shared only |
| create/edit skills | ✓ | ✓ | ✗ |
| governance rules/approvals | ✓ | ✓ | view + approve own? → view only |
| settings (LLM keys, second brain) | ✓ | ✓ | ✗ |
| WhatsApp connect/send | ✓ | ✓ | ✗ |
| triggers | ✓ | ✓ | ✗ |
| audit logs | ✓ | ✓ | own executions only |

Member CAN: chat with shared agents, view audit of own runs, use
read-only tools the agent already has.

### Shared agents

- `agents` table gains `is_shared INTEGER DEFAULT 0`, `shared_by`,
  `shared_at`. Only owner/admin can toggle.
- On share, the agent's `config.tools`/`skillIds` are snapshotted —
  member execution uses the frozen config; edits by admin afterwards do
  not retroactively change what members can run (they see a "published
  version"). Simplest correct version: sharing marks the agent; member
  executions always use current config but members cannot edit — accept
  that admins editing a shared agent changes member-visible behavior
  (documented; versioning is phase 2).

### Second brain scopes

- OS `secondbrain` config gains `access: 'read' | 'write'` (default
  `write` for backwards compat).
- `read` mode: `secondbrain_search`/`secondbrain_read` allowed;
  `secondbrain_remember` removed from enabled tools at execution time
  (AgentManager filters by a per-execution capability, not just config).
- Enforcement is **defense in depth**: (a) corp token minted with
  `mcp:read` scope rejects `sb_append` server-side; (b) OS filters the
  tool list; (c) governance gate can require approval for remember.

### Corp patch (`criptogus/keepmind-corp`)

- `sync-tokens-store.mjs` / token mint: add scope `mcp:read`.
- `server.mjs` `syncTokenAllows`: `mcp:read` permits GET `/api/mcp/tools`
  and POST `/api/mcp/call` only for tools in a read allowlist
  (`sb_search`, `sb_read`, `sb_list`); `sb_append` requires `mcp:invoke`.
- Mint route accepts `scopes` input validated against the allowlist.
- GitHub sync: new optional org secret `github_readonly`. When set,
  `github-sync.mjs` uses it for `getFileMeta`/`listDir` (reads) and the
  full `github` token only for `putFile` (writes). A deployment can then
  run a read-only mirror by configuring only `github_readonly` +
  disabling push, or split read/write credentials properly.
- Tests in `tests/` for scope enforcement and token mint validation.

### Migration

- `users` table created lazily; existing installs get a single `owner`
  user with empty password → forced password set on next launch (or
  treated as "local owner, no login" until a second user is added —
  simpler: if `users` is empty, skip login entirely and act as owner;
  creating the first member prompts to create the owner account).

## Computer access control (added 2026-11-11)

Settings let the owner/admin choose how much of the machine agents may
touch — independent of which tools an agent has enabled.

### Levels (`computer.access` setting)

| Level | file_read/list | file_write | shell_exec | open_url |
|---|---|---|---|---|
| `workspace` (default) | workspace dir only | workspace dir only | disabled | gated |
| `authorized` | workspace + admin-approved roots | same | allowlist/denylist rules | gated |
| `full` | any path | any path | unrestricted | gated |

- `authorized` roots: list of absolute dirs managed in Advanced Settings
  (`computer.allowedRoots`, JSON in settings). File tools resolve paths
  against workspace ∪ allowedRoots; traversal outside is rejected (same
  `escapes` check as today, extended to the root set).
- `authorized` shell: `computer.shellAllow` (prefix allowlist, e.g.
  `git `, `npm `, `python3 `) and `computer.shellDeny` (regex/substring
  denylist, always including catastrophic patterns like `rm -rf /`).
  Empty allowlist in `authorized` mode = shell disabled.
- Per-agent narrowing: `AgentConfig.computerAccess?: 'workspace' |
  'authorized' | 'full'` may only *reduce* below the install ceiling —
  an agent can never exceed `computer.access`. Effective level =
  `min(agent, install)`.
- Enforcement is in `ToolRegistry`/`AgentManager` (main process), never
  in the renderer; the model only sees tools it can actually use.

### Interaction with roles

- `member` executions are always capped at `workspace` + no `shell_exec`
  regardless of install level — a shared agent's frozen tools still pass
  through the member cap. This keeps "execute shared agent" safe on a
  personal machine.
- `owner`/`admin` may run agents at the install ceiling.

### UI

Advanced Settings → new "Computer access" card: level select, allowed
roots editor (add/remove dir), shell allow/deny lists, and a per-agent
override dropdown in AgentForm (only shows levels ≤ install ceiling).

## Corporate vs personal brain (added 2026-11-11)

Two strictly separated knowledge stores:

- **Corporate brain** = KeepMind Corp server (`secondbrain_*` tools).
  Only corporate-safe content may be written. `secondbrain.access`
  (`read`|`write`) + corp `mcp:read` token scope enforce read-only mode.
  A PII guard (`secondbrain.blockPii`, default on) rejects obvious
  personal identifiers (CPF, personal phone, card-like numbers) in
  `remember()`/`sb_append` content — emails are allowed since corporate
  addresses are legitimate.
- **Personal brain** = local vault at `userData/personal-brain/*.md`
  (`personalbrain_search`/`personalbrain_remember` tools). Never leaves
  the machine unless the user explicitly syncs it.

### Corporate GitHub access request

The corp vault syncs to a GitHub repo. A member can request access:

- `brain:requestGithubAccess` IPC creates a pending request
  `{ userId, githubUsername, level: 'read'|'write' }` stored in settings.
- Owner/admin sees requests in Advanced Settings and approves/rejects.
- On approve, the app runs `gh api -X PUT
  repos/{owner}/{repo}/collaborators/{username}` with `permission:
  pull|push` (requires `gh` auth on that machine — documented). The
  corp-side repo owner/repo comes from corp settings
  (`github-sync` config is admin-managed on the corp server; the OS
  stores `corp.githubRepo` for display/invites).
- Requests and decisions are audit-logged.

### Personal GitHub brain (optional)

- Setting `personalBrain.githubRepo` (`owner/repo`). "Connect" button
  runs `gh repo create <repo> --private --source <vault> --push` if the
  repo doesn't exist, then `git pull --rebase && git push` for sync.
- Agents keep using local files; sync is user-triggered (no daemon in
  phase 1).

## Phase 2 (documented, not built now)

- "Login with company": OIDC against corp `/api/oidc/start`; session →
  corp roles/teams drive local role.
- Agent catalog: pull `/api/agents` + `/api/teams` published agents into
  a read-only "Company agents" section; executions attributed to corp
  user id in audit.
- Invites via corp `/api/members` instead of local creation.
- Versioned published agent snapshots.

## Open questions for builder

- Local password storage: salted SHA-256 is fine for a local-first app
  but weak; phase 2 OIDC removes it. Acceptable?
- Should `admin` be able to create other admins? Proposal: only owner
  promotes to admin; admin creates members only.
- Member approval rights: proposal — members cannot decide approvals at
  all in phase 1 (approvals are owner/admin only); simpler and safer.
