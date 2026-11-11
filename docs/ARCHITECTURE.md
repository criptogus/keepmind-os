# Zero Agency OS - Architecture Design

## Overview

Zero Agency OS is a local-first desktop application that provides human-governed agent teams. Built on Electron with React, using a custom agent execution engine backed by the OpenAI and Anthropic SDKs (API key or OAuth).

## System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Window Mgmt  │  │ IPC Handlers │  │ Agent Engine │      │
│  │              │  │              │  │ (OpenAI/     │      │
│  │              │  │              │  │ Anthropic)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │ IPC
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process (React)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ UI Components│  │ State Mgmt   │  │ Preload API  │      │
│  │              │  │              │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Local Storage Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ SQLite (node:sqlite) │  │ File System  │  │ Secure Store │      │
│  │              │  │              │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Module Breakdown

### 1. Main Process (`src/main/`)

#### Responsibilities
- Window lifecycle management
- IPC communication bridge
- Agent execution via OpenAI/Anthropic SDKs
- File system operations
- Security boundaries

#### Key Modules

**Window Manager**
```typescript
class WindowManager {
  createMainWindow(): BrowserWindow
  createAgentWindow(agentId: string): BrowserWindow
  createSettingsWindow(): BrowserWindow
  handleWindowEvents()
}
```

**IPC Handler Registry**
```typescript
class IPCRegistry {
  registerAgentHandlers()
  registerGovernanceHandlers()
  registerStorageHandlers()
  registerSystemHandlers()
}
```

**Agent Execution Engine**
```typescript
class AgentManager {
  executeAgent(agentId: string, config: AgentConfig, input: unknown): Promise<AgentExecution>
  cancelExecution(executionId: string)
  setApiKey(provider: 'openai' | 'anthropic', key: string)
  setOAuthToken(provider: 'openai' | 'anthropic', token: string)
}

class TeamExecutionEngine {
  executeTeam(team: Team, agents: Agent[], input: unknown): Promise<TeamResult>
}
```

**Storage Layer**
```typescript
class StorageManager {
  // SQLite for structured data
  database: SQLiteDatabase

  // File system for artifacts
  artifactsDir: string

  // Encrypted storage for secrets
  secureStore: KeytarWrapper

  async saveAgent(agent: Agent)
  async loadAgent(agentId: string): Agent
  async saveTeam(team: Team)
  async loadTeam(teamId: string): Team
  async saveAuditLog(log: AuditEntry)
  async queryAuditLogs(filters: AuditFilters): AuditEntry[]
}
```

### 2. Preload Script (`src/preload/`)

#### Responsibilities
- Secure bridge between main and renderer
- Type-safe IPC API exposure
- Sanitize renderer requests

#### API Surface

```typescript
interface ElectronAPI {
  // System
  getVersion(): Promise<string>
  getPath(name: string): Promise<string>

  // Window
  minimizeWindow(): Promise<void>
  maximizeWindow(): Promise<void>
  closeWindow(): Promise<void>

  // Agents
  getAgents(): Promise<Agent[]>
  getAgent(id: string): Promise<Agent>
  createAgent(config: AgentConfig): Promise<Agent>
  updateAgent(id: string, config: Partial<AgentConfig>): Promise<Agent>
  deleteAgent(id: string): Promise<void>
  executeAgent(id: string, input: unknown): Promise<AgentExecution>
  cancelExecution(executionId: string): Promise<void>

  // Teams
  getTeams(): Promise<Team[]>
  getTeam(id: string): Promise<Team>
  createTeam(config: TeamConfig): Promise<Team>
  updateTeam(id: string, config: Partial<TeamConfig>): Promise<Team>
  deleteTeam(id: string): Promise<void>
  addAgentToTeam(teamId: string, agentId: string): Promise<void>
  removeAgentFromTeam(teamId: string, agentId: string): Promise<void>

  // Governance
  getGovernanceState(): Promise<GovernanceState>
  getPendingApprovals(): Promise<Approval[]>
  approveAction(actionId: string): Promise<void>
  rejectAction(actionId: string, reason: string): Promise<void>
  setGovernanceRule(rule: GovernanceRule): Promise<void>

  // Storage
  getAuditLogs(filters: AuditFilters): Promise<AuditEntry[]>
  exportAuditLogs(filters: AuditFilters): Promise<string>

  // Settings
  getSettings(): Promise<AppSettings>
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>
}
```

