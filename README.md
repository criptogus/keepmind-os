# KeepMind OS

A local-first desktop workspace for human-governed AI agent teams.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/criptogus/keepmind-os)](https://github.com/criptogus/keepmind-os/releases/latest)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)

[Homepage](https://keepmind.io)

## Why

Agent teams need a workspace where people can configure their tools, review sensitive actions, and inspect what happened. KeepMind OS brings execution, governance, memory, and integrations into a desktop app with local SQLite storage. Model calls and enabled integrations use external services.

## Features

**Agents and teams**

- Configure agents with prompts, models, tools, skills, and distinct avatars.
- Build team workflows with sequential, parallel, or conditional steps.
- Run agents and teams, inspect execution history, and cancel agent runs.
- Use OpenAI and Anthropic through OAuth or API keys.

**Governance and visibility**

- Review sensitive tool actions in a human approval queue and edit governance rules.
- Inspect audit logs and model/skill routing decisions, including selection reasons.
- Track estimated token costs per agent and configure monthly budgets checked before execution. Estimates are not provider invoices; a running execution can exceed its budget.

**Memory and skills**

- Keep a personal Markdown memory vault with a local SQLite retrieval index.
- Consolidate memories, retain superseded history, and weight recall using execution outcomes.
- Create skills or import them from GitHub with provenance and text-only import restrictions.

**Automation and integrations**

- Schedule interval or daily triggers, or start agents through token-protected local webhooks.
- Connect WhatsApp through Baileys and external application tools through Composio.
- Connect to a Second Brain / KeepMind Corp server to search, read, and capture shared knowledge, with configurable write access and PII checks.

**Desktop workspace**

- English and Brazilian Portuguese interface strings, onboarding, theme settings, and an analytics dashboard.
- Local SQLite persistence for agents, teams, settings, approvals, and execution records.

## Screenshots

<img src="docs/screenshots/dashboard.png" alt="Home dashboard with an ask-an-agent prompt, connections, agent, team, execution, and approval counters, and a getting-started checklist" width="100%">

Ask an agent, monitor workspace activity, and follow the getting-started checklist from Home.

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/onboarding.png" alt="First-run onboarding wizard for configuring a company, LLM provider, second brain, and first agent" width="100%"></td>
    <td width="33%"><img src="docs/screenshots/agents.png" alt="Agents page displaying configured agents as cards" width="100%"></td>
    <td width="33%"><img src="docs/screenshots/settings.png" alt="Settings page with appearance, language, governance and approvals, execution model, and data retention options" width="100%"></td>
  </tr>
  <tr>
    <td>Set up your company, LLM provider, second brain, and first agent.</td>
    <td>Browse and manage your agents from their cards.</td>
    <td>Configure appearance, language, governance, execution, and data retention.</td>
  </tr>
</table>

*Screenshots use fictional demo data.*

## Download

Get the [latest macOS release](https://github.com/criptogus/keepmind-os/releases/latest).

| Mac | DMG filename |
| --- | --- |
| Apple Silicon | `KeepMind-OS-<version>-arm64.dmg` |
| Intel | `KeepMind-OS-<version>.dmg` |

Replace `<version>` with the release version. ZIP variants are also available.

Builds are currently unsigned and not notarized. On first launch, macOS Gatekeeper may block the app. Right-click the app and choose **Open**, or use **System Settings > Privacy & Security > Open Anyway**.

## Build from source

Requires Node.js **>= 24.11.0** and npm. From the repository root:

```bash
npm ci
npm run build
npm start
```

Available commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite renderer development server only |
| `npm run build` | Build the renderer, main process, and preload bridge |
| `npm start` | Launch Electron using the built output |
| `npm test` | Run unit tests |
| `npm run typecheck` | Check TypeScript types |
| `npm run dist:mac` | Build macOS DMG and ZIP packages |

## Configuration

Configure OpenAI and Anthropic in the app's settings using OAuth or API keys. The `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` environment variables are also supported. Configure optional integrations in the app before enabling them.

## Architecture

Electron and TypeScript separate privileged operations from the React interface:

- **Main:** window lifecycle, agent/team execution, integrations, credentials, and SQLite storage.
- **Preload:** a typed IPC bridge between the renderer and main process.
- **Renderer:** React views and workspace state.
- **Runner:** reserved directory; execution currently lives in the main process.
- **Shared:** common types, model metadata, and avatar utilities.

See [Architecture](docs/ARCHITECTURE.md) and the [architecture decisions](docs/adr/). The architecture document includes design proposals; the source is authoritative for current behavior.

## Security

See [SECURITY.md](SECURITY.md) for the security model and private vulnerability reporting.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and pull request guidelines.

## Roadmap

See the [development roadmap](docs/ROADMAP.md) for planned work.

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency notices.
