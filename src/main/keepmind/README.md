# KeepMind OS main-process sidecar

The current app uses `CompanyBrains` to bind agents to company-specific
`KeepMindService` instances. Configure it in Advanced → Separate company memory,
or the headless workspace's `companyBrains` array. No sidecar starts without an
explicit administrator binding. Changing a binding disposes the previous service.
Agent/tool input cannot choose a company or endpoint.

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

The desktop and headless runner check required company memory before provider
execution. Context retrieval and secondbrain_search use only the bound service;
secondbrain_remember is denied for bound agents. Unbound agents retain the existing
optional global Second Brain behavior. Company binding scopes this connector, not
all independently granted tools or personal memory permissions.

Authorized context becomes part of normal execution/checkpoint data in the local
workspace. The connector audit contains no snippets; it is not a claim that all
workspace storage is content-free. Existing encrypted unlock support must be
provided by the operator's compatible MCP launcher; the app does not accept vault
passphrases or enable plaintext fixtures through the UI. No live encrypted vault
was available during migration tests.

The retained `zaos-` client prefix and flat mcp-scopes.json preserve the legacy
upstream contract. Packaged sidecar discovery, encrypted unlock descriptor
lifecycle and audit rotation remain external/future work, as in the old PR.
