# Plugins area: what the starred repos teach us

Date: 2026-11-18. Status: research synthesis for the plugins/TimesFM request. No code.

## What "plugin" must mean here

User's ask: an area where plugins add platform functionality, including wrapping open-source
apps (example: `google-research/timesfm`) **with their own interface**. That is more than an
MCP connector: a plugin can contribute tools AND UI surfaces AND a runtime.

## Candidate references (from the 887-star study)

| Repo | Takeaway for us |
|---|---|
| `HKUDS/CLI-Anything` | The core pattern: wrap any software as agent-callable CLI tools without rewriting it. A TimesFM plugin = packaged CLI + manifest + tool mapping. Cheapest path to "run open-source apps inside KeepMind". |
| `deepseek-ai/deepseek-harness` | "Everything is a plugin" runtime on Cordis: plugin lifecycle, capability model, hot surfaces. Dev preview with breaking changes — steal the *model* (manifest → capabilities → surfaces), not the code. |
| `kortix-ai/CompanyOS` | Always-on agents + event triggers + parallel runs + app building inside a "company as code" repo. Validates plugins-as-company-capabilities; their git-repo-as-state idea is interesting but we already have DB+audit. |
| `multica-ai/multica` | Squad/leader routing, agent pages with runs/runtime/success-rate, skills-as-playbooks. Best UX reference for the team area; overlaps our engine heavily — mine UX, don't import. |
| `paperclipai/paperclip` | Org charts, goals, budgets, governance for agent teams (MIT). Steal the goal→team→budget vocabulary for plugin/agent administration. |
| `lobehub/lobehub` | Super-agents inside team chat + weekly self-improvement loop. UX validation for chat-first agents. |

## Proposed shape (v1, smallest honest version)

1. **Plugin manifest** (`keepmind.plugin.json` or DB row): id, version, publisher, license,
   declared capabilities: `tools[]`, `ui[]` (panel/page/command contributions), `runtime`
   (none | worker | sidecar | machine).
2. **Three plugin kinds**, matching existing machinery:
   - *Tool plugin*: contributes MCP-style tools through the existing Tool Gateway
     (custom connector machinery already does 90% of this).
   - *UI plugin*: contributes a settings/chat panel (React bundle, sandboxed iframe or
     registered route) — this is what TimesFM needs for "its own interface".
   - *Runtime plugin*: runs a worker/sidecar (like whatsapp-bridge) for apps that need a
     process (Python ML models like TimesFM).
3. **Install flow**: admin installs from a plugin directory entry or a git repo/MCP URL →
   manifest reviewed (permissions, network, secrets declared) → approve → scoped to org,
   revocable, audited. Untrusted code rule: runtime plugins run as sidecars with declared
   env/secrets only, never inside the server process.
4. **TimesFM reference plugin**: manifest + Python sidecar (timesfm forecast endpoint) +
   tools (`forecast`, `evaluate`) + a small UI panel for running forecasts on workspace data.
   Proves all three contribution kinds at once.

## Non-goals for v1

- No third-party marketplace, no signed plugin binaries, no cross-org plugins.
- No in-process plugin code in the AGPL server (boundary rule).
- No auto-update channel; upgrades are explicit reinstalls.

## Open questions

- UI plugin sandbox: iframe + postMessage API vs. bundled route with capability tokens.
- Where plugin state lives (per-org DB schema vs. plugin-owned storage in sidecar).
- Whether "app wrapper" plugins (CLI-Anything style) should *generate* manifests from a repo
  automatically — likely a later agent-assisted flow, same machinery as the connector recipe.
EOF
cd "/Users/gustavocaetano/Documents/ChatGPT/keepmind-os" && git add docs/superpowers/specs/2026-11-18-plugins-area-design.md && git commit -q -m "docs: plugins area design synthesis from starred-repo study

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>" && git push -q && echo ok