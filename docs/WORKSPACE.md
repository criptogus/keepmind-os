# Developer workspace

KeepMind OS is free, MIT-licensed software. There are no paid feature tiers,
KeepMind account requirements or hosted-service dependencies. Providers and
third-party integrations may charge for their own services.

## Work, not configuration

The Workspace opens with an outcome composer. Create a task with a project,
agent, acceptance criteria and optional task dependencies. The board separates
ready, running, review, accepted, blocked and cancelled work. Dependencies are
satisfied only by accepted deliveries. The details panel keeps output, execution
ID, comments and corrections together. A completed model call produces a review,
not an accepted outcome. Request a revision to retain the history and run again.

Repository review, release preparation and developer documentation templates are
included. They do not publish, deploy or merge automatically. Configure the
necessary agent skills and directory permissions for your repository.

Corrections can become proposed project rules. Activate or retire them explicitly.
Only active rules from the same project and task owner are sent to future runs.
Rules have revision counters and an audit trail. They do not grant permissions.

Export work creates a portable JSON document containing tasks, outputs and rules.
It contains your work content: review before sharing. It is not an agent-config
importer or a full backup. Settings → data export remains the full database backup.

## Execution guarantees and boundaries

- Tool governance fails closed on errors; tool allowlists are checked at execution.
- Agent identity and cancellation are scoped to each asynchronous run, including
  delegated runs. Cancellation prevents subsequent calls and aborts supported
  provider requests and shell subprocesses. Already-completed external effects
  cannot be undone; not every third-party SDK can abort an in-flight operation.
- Execution records are written before model calls and preserved on failure.
- Executions save provider responses and tool results in a local write-ahead
  journal. After restart, the task becomes blocked. **Resume checkpoint** rebuilds
  the conversation from saved responses and reuses completed tool results without
  invoking those handlers or billing cached model calls again. OpenAI API,
  Anthropic and the Codex OAuth tool loops are supported. The original config,
  tools, transport and input must still match; current tool permissions still apply.
- A handler marked started without a saved result has an **uncertain effect**.
  Resume stops at that step. An administrator must inspect the external system
  and record its verified result in the task drawer. This never retries the
  uncertain action. Reconciliation records the reviewer and timestamp. This
  conservative rule also applies to read-tool errors.
- Pending approvals tied to a not-yet-started checkpoint survive restart for up
  to 24 hours from creation. Exact arguments and execution bindings are checked
  again on resume. Legacy or expired approvals are rejected. Resume is explicit;
  approving an interrupted task does not silently start it. Cancelling rejects
  its pending approvals. Graceful shutdown preserves resumable approvals.
- A provider request interrupted before its response is saved may be requested
  again and charged again; partial text streams are not resumable. Delegated
  child executions are not recursively resumed: an uncertain delegation requires
  inspecting the child result and reconciling the parent. No exactly-once claim
  is made across external systems. A new revision starts a fresh execution and
  can repeat work, so verify previous effects before requesting one.
- Journals retain prompts, arguments and results in the same local database as
  work. They are included in database backups; no separate encryption or automatic
  retention policy is added by this change.
- Budgets are checked before each model call and include in-process reservations
  from concurrent calls. Usage is recorded per successful provider response.
  Prices and token estimates are not provider invoices. Calls without reported usage keep a conservative estimated ledger entry, marked partial. Failed streams may have
  billed usage that differs from that estimate. This is not a billing hard cap.
- Conditional workflows parse typed comparisons without eval; dependencies are
  validated for cycles before work begins. Failed sequential work stops the chain.

## Memory

Keyword recall searches the complete active corpus, not just the 500 newest items.
Results include memory IDs and validity dates. Transport success no longer trains
memory quality. Project rules learn only through explicit review.

Optional hybrid search combines keyword and vector rankings using reciprocal
rank fusion. Enable **Local semantic memory** in Settings and configure a model
served by your own OpenAI-compatible local server at
`http://127.0.0.1:11434/v1/embeddings` (for example an installed local embedding
model). KeepMind does not install or download it. The first search indexes up to
32 missing memories; later searches continue indexing. Vectors are cached by model,
memory ID and content hash. Offline or invalid responses fall back to keywords.
Retired memories are excluded. This is currently a linear scan, not a large-scale
vector database. Retrieved text can subsequently be sent to the chosen LLM.