### 3. Renderer Process (`src/renderer/`)

#### Tech Stack
- React 19 for UI
- StyleX for styling (via Astryx)
- Zustand for state management
- React Query for data fetching
- React Router for navigation

#### Directory Structure

```
src/renderer/
├── components/
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   └── Table.tsx
│   ├── dashboard/
│   │   ├── Dashboard.tsx
│   │   ├── ActivityChart.tsx
│   │   └── QuickActions.tsx
│   ├── agents/
│   │   ├── AgentList.tsx
│   │   ├── AgentCard.tsx
│   │   ├── AgentEditor.tsx
│   │   └── AgentExecutionView.tsx
│   ├── teams/
│   │   ├── TeamList.tsx
│   │   ├── TeamCard.tsx
│   │   ├── TeamEditor.tsx
│   │   └── WorkflowBuilder.tsx
│   ├── governance/
│   │   ├── ApprovalQueue.tsx
│   │   ├── ApprovalCard.tsx
│   │   ├── GovernanceRules.tsx
│   │   └── SafetyBoundaries.tsx
│   └── settings/
│       ├── SettingsPanel.tsx
│       ├── APIKeys.tsx
│       ├── Preferences.tsx
│       └── About.tsx
├── store/
│   ├── agentStore.ts
│   ├── teamStore.ts
│   ├── governanceStore.ts
│   └── settingsStore.ts
├── hooks/
│   ├── useAgents.ts
│   ├── useTeams.ts
│   ├── useGovernance.ts
│   └── useAuditLogs.ts
├── lib/
│   ├── api.ts (IPC wrapper)
│   ├── types.ts
│   └── utils.ts
├── routes/
│   └── AppRouter.tsx
├── App.tsx
├── main.tsx
└── index.html
```

#### State Management (Zustand)

```typescript
// agentStore.ts
interface AgentStore {
  agents: Agent[]
  selectedAgent: Agent | null
  loading: boolean
  error: string | null

  fetchAgents: () => Promise<void>
  selectAgent: (id: string) => void
  createAgent: (config: AgentConfig) => Promise<void>
  updateAgent: (id: string, config: Partial<AgentConfig>) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  executeAgent: (id: string, input: unknown) => Promise<void>
}

// governanceStore.ts
interface GovernanceStore {
  pendingApprovals: Approval[]
  governanceRules: GovernanceRule[]
  loading: boolean

  fetchPendingApprovals: () => Promise<void>
  approveAction: (actionId: string) => Promise<void>
  rejectAction: (actionId: string, reason: string) => Promise<void>
  updateRule: (rule: GovernanceRule) => Promise<void>
}
```

### 4. Shared Types (`src/shared/`)

```typescript
// types.ts
export interface Agent {
  id: string
  name: string
  description: string
  config: AgentConfig
  capabilities: string[]
  permissions: AgentPermissions
  createdAt: Date
  updatedAt: Date
}

export interface AgentConfig {
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  tools: ToolConfig[]
}

export interface Team {
  id: string
  name: string
  description: string
  agentIds: string[]
  workflow: Workflow
  createdAt: Date
  updatedAt: Date
}

export interface Workflow {
  steps: WorkflowStep[]
  executionMode: 'sequential' | 'parallel' | 'conditional'
}

export interface Approval {
  id: string
  type: 'agent_action' | 'team_execution' | 'resource_access'
  agentId: string
  agentName: string
  action: string
  context: unknown
  status: 'pending' | 'approved' | 'rejected'
  createdAt: Date
  reviewedAt?: Date
  reviewedBy?: 'human'
  rejectionReason?: string
}

export interface GovernanceRule {
  id: string
  name: string
  type: 'approval_required' | 'rate_limit' | 'resource_constraint' | 'content_filter'
  scope: 'agent' | 'team' | 'global'
  condition: RuleCondition
  action: RuleAction
  enabled: boolean
}

export interface AuditEntry {
  id: string
  timestamp: Date
  agentId: string
  agentName: string
  action: string
  input: unknown
  output: unknown
  metadata: Record<string, unknown>
}
```

