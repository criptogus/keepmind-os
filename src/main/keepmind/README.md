# KeepMind OS main-process sidecar

Construct `createCompanyKeepMind(dataRoot, workspace, { node, keepmindPackageRoot })`
in the main process and inject it as the optional last Orchestrator constructor
argument. No sidecar is started without explicit configuration. A workspace company
change requires a fresh service; the orchestrator blocks mismatched company IDs.
Dispose the service on workspace shutdown.

`dataRoot/companies/<companyId>/memory` is the company's separate vault.
`dataRoot/keepmind/zaos-<companyId>/scopes.json` contains exactly one client.
`dataRoot/keepmind/audit.jsonl` is the OS's content-free audit trail outside
all vaults. Unknown tool names are normalized in audit records to avoid echoing
arbitrary input. Denied paths are hashed, never logged verbatim.

The gate rejects all arguments outside each tool's schema, including forged
identity, space and vault fields. Only search/read aliases and sb_search,
sb_read, sb_list and sb_recent are permitted. Absolute paths, traversal and
symlinked ancestors fail closed. Documents require explicit public/internal
classification and the exact company space; duplicate, unknown, missing or
higher classification and overrides are denied. Credential/PII elevation
matches the upstream reader. Every listing/search candidate is re-read through
the transport and independently authorized by the OS. Raw transport snippets
and metadata are never forwarded. Paths are rechecked under the company root.

The subprocess uses newline-delimited MCP JSON-RPC, initialization, bounded
request timeouts, and sanitized failures. No ports are opened. Environment is
explicitly assembled by the launcher; agent/tool arguments cannot set it.
The scopes path and unlock material must never reach LLM/agent instructions.
Plaintext is disabled unless `allowPlaintextFixtures: true` is deliberately set
for synthetic fixtures. No passphrases or keys are stored in this repository.

Compatibility with KeepMind main 097f02fb: its CLI expects the client map at the
JSON root rather than under `clients`. `mcp-scopes.json` is a private equivalent
single-client map written beside the canonical wrapped scopes file. The
upstream MCP also keeps its own hashed access ledger under `memory/ops`;
OS audit records are separate and outside the vault. Note writes remain denied.

The orchestrator checks health and company binding before creating a task,
changing run counters, or calling the board/provider. Failure returns a blocked
result without vault text. Optional search/citations are deferred because the
current execution path persists instructions and task descriptions in Paperclip.
No snippets are persisted by this integration.

P1: encrypted unlock descriptor/keychain lifecycle, upstream external audit path
configuration, ephemeral per-run citations that bypass Paperclip/PG storage,
audit rotation/correlation, packaged sidecar discovery and live desktop validation.
