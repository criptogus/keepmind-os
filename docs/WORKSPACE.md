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
- Interrupted executions become failed/blocked on restart. They are NOT replayed:
  verify external effects before retrying. Transparent checkpoint resume is not
  implemented in this version.
- Approvals remain available in personal and corporate modes and wait up to 24
  hours while the process runs. On restart pending approvals are rejected; create
  a new execution after reviewing state. This is not restart-resumable approval.
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

State defaults to `~/.keepmind/runner`; use `--data-dir` to change it. The runner
uses separate data from the desktop; there is no automatic cross-device sync.
One process may own a data directory. After a crash, inspect processes before
removing `runner.lock`. A server running this process can keep schedules active
when your laptop is off; a sleeping or powered-off runner cannot execute work.
Use your own process supervisor for service management. No network API is exposed.

## Design references

Independent implementation informed by the public product descriptions of:

- Kortix CompanyOS: one entry point, work attached to persistent context.
- agentes.chat: contextual review and explicit learning from corrections.
- Paperclip: tasks, goals, dependencies, budgets and reviewable work products.

No source or branding from these projects was copied. This change retains MIT.
This is not feature parity with their cloud computers, collaboration or plugins.

## Remaining engineering work

- Durable per-step checkpoints and resumable approvals after process restart,
  with reconciliation of unknown external effects.
- A common desktop/server execution service and authenticated multi-device sync.
- First-class MCP/harness adapters, an extension API and trusted plugin packaging.
- Shared channels and multiplayer editing with resource-scoped authorization.
- Structured source provenance, typed commitment/decision relationships and
  scalable vector retrieval across large vaults.
- Per-routine autonomy policies, approval previews/diffs and reversible actions.
- Signed/notarized macOS and Windows distribution (requires signing identities).

These are not advertised as shipped features. keepmind.io should describe the
released version until a tested release includes this work.
