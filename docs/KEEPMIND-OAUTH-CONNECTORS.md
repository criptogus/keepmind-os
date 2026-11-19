# OAuth connectors and agent audit — 2026-11-15

## Implemented

- GitHub offers browser authorization first. Server owners can register their own GitHub App from the connection flow; manual tokens remain optional. Other members receive a setup explanation.
- Local/private or non-HTTPS installations omit webhook configuration and subscriptions from the GitHub manifest. GitHub rejects localhost webhook URLs even when inactive. Public HTTPS servers keep webhook subscriptions. Local API access works; incoming GitHub events require a public webhook endpoint.
- Composio Connect is an OAuth-only preset at `https://connect.composio.dev/mcp`, separate from the existing project-key Composio bridge. It uses MCP OAuth discovery, dynamic registration and PKCE through the existing client. No administrative Composio API key is needed for this preset.
- Composio connection management, remote workbench, shell and proxy tools require approval. Existing multi-execute tools retain action-by-action permission checks. A server read-only annotation cannot downgrade connection management.

## Observed locally

GitHub's corrected manifest was accepted. After the user's authorization, KeepMind displayed GitHub Active, five of five agents, and the installation for all repositories on the authorized account. This verifies registration and saved connection state, not every repository operation.

Composio's actual OAuth flow reached its official login page and the user completed authorization. KeepMind then showed Composio Connect Active for five of five agents and discovered 12 tools. The permissions view showed management, multi-execute, proxy and remote tools requiring approval. No business action was executed through these tools.

Updated the local runtime web assets and server bundle; preserved the database, credentials and runner pairing. No release published in this change.

## Agent audit

- Agent instructions persist and enter the prompt. Imported SOUL.md content is folded into instructions; the current base does not create a separate SOUL.md for every agent.
- Skills are listed in context and the agent is instructed to load a skill before use. Tool discovery and execution are checked against grants. This is mechanism validation, not proof of correct model choices in every task.
- Proactive team monitoring and follow-ups have autonomy brakes, including wait requests and limits. Tests verify these controls; no claim that every agent has all proactive settings enabled.
- The local runner's configured workspace is available with command execution. No extra personal folders were granted in this task. Desktop GUI control in the current runner requires Linux; it is not operational for Mac desktop control.
- SuperAgentSkill access remains limited to Kivo; no grant expansion was performed by this change. GitHub access reflects the user's installation flow.
- OAuth is preferred where supported. Unconfigured OAuth services now explain initial setup rather than presenting API keys as the only route. Provider-specific API-only and unavailable integrations remain explicit. The catalogue audit is not a live authorization test of every provider.

## Validation

- Web connector catalogue and GitHub panel: 57 tests passed.
- GitHub manifest and server routes: 20 tests passed.
- Custom MCP and connector presets: 40 tests passed; strengthened management-tool suggested-approval assertion also passed.
- Agent permission, proactive, skills and autonomy targeted suite: 129 tests passed (overlaps GitHub unit coverage).
- Web and server typechecks passed; web and native server bundles built successfully.
- GitHub and Composio connection screens inspected at desktop and mobile sizes.
- JEV reviewed the narrow backend patch but returned low-confidence scores without a concrete defect. Deterministic tests and direct observations remain the completion evidence.

Sources: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest and https://docs.composio.dev/docs/composio-connect.

Independent visual review: ship for the scoped UI refinement; documentation reconciliation found no design-system changes necessary.
