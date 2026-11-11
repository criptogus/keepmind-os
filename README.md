# Zero Agency OS

MVP v0.2 — private, pre-release

A local-first desktop operating layer for human-governed agent teams. macOS is the first target.

License: TBD (pending owner decision)

The package metadata uses UNLICENSED until the owner decides the project license.
See THIRD_PARTY_NOTICES.md for dependency notices and pending license checks.

## Current Status (v0.2)

Phase 2 implementation includes:
- ✅ SQLite database with StorageManager
- ✅ Custom AgentManager with OpenAI and Anthropic support (replaces Paperclipai)
- ✅ OAuth 2.0 authentication for AI providers
- ✅ Complete IPC communication layer
- ✅ React UI with Zustand state management
- ✅ Agent management (create, list, delete, execute)
- ✅ Team management with workflow builder
- ✅ Team execution engine
- ✅ Governance approval queue
- ✅ Governance rules editor
- ✅ Audit logging viewer
- ✅ Settings panel with API key management
- ✅ Analytics dashboard
- ✅ Dark mode support
- ✅ Styled components with Astryx/StyleX

## Authentication

Zero Agency OS supports two authentication methods for AI providers:

### OAuth 2.0 (Recommended)
- Secure, token-based authentication
- No API keys stored locally
- Automatic token refresh
- Better security and user experience

### API Keys
- Direct API key authentication
- Simpler setup for development
- Suitable for testing and prototyping

See [OAuth Setup Guide](docs/OAUTH_SETUP.md) for detailed configuration instructions.

## Setup

Use Node >=24.11.0. Run `npm install` to install dependencies.

### Configure Authentication

Choose one of the following methods:

**Option A: OAuth (Recommended)**
```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your OAuth credentials
# See docs/OAUTH_SETUP.md for details
```

**Option B: API Keys**
```bash
# Set API keys as environment variables
export OPENAI_API_KEY=your_key
export ANTHROPIC_API_KEY=your_key
```

## Development

- `npm run dev`: Start Vite development server (renderer only)
- `npm run build`: Build renderer and main processes
- `npm start`: Launch Electron from built output
- `npm test`: Run unit tests with Vitest
- `npm run typecheck`: TypeScript type checking
- `npm run dist:mac`: Build DMG and ZIP for macOS

## Features

### Agent Management
- Create agents with custom configurations
- Configure model, temperature, max tokens, and system prompts
- List, edit, and delete agents
- Execute agents with input/output tracking
- Execution history viewer
- Cancel running executions

### Team Coordination
- Create teams of agents
- Assign agents to teams
- Visual workflow builder
- Sequential/parallel/conditional execution modes
- Team execution engine
- Execute teams with input/output tracking

### Governance
- Approval queue for sensitive actions
- Real-time pending approval notifications
- Governance rules editor
- Rule types: approval_required, rate_limit, resource_constraint, content_filter
- Scope: global, agent, team

### Audit Logging
- Complete audit trail of all agent actions
- Activity log viewer with filtering
- Configurable retention policies

### Settings
- Theme configuration (light/dark/auto)
- Language selection
- Auto-approval toggle
- Default model selection
- Execution limits
- Data retention settings
- API key management
- OAuth authentication status

### Analytics
- Real-time metrics dashboard
- Agent/team/execution counts
- Pending approvals tracking

## Architecture

See `docs/ARCHITECTURE.md` for detailed architecture documentation.

### Key Components

**Main Process:**
- `src/main/main.ts` - Electron main process with IPC handlers
- `src/main/storage/StorageManager.ts` - SQLite database operations
- `src/main/agent/AgentManager.ts` - Custom agent execution engine
- `src/main/agent/TeamExecutionEngine.ts` - Team workflow execution
- `src/main/auth/OAuthManager.ts` - OAuth authentication manager

**Renderer Process:**
- `src/renderer/App.tsx` - Main application
- `src/renderer/store/` - Zustand state management
- `src/renderer/components/` - React components

**Shared:**
- `src/shared/types.ts` - TypeScript type definitions

## Layout

Source directories separate Electron main, preload, runner, renderer, and shared
types. Tests belong in test/; optional integration tests belong in test/integration/.
Scripts, documentation, application assets, and local evidence have dedicated
folders. Runtime data, credentials, build outputs, and evidence logs are ignored.

The supplied theme uses Astryx's neutral theme with StyleX for styling. The font
URL points to the copied assets/fonts/Inter-Regular.ttf so Vite can bundle the asset.

## Roadmap

See `docs/ROADMAP.md` for the complete development roadmap from v0.2 to v1.0.

## Security

- Process isolation between main and renderer
- No direct Node.js access in renderer
- All file system operations via IPC
- Secure storage for sensitive data
- Input validation on all IPC calls
- OAuth 2.0 with PKCE for enhanced security
- Context isolation enabled
- Sandbox mode enabled

## Dependencies

### Runtime
- electron 45.2.3
- react 19.2.0
- react-dom 19.2.0
- openai ^4.73.0
- @anthropic-ai/sdk ^0.32.1
- zustand 5.0.2
- @tanstack/react-query 5.62.0
- @astryxdesign/core 0.7.11
- @astryxdesign/theme-neutral 0.7.11
- @stylexjs/stylex 0.19.1

### Development
- typescript ~5.9.3
- vite ^7
- @vitejs/plugin-react ^5
- vitest ^3
- esbuild 0.28.2
- electron-builder ^26
- @astryxdesign/cli 0.7.11
- zod ^3.25

## Notes

- **Paperclip Replacement**: The original `paperclipai` dependency was replaced with a custom `AgentManager` implementation using OpenAI and Anthropic SDKs for better control and maintainability.
- **OAuth Support**: OAuth 2.0 authentication is now supported for both OpenAI and Anthropic providers.
- **License**: Project license is TBD pending owner decision.
