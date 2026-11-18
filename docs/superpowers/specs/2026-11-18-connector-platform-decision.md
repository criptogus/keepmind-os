# Connector platform: build vs buy (Nango PoC decision)

Date: 2026-11-18. Status: decision record, no code.

## Finding that reframes the request

**Granola is already connectable.** `MCP_PRESETS` has `granola` → `https://mcp.granola.ai/mcp`
(`packages/engine/src/connectors/presets.ts`), not marked `soon`, and the server answers 401
with OAuth (checked 2026-11-18). The one-click flow the user asked for ("pedir Granola no chat →
conectar via OAuth") already exists for every vendor with an official remote MCP server.

The real gap is narrower: **products with a REST API but no official MCP server**. For those,
today the user must paste an MCP URL by hand or we need a way to generate one.

## What exists today

- Catalog connectors (github, sentry, linear): our scopes, our OAuth apps or vendor OAuth.
- `MCP_PRESETS`: ~90 one-click remote MCP servers, OAuth-DCR or open, with suggested tool
  classification. This is already "the connector catalog" the auto-creator would search.
- Custom MCP servers (`connectCustomServer`): any https MCP URL, probe → open / OAuth-DCR /
  needs_key, per-tool classification, per-connection credentials (sealed), revocation.
- `custom_tools` table + Tool Gateway: unlisted tools are never exposed; scopes and approvals
  enforced per agent.

## Options for "product X has no MCP server"

### A. Nango (self-hosted or Cloud)

- What it gives: managed OAuth for 1,300+ APIs (token refresh, connection storage), an
authenticated proxy, and TypeScript "functions" that wrap REST calls as tools. Effectively a
hosted connector runtime.
- License: Elastic License 2.0. Self-hosters running it for themselves is fine; **offering it
as a managed service inside keepmind.io Cloud is exactly what ELv2 restricts**. That is a real
constraint for our shared team server.
- Ops cost: whole platform (its own Postgres/Redis/services), or Nango Cloud (paid, another
subprocessor holding customer credentials — conflicts with our credential-sealing story).
- Fit: strong for OAuth breadth; weak fit for self-hosting story and license.

### B. Composio / Pipedream

- 1,000+ prebuilt toolkits, per-user sessions, triggers. Both are SaaS-first; Composio SDK is
already optionally supported (ADR 0107, `ComposioWay` presets, `COMPOSIO_API_KEY`). Pipedream
is a workflow product, not a tool gateway. Neither solves self-hosted OAuth for arbitrary APIs.

### C. Build: connector recipes + generated MCP wrapper (recommended direction)

The chat flow the user described maps onto what we already have plus one new piece:

1. Agent calls a `find_connector`/catalog search tool → preset hit? Return the connect card.
2. No preset → agent researches the product's API (docs MCP like Context7, or web) and proposes
   a **connector recipe**: REST endpoints → tool definitions, auth type (OAuth vs API key),
   scopes, sensitivity hints.
3. A recipe compiles to a small **remote MCP server we host** (or a custom-tool definition if
   the API surface is tiny). Credentials stay in our sealed `connector_connections` store;
   OAuth uses our existing DCR/state/PKCE machinery or a per-service OAuth app when the vendor
   requires one.
4. Admin reviews the generated tool list + scopes → approve → connection available to agents.

This keeps: tenant-scoped credentials, audit, revocation, no new runtime, AGPL-clean. The
"study the docs and generate" part is the genuinely new work — an agent task plus a recipe
schema and a reviewer UI, not a platform.

## Recommendation

**Do not adopt Nango now.** The premise (Granola missing) was wrong; the remaining gap is
better served by C, which reuses our connector machinery end to end. Revisit Nango only if
the recipe approach stalls on OAuth providers that refuse DCR and dynamic registration at
scale — at that point Nango Cloud (not self-hosted, for license reasons) is the fallback,
behind the same `connector_connections` abstraction.

### Next concrete step

Design the **connector recipe** format + the chat flow ("não temos X → proponho conector →
revisão → conectar OAuth/key"). Inputs: `MCP_PRESETS` + `CONNECTOR_CATALOG` as the discovery
catalog; agent-generated recipe as the fallback. This is the same work item as the
"automatic connector creator" request; this doc is its build-vs-buy gate.

## References

- `packages/engine/src/connectors/presets.ts` (MCP_PRESETS, incl. granola)
- `packages/engine/src/connectors/custom.ts` (`connectCustomServer`, probe → open/OAuth/key)
- `packages/engine/src/connectors/connections.ts` (sealed credentials, scopes, revocation)
- `packages/engine/src/connectors/listing.ts` (ADR 0107 Composio way)
- Nango: https://github.com/NangoHQ/nango (Elastic License 2.0)
- Composio: https://github.com/ComposioHQ/composio
- Pipedream: https://github.com/PipedreamHQ/pipedream
