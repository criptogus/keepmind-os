export type UserRole = 'owner' | 'admin' | 'member';

export interface LocalUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  createdBy?: string;
}

export type ComputerAccessLevel = 'workspace' | 'authorized' | 'full';

export interface Agent {
  id: string;
  name: string;
  description: string;
  config: AgentConfig;
  capabilities: string[];
  permissions: AgentPermissions;
  /** Shared agents can be executed by 'member' users (who cannot edit them). */
  isShared?: boolean;
  sharedBy?: string;
  sharedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  toolNames: string[];
  createdAt: string;
  updatedAt: string;
  /** Times this skill was injected into an execution (auto-improvement signal). */
  usageCount?: number;
  lastUsedAt?: string;
}

export interface AgentConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  tools: ToolConfig[];
  skillIds?: string[];
  /** Per-agent computer access ceiling — can only narrow the install level. */
  computerAccess?: ComputerAccessLevel;
}

export interface CreateAgentInput extends AgentConfig {
  name?: string;
  description?: string;
  capabilities?: string[];
}

export interface ToolConfig {
  name: string;
  type: 'api' | 'file' | 'database' | 'custom';
  config: Record<string, unknown>;
}

export interface AgentPermissions {
  canAccessNetwork: boolean;
  canAccessFileSystem: boolean;
  canExecuteCode: boolean;
  maxExecutionTime: number;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  agentIds: string[];
  workflow: Workflow;
  createdAt: string;
  updatedAt: string;
}

export interface TeamConfig {
  name: string;
  description?: string;
  agentIds?: string[];
  workflow?: Workflow;
}

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  executionMode: 'sequential' | 'parallel' | 'conditional';
}

export interface WorkflowStep {
  id: string;
  agentId: string;
  inputs: Record<string, unknown>;
  condition?: string;
  dependsOn?: string[];
}

export interface Approval {
  id: string;
  type: 'agent_action' | 'team_execution' | 'resource_access';
  agentId: string;
  agentName: string;
  action: string;
  context: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: 'human';
  rejectionReason?: string;
}

export interface GovernanceRule {
  id: string;
  name: string;
  type: 'approval_required' | 'rate_limit' | 'resource_constraint' | 'content_filter';
  scope: 'agent' | 'team' | 'global';
  scopeId?: string;
  condition: RuleCondition;
  action: RuleAction;
  enabled: boolean;
}

export interface RuleCondition {
  field: string;
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'regex';
  value: unknown;
}

export interface RuleAction {
  type: 'block' | 'require_approval' | 'limit' | 'warn';
  parameters?: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  action: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata: Record<string, unknown>;
  /** Local user who triggered the action ('system' for triggers/WhatsApp). */
  userId?: string;
}

export interface AgentExecution {
  id: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  progress: number;
  /** Local user who initiated the execution ('system' for triggers/WhatsApp). */
  userId?: string;
}

export interface AgentExecutionEvent {
  executionId: string;
  type: 'chunk' | 'tool_call' | 'tool_result' | 'status' | 'error';
  data?: unknown;
}

export interface AgentTrigger {
  id: string;
  agentId: string;
  name: string;
  kind: 'interval' | 'daily';
  /** Minutes between runs (kind='interval'). */
  intervalMinutes?: number;
  /** HH:MM local time (kind='daily'). */
  timeOfDay?: string;
  /** Task description sent to the agent on each run. */
  prompt: string;
  enabled: boolean;
  lastRunAt?: string;
  createdAt: string;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  autoApprove: boolean;
  defaultModel: string;
  maxConcurrentExecutions: number;
  auditRetentionDays: number;
  onboardingCompleted?: boolean;
  skillsAutoRoute?: boolean;
  llmAutoRoute?: boolean;
  /** When true (default), sensitive tools wait for human approval. */
  toolApprovalRequired?: boolean;
}