## Free headless runner

Node.js >=24.11, no Electron window, Docker, database server or KeepMind cloud:

```sh
npm ci
# Set OPENAI_API_KEY or ANTHROPIC_API_KEY in your environment.
npm run runner -- --config examples/workspace.json --task "Review README.md"
npm run runner -- --config examples/workspace.json --watch
```

The versioned JSON config defines workspace, agents, models, budgets and interval
routines. Paths resolve relative to the config. Tools are read-only and restricted
to the workspace; shell, writes and external connectors are not enabled in this
initial runner. Results go to human review. Accept a result with:

```sh
npm run runner -- --config examples/workspace.json --accept TASK_ID
```

Inspect and resume interrupted work without starting a new task:

```sh
npm run runner -- --config examples/workspace.json --inspect TASK_ID
npm run runner -- --config examples/workspace.json --resume TASK_ID
# Only after verifying an uncertain effect; result.txt contains the actual result:
npm run runner -- --config examples/workspace.json --reconcile TASK_ID --step STEP_KEY --result-file result.txt
```

State defaults to `~/.keepmind/runner`; use `--data-dir` to change it. Local desktop
and runner databases remain separate. Connecting the desktop to a shared server
uses that server as the authoritative workspace; see [Shared workspaces](SHARED_WORKSPACES.md).
One process may own a data directory. After a crash, inspect processes before
removing `runner.lock`. A server running this process can keep schedules active
when your laptop is off; a sleeping or powered-off runner cannot execute work.
Use your own process supervisor for service management. `--serve` exposes the
authenticated workspace API; the default runner without that flag opens no port.

## Design references

Independent implementation informed by the public product descriptions of:

- Kortix CompanyOS: one entry point, work attached to persistent context.
- agentes.chat: contextual review and explicit learning from corrections.
- Paperclip: tasks, goals, dependencies, budgets and reviewable work products.

No source or branding from these projects was copied. This change retains MIT.
This is not feature parity with their cloud computers, collaboration or plugins.

## Remaining engineering work

- Recursive delegation/workflow checkpoints, partial-stream continuation and
  provider-side idempotency where supported. Explicit tool-loop resume is implemented.
- Offline replication/merge and streaming presence. The shared server, authenticated
  desktop connection and polling synchronization are implemented.
- Plugin signing/catalog and additional agent harness adapters. MCP stdio and
  Streamable HTTP tools are implemented with the pinned v1 SDK (2025-11-25 protocol).
- Rich shared channels and simultaneous document editing. Project/agent-scoped
  task collaboration with role checks and optimistic concurrency is implemented.
- Structured source provenance, typed commitment/decision relationships and
  scalable vector retrieval across large vaults.
- Automatic compensating actions and file-diff approvals. Routine draft/run policies
  and execution/tool-argument previews are implemented; arbitrary external effects
  are not automatically reversible.
- Execute and validate signed/notarized macOS and Windows builds with the owner's
  signing identities. The manual signed-artifact workflow is implemented and
  refuses unsigned fallback; credentials are not available in this workspace.

These are not advertised as shipped features. keepmind.io should describe the
released version until a tested release includes this work.

## Focused interface

The default **Now** view puts decisions and blocked work first. Completed and
cancelled work stays available through **Include completed**. Overview counters
filter the list; search and project filters apply together. **Board** remains an
optional view and omits empty columns. The task composer opens only for the first
task or **New task**; creation never starts execution automatically.

The task drawer shows an execution plan with the assigned agent, configured
model, currently available tools, monthly budget (when configured) and dependency
status. Auto-routing can change the model; this is not a cost quotation or a
permission grant. Dependencies must be accepted before running. Uncertain effects
must be reconciled before the resume button becomes available. Missing provider
credentials offer a direct route to connection settings.

**Cmd/Ctrl K** opens task/page search. Arrow Down moves into results; Tab and
Enter navigate and activate, Escape closes. The sidebar has four daily destinations
and a **More tools** disclosure for configuration and specialist screens. Narrow
windows collapse the sidebar behind **Menu**. Core content uses theme-aware colors,
visible keyboard focus and responsive task cards; activity history is expandable.