## Data Flow

### Agent Execution Flow

```
1. User requests agent execution (Renderer)
   ↓
2. IPC call to main process (Preload)
   ↓
3. Governance check (Main)
   ├─ If approval required → Queue for human review
   └─ If approved → Continue
   ↓
4. AgentManager executes agent via provider API (Main)
   ↓
5. Stream results back via IPC (Main → Renderer)
   ↓
6. Update UI with real-time progress (Renderer)
   ↓
7. Log execution to audit trail (Main)
```

### Team Coordination Flow

```
1. User defines team workflow (Renderer)
   ↓
2. Validate workflow structure (Main)
   ↓
3. Store team configuration (Main → Storage)
   ↓
4. On execution:
   ├─ Load team configuration
   ├─ Initialize agent instances
   ├─ Execute workflow steps (TeamExecutionEngine)
   ├─ Inter-agent communication
   └─ Aggregate results
   ↓
6. Return team execution result
```

### Governance Approval Flow

```
1. Agent requests action requiring approval
   ↓
2. Create approval entry (Main)
   ↓
3. Notify renderer via IPC event
   ↓
4. Display in approval queue (Renderer)
   ↓
5. Human reviews and approves/rejects
   ↓
6. Send decision via IPC (Renderer → Main)
   ↓
7. Resume or cancel action (Main)
   ↓
8. Log decision to audit trail
```

## Security Architecture

### 1. Process Isolation
- Main process runs with elevated privileges
- Renderer process sandboxed
- No direct Node.js access in renderer
- All file system operations via IPC

### 2. Data Protection
- Secrets stored in system keychain (keytar)
- Database encryption at rest
- Secure IPC communication
- Input validation on all IPC calls

### 3. Governance Controls
- Approval queues for sensitive actions
- Rate limiting per agent/team
- Resource quotas (CPU, memory, API calls)
- Content filtering for outputs
- Audit trail for all actions

### 4. Network Security
- All external API calls through main process
- Certificate pinning for critical endpoints
- Request signing and validation
- No direct network access from renderer

## Performance Considerations

### 1. Agent Execution
- Long-running operations in worker threads
- Stream results instead of buffering
- Cancellation support for in-flight executions
- Resource pooling for concurrent agents

### 2. UI Responsiveness
- Debounce expensive operations
- Virtual scrolling for large lists
- Lazy loading of audit logs
- Web Workers for data processing

### 3. Storage Optimization
- Indexed SQLite queries
- Pagination for large datasets
- Archive old audit logs
- Prune expired data

## Error Handling

### 1. IPC Errors
- Graceful degradation
- User-friendly error messages
- Retry logic for transient failures
- Error logging for debugging

### 2. Agent Failures
- Capture stack traces
- Save partial results
- Retry with exponential backoff
- Notify user of failures

### 3. Storage Errors
- Fallback to in-memory cache
- Data integrity checks
- Recovery procedures
- Backup and restore

## Testing Strategy

### 1. Unit Tests
- IPC handler logic
- Storage operations
- Data transformations
- Utility functions

### 2. Integration Tests
- IPC communication
- Agent execution engine
- Storage layer
- Agent lifecycle

### 3. E2E Tests
- User workflows
- Multi-window scenarios
- Approval flows
- Error recovery

## Future Enhancements

### 1. Plugin System
- External agent providers
- Custom governance rules
- Third-party integrations
- Extensible UI components

### 2. Multi-User Support
- User profiles
- Permission system
- Team collaboration
- Shared workspaces

### 3. Cloud Sync
- Optional cloud backup
- Cross-device sync
- Remote agent execution
- Distributed coordination

### 4. Advanced Governance
- ML-based anomaly detection
- Automated policy enforcement
- Risk scoring
- Compliance reporting
