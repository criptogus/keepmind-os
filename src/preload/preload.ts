import type { SakStatus, SakHit, SakPreview } from '../shared/superAgentSkill.js';
import type { BusinessTeamInput, BusinessTeamResult } from '../shared/businessTeams.js';
import type { McpConfig } from '../main/mcp/McpManager.js';
import type { ToolStep } from '../main/execution/CheckpointStore.js';
import type { CreateWorkInput, WorkAction, WorkSnapshot, WorkTask, WorkPreview, WorkContext } from '../shared/work.js';
import { contextBridge, ipcRenderer } from 'electron';
import type { Agent, Team, Approval, GovernanceRule, AuditEntry, AgentExecution, ExecutionToolCall, AgentConfig, CreateAgentInput, TeamConfig, AppSettings, Skill, AgentTrigger, LocalUser, UserRole, ComputerAccessLevel, LlmUsageRecord, RoutingDecision, MemoryItem, Channel, ChannelMessage, ChatChannelView, ChatEvent } from '../shared/types.js';
import type { ModelCatalogResponse } from '../shared/models.js';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  loginOpenInSafari: (provider: 'superagentskill' | 'openai' | 'anthropic') => ipcRenderer.invoke('login:openInSafari', provider) as Promise<void>,
  workArtifacts: (id: string) => ipcRenderer.invoke('work:artifacts', id) as Promise<import('../shared/artifacts.js').WorkArtifact[]>,
  workCheckpoint: (id: string) => ipcRenderer.invoke('work:checkpoint', id) as Promise<{ available: boolean; steps: ToolStep[] }>,
  workReconcile: (id: string, key: string, result: string, revision?: number) => ipcRenderer.invoke('work:reconcile', id, key, result, revision) as Promise<void>,
  workContext: () => ipcRenderer.invoke('work:context') as Promise<WorkContext>,
  workspaceConnection: () => ipcRenderer.invoke('workspace:connection') as Promise<{ url: string; connected: boolean }>,
  workspaceConnect: (url: string, token: string) => ipcRenderer.invoke('workspace:connect', url, token) as Promise<WorkContext>,
  workspaceDisconnect: () => ipcRenderer.invoke('workspace:disconnect') as Promise<void>,
  mcpList: () => ipcRenderer.invoke('mcp:list') as Promise<{ configs: McpConfig[]; statuses: Array<{id:string;connected:boolean;tools:string[];error?:string}> }>,
  mcpConfigure: (configs: unknown) => ipcRenderer.invoke('mcp:configure', configs) as Promise<Array<{id:string;connected:boolean;tools:string[];error?:string}>>,
  workPreview: (id: string) => ipcRenderer.invoke('work:preview', id) as Promise<WorkPreview>,
  workList: () => ipcRenderer.invoke('work:list') as Promise<WorkSnapshot>,
  workCreate: (input: CreateWorkInput) => ipcRenderer.invoke('work:create', input) as Promise<WorkTask>,
  workAction: (id: string, action: WorkAction, note?: string, revision?: number) => ipcRenderer.invoke('work:action', id, action, note, revision) as Promise<WorkTask>,
  workReviewRule: (id: string, accept: boolean, version?: number) => ipcRenderer.invoke('work:reviewRule', id, accept, version) as Promise<void>,
  workExport: () => ipcRenderer.invoke('work:export') as Promise<string>,
  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Agents
  getAgents: () => ipcRenderer.invoke('agents:getList') as Promise<Agent[]>,
  getAgentReputations: () => ipcRenderer.invoke('agents:reputations') as Promise<Record<string, { avg: number; count: number }>>,
  getAgent: (id: string) => ipcRenderer.invoke('agents:get', id) as Promise<Agent | null>,
  createAgent: (input: CreateAgentInput) => ipcRenderer.invoke('agents:create', input) as Promise<Agent>,
  updateAgent: (id: string, updates: Partial<AgentConfig> & { avatar?: string | null; managerId?: string | null }) => ipcRenderer.invoke('agents:update', id, updates) as Promise<Agent>,
  deleteAgent: (id: string) => ipcRenderer.invoke('agents:delete', id) as Promise<void>,
  executeAgent: (id: string, input: Record<string, unknown>) => ipcRenderer.invoke('agents:execute', id, input) as Promise<AgentExecution>,
  executeAgentDryRun: (id: string, input: Record<string, unknown>) => ipcRenderer.invoke('agents:executeDryRun', id, input) as Promise<AgentExecution>,
  cancelExecution: (executionId: string) => ipcRenderer.invoke('agents:cancelExecution', executionId) as Promise<void>,
  getAgentExecutions: (agentId?: string) => ipcRenderer.invoke('agents:getExecutions', agentId) as Promise<AgentExecution[]>,
  getExecutionToolCalls: (executionId: string) => ipcRenderer.invoke('executions:getToolCalls', executionId) as Promise<ExecutionToolCall[]>,

  // Teams
  getTeams: () => ipcRenderer.invoke('teams:getList') as Promise<Team[]>,
  getTeam: (id: string) => ipcRenderer.invoke('teams:get', id) as Promise<Team | null>,
  sakStatus: () => ipcRenderer.invoke('sak:status') as Promise<SakStatus>,
  sakConnect: () => ipcRenderer.invoke('sak:connect') as Promise<SakStatus>,
  sakCancel: () => ipcRenderer.invoke('sak:cancel') as Promise<SakStatus>,
  sakDisconnect: () => ipcRenderer.invoke('sak:disconnect') as Promise<SakStatus>,
  sakSearch: (query: string) => ipcRenderer.invoke('sak:search',query) as Promise<SakHit[]>,
  sakPreview: (slug: string) => ipcRenderer.invoke('sak:preview',slug) as Promise<SakPreview>,
  sakInstall: (digest: string, agentId: string) => ipcRenderer.invoke('sak:install',digest,agentId) as Promise<{skillId:string;agentId:string;name:string}>,
  exportMaterial: (format: 'pdf' | 'pptx', title: string, content: string) => ipcRenderer.invoke('materials:export', format, title, content) as Promise<number[]>,
  createBusinessTeam: (input: BusinessTeamInput) => ipcRenderer.invoke('teams:guidedCreate', input) as Promise<BusinessTeamResult>,
  createTeam: (config: TeamConfig) => ipcRenderer.invoke('teams:create', config) as Promise<Team>,
  updateTeam: (id: string, config: Partial<TeamConfig>) => ipcRenderer.invoke('teams:update', id, config) as Promise<Team>,
  deleteTeam: (id: string) => ipcRenderer.invoke('teams:delete', id) as Promise<void>,
  addAgentToTeam: (teamId: string, agentId: string) => ipcRenderer.invoke('teams:addAgent', teamId, agentId) as Promise<Team>,
  removeAgentFromTeam: (teamId: string, agentId: string) => ipcRenderer.invoke('teams:removeAgent', teamId, agentId) as Promise<Team>,
  executeTeam: (teamId: string, input: Record<string, unknown>) => ipcRenderer.invoke('teams:execute', teamId, input) as Promise<{
    teamId: string;
    status: 'completed' | 'failed' | 'partial';
    results: Array<{
      agentId: string;
      agentName: string;
      status: 'completed' | 'failed';
      output?: Record<string, unknown>;
      error?: string;
    }>;
    duration: number;
  }>,

  // Governance
  getGovernanceState: () => ipcRenderer.invoke('governance:getState') as Promise<{ pendingApprovals: Approval[]; rules: GovernanceRule[] }>,
  getPendingApprovals: () => ipcRenderer.invoke('governance:getPendingApprovals') as Promise<Approval[]>,
  approveAction: (actionId: string) => ipcRenderer.invoke('governance:approve', actionId) as Promise<void>,
  rejectAction: (actionId: string, reason: string) => ipcRenderer.invoke('governance:reject', actionId, reason) as Promise<void>,
  setGovernanceRule: (rule: GovernanceRule) => ipcRenderer.invoke('governance:setRule', rule) as Promise<void>,
  getGovernanceRules: () => ipcRenderer.invoke('governance:getRules') as Promise<GovernanceRule[]>,
  deleteGovernanceRule: (ruleId: string) => ipcRenderer.invoke('governance:deleteRule', ruleId) as Promise<void>,

  // Remote approvals (LAN companion page)
  getRemoteApprovalsStatus: () => ipcRenderer.invoke('remoteApprovals:status') as Promise<{ enabled: boolean; url: string | null }>,
  setRemoteApprovalsEnabled: (enabled: boolean) => ipcRenderer.invoke('remoteApprovals:setEnabled', enabled) as Promise<{ ok: boolean; url: string | null }>,
  regenerateRemoteApprovalsLink: () => ipcRenderer.invoke('remoteApprovals:regenerateLink') as Promise<{ ok: boolean; url: string | null }>,

  // Audit Logs
  getAuditLogs: (limit?: number, offset?: number) => ipcRenderer.invoke('audit:getLogs', limit, offset) as Promise<AuditEntry[]>,
  exportAuditReceiptJson: () => ipcRenderer.invoke('audit:exportReceiptJson') as Promise<{ ok: boolean; canceled?: boolean; path?: string; entryCount?: number; head?: string; error?: string }>,
  exportAuditReceiptHtml: () => ipcRenderer.invoke('audit:exportReceiptHtml') as Promise<{ ok: boolean; canceled?: boolean; path?: string; entryCount?: number; head?: string; error?: string }>,

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', settings) as Promise<Record<string, string>>,

  // Model catalog
  listCompanyBrains: () => ipcRenderer.invoke('companyBrain:list') as Promise<import('../shared/company-brain.js').CompanyBrainBinding[]>,
  saveCompanyBrain: (binding: import('../shared/company-brain.js').CompanyBrainBinding) => ipcRenderer.invoke('companyBrain:save', binding) as Promise<import('../shared/company-brain.js').CompanyBrainBinding>,
  removeCompanyBrain: (agentId: string) => ipcRenderer.invoke('companyBrain:remove', agentId) as Promise<void>,
  testCompanyBrain: (agentId: string) => ipcRenderer.invoke('companyBrain:test', agentId) as Promise<boolean>,
  listCompatibleProviders: () => ipcRenderer.invoke('compatible:list') as Promise<import('../shared/connectors.js').CompatibleProviderProfile[]>,
  saveCompatibleProvider: (profile: import('../shared/connectors.js').CompatibleProviderProfile, apiKey?: string) => ipcRenderer.invoke('compatible:save', profile, apiKey) as Promise<import('../shared/connectors.js').CompatibleProviderProfile>,
  removeCompatibleProvider: (id: string) => ipcRenderer.invoke('compatible:remove', id) as Promise<void>,
  testCompatibleProvider: (id: string) => ipcRenderer.invoke('compatible:test', id) as Promise<import('../shared/connectors.js').CompatibleModelDiscovery>,
  isModelConfigured: (model: string) => ipcRenderer.invoke('models:isConfigured', model) as Promise<boolean>,
  listModels: () => ipcRenderer.invoke('models:list') as Promise<ModelCatalogResponse>,
  refreshModels: () => ipcRenderer.invoke('models:refresh') as Promise<ModelCatalogResponse & { errors?: Record<string, string> }>,

  // API Keys
  setApiKey: (provider: 'openai' | 'anthropic', key: string) => ipcRenderer.invoke('api:setKey', provider, key) as Promise<void>,
  clearApiKey: (provider: 'openai' | 'anthropic') => ipcRenderer.invoke('api:clearKey', provider) as Promise<void>,
  hasApiKey: (provider: 'openai' | 'anthropic') => ipcRenderer.invoke('api:hasKey', provider) as Promise<boolean>,

  // OAuth Authentication
  oauthAuthenticate: (provider: 'openai' | 'anthropic') => ipcRenderer.invoke('oauth:authenticate', provider) as Promise<{
    success: boolean;
    tokens?: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      tokenType: string;
    };
    error?: string;
  }>,
  oauthPendingUrl: (provider: 'openai' | 'anthropic') => ipcRenderer.invoke('oauth:pendingUrl', provider) as Promise<string | null>,
  oauthCancel: (provider: 'openai' | 'anthropic') => ipcRenderer.invoke('oauth:cancel', provider) as Promise<void>,
  oauthIsAuthenticated: (provider: 'openai' | 'anthropic') => ipcRenderer.invoke('oauth:isAuthenticated', provider) as Promise<boolean>,
  oauthIsConfigured: (provider: 'openai' | 'anthropic') => ipcRenderer.invoke('oauth:isConfigured', provider) as Promise<boolean>,
  oauthGetToken: (provider: 'openai' | 'anthropic') => ipcRenderer.invoke('oauth:getToken', provider) as Promise<string | null>,
  oauthLogout: (provider: 'openai' | 'anthropic') => ipcRenderer.invoke('oauth:logout', provider) as Promise<void>,

  // Second Brain (KeepMind Corp)
  secondBrainGetConfig: () => ipcRenderer.invoke('secondbrain:getConfig') as Promise<{ enabled: boolean; url: string; hasToken: boolean; access?: string; blockPii?: boolean }>,
  secondBrainSetConfig: (config: { enabled?: boolean; url?: string; token?: string; access?: 'read' | 'write'; blockPii?: boolean }) =>
    ipcRenderer.invoke('secondbrain:setConfig', config) as Promise<{ enabled: boolean; url: string; hasToken: boolean; access?: string; blockPii?: boolean }>,
  secondBrainTest: () => ipcRenderer.invoke('secondbrain:test') as Promise<{ ok: boolean; error?: string }>,

  // Granola meetings connector (OAuth)
  granolaGetStatus: () => ipcRenderer.invoke('granola:getStatus') as Promise<{ enabled: boolean; connected: boolean; account?: string; lastSync?: string; lastSyncError?: string; syncedCount: number; syncMinutes: number }>,
  granolaConnect: () => ipcRenderer.invoke('granola:connect') as Promise<{ ok: boolean; account?: string; error?: string }>,
  granolaDisconnect: () => ipcRenderer.invoke('granola:disconnect') as Promise<{ ok: boolean }>,
  granolaTest: () => ipcRenderer.invoke('granola:test') as Promise<{ ok: boolean; tools?: string[]; error?: string }>,
  granolaSyncNow: () => ipcRenderer.invoke('granola:syncNow') as Promise<{ synced: number; skipped: number; removed?: number; error?: string }>,
  granolaSetSyncMinutes: (minutes: number) => ipcRenderer.invoke('granola:setSyncMinutes', minutes) as Promise<{ ok: boolean; syncMinutes: number }>,

  // Activity digest ("while you were away")
  activityDigest: () => ipcRenderer.invoke('activity:digest') as Promise<{
    windowHours: number;
    executions: number;
    byChannel: Record<string, number>;
    recentExecs: Array<{ id: string; agentId: string; status: string; channel: string; startedAt?: string }>;
    integrations: Array<{ action: string; agentName: string; timestamp: string; output: Record<string, unknown> }>;
    whatsappMessages: number;
    memories: number;
  }>,

  // Governance overview ("who did what, where")
  governanceSummary: () => ipcRenderer.invoke('governance:summary') as Promise<{
    totalEntries: number;
    totalExecutions: number;
    byCategory: Record<string, number>;
    byUser: Array<{ userId: string; count: number }>;
    topActions: Array<{ action: string; count: number }>;
    approvals: { pending: number; approved: number; rejected: number };
    execByStatus: Record<string, number>;
    execByChannel: Record<string, number>;
    recent: Array<{ id: string; timestamp: string; userId: string; agentName: string; action: string; category: string }>;
  }>,

  // App mode (personal | corporate) and guided brain-product install
  appGetMode: () => ipcRenderer.invoke('app:getMode') as Promise<'personal' | 'corporate' | 'unset'>,
  appSetMode: (mode: 'personal' | 'corporate') =>
    ipcRenderer.invoke('app:setMode', mode) as Promise<{ ok: boolean; mode?: string; error?: string }>,
  brainInstallProduct: (product: 'personal' | 'corporate') =>
    ipcRenderer.invoke('brain:installProduct', product) as Promise<{ ok: boolean; path?: string; error?: string }>,
  onBrainInstallProgress: (callback: (p: { received: number; total: number }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { received: number; total: number }) => callback(p);
    ipcRenderer.on('brain:installProgress', listener);
    return () => ipcRenderer.removeListener('brain:installProgress', listener);
  },

  // Skills
  getSkills: () => ipcRenderer.invoke('skills:getAll') as Promise<Skill[]>,
  getSkill: (id: string) => ipcRenderer.invoke('skills:get', id) as Promise<Skill | null>,
  createSkill: (skill: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>) => ipcRenderer.invoke('skills:create', skill) as Promise<Skill>,
  updateSkill: (id: string, updates: Partial<Omit<Skill, 'id' | 'createdAt'>>) => ipcRenderer.invoke('skills:update', id, updates) as Promise<Skill>,
  deleteSkill: (id: string) => ipcRenderer.invoke('skills:delete', id) as Promise<void>,
  listSkillTools: () => ipcRenderer.invoke('skills:listTools') as Promise<Array<{ name: string; description: string }>>,
  improveSkill: (id: string) => ipcRenderer.invoke('skills:improve', id) as Promise<{ improvedPrompt: string }>,
  importSkillFromGitHub: (url: string) => ipcRenderer.invoke('skills:importGitHub', url) as Promise<{
    skills: Array<{ name: string; description: string; prompt: string; toolNames: string[]; source: string; sourceRef?: string; files?: string[]; ignored?: string[] }>;
    skipped: Array<{ name: string; reason: string }>;
  }>,
  importSkillFromFolder: (dir?: string) => ipcRenderer.invoke('skills:importFolder', dir) as Promise<{
    skills: Array<{ name: string; description: string; prompt: string; toolNames: string[]; source: string; sourceRef?: string; files?: string[]; ignored?: string[] }>;
    skipped: Array<{ name: string; reason: string }>;
    canceled?: boolean;
  }>,
  listSkillMarketplace: () => ipcRenderer.invoke('skills:listMarketplace') as Promise<Array<{
    id: string; name: string; description: string; source: string;
    tags: string[]; audience: string; version: string; featured?: boolean;
    installed: boolean; installedCount: number;
  }>>,
  installSkillFromMarketplace: (id: string) => ipcRenderer.invoke('skills:installMarketplace', id) as Promise<{
    skills: Array<{ name: string; description: string; prompt: string; toolNames: string[]; source: string; sourceRef?: string; files?: string[]; ignored?: string[] }>;
    skipped: Array<{ name: string; reason: string }>;
  }>,
  onAgentEvent: (callback: (event: { executionId: string; type: string; data?: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('agents:event', listener);
    return () => ipcRenderer.removeListener('agents:event', listener);
  },

  // WhatsApp (Baileys)
  whatsappGetStatus: () => ipcRenderer.invoke('whatsapp:getStatus') as Promise<{ status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error'; phone: string }>,
  whatsappStart: () => ipcRenderer.invoke('whatsapp:start') as Promise<{ status: string; phone: string }>,
  whatsappStop: () => ipcRenderer.invoke('whatsapp:stop') as Promise<{ status: string; phone: string }>,
  whatsappSendMessage: (to: string, text: string) => ipcRenderer.invoke('whatsapp:sendMessage', to, text) as Promise<{ ok: boolean }>,
  whatsappGetMessages: (limit?: number, remote?: string) =>
    ipcRenderer.invoke('whatsapp:getMessages', limit, remote) as Promise<Array<{ id: string; direction: string; remote: string; text: string; timestamp: number }>>,
  whatsappClearMessages: () => ipcRenderer.invoke('whatsapp:clearMessages') as Promise<{ ok: boolean }>,
  composioGetStatus: () => ipcRenderer.invoke('composio:getStatus') as Promise<{ configured: boolean; keyHint: string | null }>,
  composioSetApiKey: (key: string) => ipcRenderer.invoke('composio:setApiKey', key) as Promise<{ configured: boolean; keyHint: string | null }>,
  composioClearApiKey: () => ipcRenderer.invoke('composio:clearApiKey') as Promise<{ configured: boolean; keyHint: string | null }>,
  composioTest: () => ipcRenderer.invoke('composio:test') as Promise<{ ok: boolean; error?: string }>,
  composioListToolkits: () => ipcRenderer.invoke('composio:listToolkits') as Promise<Array<{ slug: string; name: string }>>,
  composioListConnections: () => ipcRenderer.invoke('composio:listConnections') as Promise<Array<{ toolkit: string; connectedAccountId: string; status: string }>>,
  composioConnect: (toolkit: string) => ipcRenderer.invoke('composio:connect', toolkit) as Promise<{ id: string; redirectUrl: string | null }>,
  composioDisconnect: (id: string) => ipcRenderer.invoke('composio:disconnect', id) as Promise<{ ok: boolean }>,
  agentReachStatus: () =>
    ipcRenderer.invoke('agentreach:status') as Promise<{ ok: boolean; installed: boolean; channels: Array<{ name: string; status: string; backend: string | null }>; error?: string }>,
  onWhatsAppEvent: (callback: (event: {
    type: 'status' | 'qr' | 'message' | 'error';
    status?: string;
    qrDataUrl?: string;
    phone?: string;
    error?: string;
    message?: { from: string; text: string; timestamp: number };
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('whatsapp:event', listener);
    return () => ipcRenderer.removeListener('whatsapp:event', listener);
  },

  // Company profile
  getCompany: () => ipcRenderer.invoke('company:get') as Promise<{ name: string; description: string; industry: string; website: string }>,
  updateCompany: (profile: Record<string, string>) => ipcRenderer.invoke('company:update', profile) as Promise<Record<string, string>>,

  // Auto-update
  updateCheck: () => ipcRenderer.invoke('update:check') as Promise<{ ok: boolean; updateInfo?: { version: string } | null; error?: string }>,
  updateDownload: () => ipcRenderer.invoke('update:download') as Promise<{ ok: boolean; error?: string }>,
  updateInstall: () => ipcRenderer.invoke('update:install') as Promise<{ ok: boolean; error?: string }>,
  onDeepLink: (callback: (event: { section: string; invite?: { org?: string; error?: string } }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('app:deepLink', listener);
    return () => ipcRenderer.removeListener('app:deepLink', listener);
  },
  onUpdateEvent: (callback: (event: { type: string; version?: string; percent?: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('update:event', listener);
    return () => ipcRenderer.removeListener('update:event', listener);
  },

  // Automation triggers
  triggersList: () => ipcRenderer.invoke('triggers:list') as Promise<AgentTrigger[]>,
  triggersCreate: (input: Omit<AgentTrigger, 'id' | 'createdAt' | 'lastRunAt'>) =>
    ipcRenderer.invoke('triggers:create', input) as Promise<AgentTrigger>,
  triggersUpdate: (id: string, updates: Partial<Omit<AgentTrigger, 'id' | 'createdAt'>>) =>
    ipcRenderer.invoke('triggers:update', id, updates) as Promise<AgentTrigger | null>,
  triggersDelete: (id: string) => ipcRenderer.invoke('triggers:delete', id) as Promise<{ ok: boolean }>,
  triggersSetWhatsAppAgent: (agentId: string) =>
    ipcRenderer.invoke('triggers:setWhatsAppAgent', agentId) as Promise<{ ok: boolean }>,
  triggersGetWhatsAppAgent: () => ipcRenderer.invoke('triggers:getWhatsAppAgent') as Promise<{ agentId: string }>,
  getMonthlySpend: () => ipcRenderer.invoke('usage:getMonthlySpend') as Promise<Array<{ agentId: string; agentName: string; costUsd: number; calls: number; monthlyBudgetUsd?: number }>>,
  getLlmUsage: (limit?: number) => ipcRenderer.invoke('usage:list', limit) as Promise<LlmUsageRecord[]>,
  getRoutingDecisions: (limit?: number) => ipcRenderer.invoke('routing:list', limit) as Promise<RoutingDecision[]>,
  getMemoryItems: (limit?: number) => ipcRenderer.invoke('memory:list', limit) as Promise<MemoryItem[]>,
  retireMemory: (id: string) => ipcRenderer.invoke('memory:retire', id) as Promise<{ ok: boolean }>,
  dataExport: () => ipcRenderer.invoke('data:export') as Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>,
  dataImport: () => ipcRenderer.invoke('data:import') as Promise<{ ok: boolean; canceled?: boolean; error?: string }>,

  // Local auth / users (RBAC)
  authGetState: () => ipcRenderer.invoke('auth:getState') as Promise<{ hasUsers: boolean; currentUser: LocalUser | null }>,
  authSetupOwner: (input: { email: string; name: string; password: string }) => ipcRenderer.invoke('auth:setupOwner', input) as Promise<LocalUser>,
  authLogin: (email: string, password: string) => ipcRenderer.invoke('auth:login', email, password) as Promise<LocalUser>,
  authLogout: () => ipcRenderer.invoke('auth:logout') as Promise<{ ok: boolean }>,
  authListUsers: () => ipcRenderer.invoke('auth:listUsers') as Promise<LocalUser[]>,
  authCreateUser: (input: { email: string; name: string; role: UserRole; password: string }) => ipcRenderer.invoke('auth:createUser', input) as Promise<LocalUser>,
  authUpdateRole: (userId: string, role: UserRole) => ipcRenderer.invoke('auth:updateRole', userId, role) as Promise<{ ok: boolean }>,
  authDeleteUser: (userId: string) => ipcRenderer.invoke('auth:deleteUser', userId) as Promise<{ ok: boolean }>,
  authChangePassword: (userId: string, newPassword: string) => ipcRenderer.invoke('auth:changePassword', userId, newPassword) as Promise<{ ok: boolean }>,
  shareAgent: (id: string, shared: boolean) => ipcRenderer.invoke('agents:share', id, shared) as Promise<{ ok: boolean }>,

  // Computer access control
  computerGetSettings: () => ipcRenderer.invoke('computer:getSettings') as Promise<{ level: ComputerAccessLevel; allowedRoots: string[]; shellAllow: string[]; shellDeny: string[] }>,
  computerUpdateSettings: (s: { level?: ComputerAccessLevel; allowedRoots?: string[]; shellAllow?: string[]; shellDeny?: string[] }) =>
    ipcRenderer.invoke('computer:updateSettings', s) as Promise<{ level: ComputerAccessLevel; allowedRoots: string[]; shellAllow: string[]; shellDeny: string[] }>,

  // Personal brain (local vault)

  // Chat (Slack-style channels)
  listChatChannels: () => ipcRenderer.invoke('chat:listChannels') as Promise<ChatChannelView[]>,
  getChatMessages: (channelId: string, opts?: { limit?: number; before?: string }) =>
    ipcRenderer.invoke('chat:getMessages', channelId, opts) as Promise<ChannelMessage[]>,
  sendChatMessage: (channelId: string, text: string) =>
    ipcRenderer.invoke('chat:sendMessage', channelId, text) as Promise<ChannelMessage>,
  createChatChannel: (input: { name: string; agentIds?: string[]; topic?: string }) =>
    ipcRenderer.invoke('chat:createChannel', input) as Promise<Channel>,
  renameChatChannel: (id: string, name: string) =>
    ipcRenderer.invoke('chat:renameChannel', id, name) as Promise<Channel | null>,
  deleteChatChannel: (id: string) => ipcRenderer.invoke('chat:deleteChannel', id) as Promise<void>,
  openAgentDm: (agentId: string) => ipcRenderer.invoke('chat:openDm', agentId) as Promise<Channel>,
  addChatChannelAgent: (channelId: string, agentId: string) =>
    ipcRenderer.invoke('chat:addChannelAgent', channelId, agentId) as Promise<void>,
  removeChatChannelAgent: (channelId: string, agentId: string) =>
    ipcRenderer.invoke('chat:removeChannelAgent', channelId, agentId) as Promise<void>,
  postChatSystemMessage: (channelId: string, text: string) =>
    ipcRenderer.invoke('chat:systemMessage', channelId, text) as Promise<ChannelMessage>,
  reactChatMessage: (messageId: string, emoji: string) =>
    ipcRenderer.invoke('chat:react', messageId, emoji, undefined) as Promise<Record<string, string[]>>,
  markChatRead: (channelId: string) => ipcRenderer.invoke('chat:markRead', channelId) as Promise<void>,
  onChatEvent: (listener: (event: ChatEvent) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, event: ChatEvent) => listener(event);
    ipcRenderer.on('chat:event', wrapped);
    return () => ipcRenderer.removeListener('chat:event', wrapped);
  },
  personalBrainStatus: () => ipcRenderer.invoke('personalbrain:status') as Promise<{ dir: string; files: string[] }>,
  personalBrainOpenFolder: () => ipcRenderer.invoke('personalbrain:openFolder') as Promise<{ ok: boolean }>,

  // Brain access requests (corporate GitHub + personal repo)
  brainRequestCorporateAccess: (input: { scope?: 'read' | 'write'; reason?: string }) =>
    ipcRenderer.invoke('brain:requestCorporateAccess', input) as Promise<Record<string, unknown>>,
  brainListRequests: () => ipcRenderer.invoke('brain:listRequests') as Promise<Array<Record<string, unknown>>>,
  brainDecideRequest: (id: string, decision: 'approved' | 'rejected') =>
    ipcRenderer.invoke('brain:decideRequest', id, decision) as Promise<{ ok: boolean; status: string }>,
  brainCreatePersonalRepo: (repoName?: string) =>
    ipcRenderer.invoke('brain:createPersonalRepo', repoName) as Promise<{ ok: boolean; repo?: string; url?: string; dir?: string; error?: string }>,
});

// Type declarations for the exposed API
declare global {
  interface Window {
    electronAPI: {
      platform: string;
      loginOpenInSafari: (provider: 'superagentskill' | 'openai' | 'anthropic') => Promise<void>;
      workArtifacts: (id: string) => Promise<import('../shared/artifacts.js').WorkArtifact[]>;
      workCheckpoint: (id: string) => Promise<{ available: boolean; steps: ToolStep[] }>;
      workReconcile: (id: string, key: string, result: string, revision?: number) => Promise<void>;
      workContext: () => Promise<WorkContext>;
      workspaceConnection: () => Promise<{ url: string; connected: boolean }>;
      workspaceConnect: (url: string, token: string) => Promise<WorkContext>;
      workspaceDisconnect: () => Promise<void>;
      mcpList: () => Promise<{ configs: McpConfig[]; statuses: Array<{id:string;connected:boolean;tools:string[];error?:string}> }>;
      mcpConfigure: (configs: unknown) => Promise<Array<{id:string;connected:boolean;tools:string[];error?:string}>>;
      workPreview: (id: string) => Promise<WorkPreview>;
      workList: () => Promise<WorkSnapshot>;
      workCreate: (input: CreateWorkInput) => Promise<WorkTask>;
      workAction: (id: string, action: WorkAction, note?: string, revision?: number) => Promise<WorkTask>;
      workReviewRule: (id: string, accept: boolean, version?: number) => Promise<void>;
      workExport: () => Promise<string>;
      getVersion: () => Promise<string>;
      getPath: (name: string) => Promise<string>;
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      getAgents: () => Promise<Agent[]>;
      getAgentReputations: () => Promise<Record<string, { avg: number; count: number }>>;
      getAgent: (id: string) => Promise<Agent | null>;
      createAgent: (input: CreateAgentInput) => Promise<Agent>;
      updateAgent: (id: string, updates: Partial<AgentConfig> & { avatar?: string | null; managerId?: string | null }) => Promise<Agent>;
      deleteAgent: (id: string) => Promise<void>;
      executeAgent: (id: string, input: Record<string, unknown>) => Promise<AgentExecution>;
      executeAgentDryRun: (id: string, input: Record<string, unknown>) => Promise<AgentExecution>;
      cancelExecution: (executionId: string) => Promise<void>;
      getAgentExecutions: (agentId?: string) => Promise<AgentExecution[]>;
      getExecutionToolCalls: (executionId: string) => Promise<ExecutionToolCall[]>;
      getTeams: () => Promise<Team[]>;
      getTeam: (id: string) => Promise<Team | null>;
      sakStatus: () => Promise<SakStatus>;
      sakConnect: () => Promise<SakStatus>;
      sakCancel: () => Promise<SakStatus>;
      sakDisconnect: () => Promise<SakStatus>;
      sakSearch: (query: string) => Promise<SakHit[]>;
      sakPreview: (slug: string) => Promise<SakPreview>;
      sakInstall: (digest: string, agentId: string) => Promise<{skillId:string;agentId:string;name:string}>;
      exportMaterial: (format: 'pdf' | 'pptx', title: string, content: string) => Promise<number[]>;
      createBusinessTeam: (input: BusinessTeamInput) => Promise<BusinessTeamResult>;
      createTeam: (config: TeamConfig) => Promise<Team>;
      updateTeam: (id: string, config: Partial<TeamConfig>) => Promise<Team>;
      deleteTeam: (id: string) => Promise<void>;
      addAgentToTeam: (teamId: string, agentId: string) => Promise<Team>;
      removeAgentFromTeam: (teamId: string, agentId: string) => Promise<Team>;
      executeTeam: (teamId: string, input: Record<string, unknown>) => Promise<{
        teamId: string;
        status: 'completed' | 'failed' | 'partial';
        results: Array<{
          agentId: string;
          agentName: string;
          status: 'completed' | 'failed';
          output?: Record<string, unknown>;
          error?: string;
        }>;
        duration: number;
      }>;
      getGovernanceState: () => Promise<{ pendingApprovals: Approval[]; rules: GovernanceRule[] }>;
      getPendingApprovals: () => Promise<Approval[]>;
      approveAction: (actionId: string) => Promise<void>;
      rejectAction: (actionId: string, reason: string) => Promise<void>;
      setGovernanceRule: (rule: GovernanceRule) => Promise<void>;
      getGovernanceRules: () => Promise<GovernanceRule[]>;
      deleteGovernanceRule: (ruleId: string) => Promise<void>;
      getRemoteApprovalsStatus: () => Promise<{ enabled: boolean; url: string | null }>;
      setRemoteApprovalsEnabled: (enabled: boolean) => Promise<{ ok: boolean; url: string | null }>;
      regenerateRemoteApprovalsLink: () => Promise<{ ok: boolean; url: string | null }>;
      getAuditLogs: (limit?: number, offset?: number) => Promise<AuditEntry[]>;
      exportAuditReceiptJson: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; entryCount?: number; head?: string; error?: string }>;
      exportAuditReceiptHtml: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; entryCount?: number; head?: string; error?: string }>;
      getSettings: () => Promise<AppSettings>;
      updateSettings: (settings: Partial<AppSettings>) => Promise<Record<string, string>>;
      setApiKey: (provider: 'openai' | 'anthropic', key: string) => Promise<void>;
      clearApiKey: (provider: 'openai' | 'anthropic') => Promise<void>;
      hasApiKey: (provider: 'openai' | 'anthropic') => Promise<boolean>;
      listCompanyBrains: () => Promise<import('../shared/company-brain.js').CompanyBrainBinding[]>;
      saveCompanyBrain: (binding: import('../shared/company-brain.js').CompanyBrainBinding) => Promise<import('../shared/company-brain.js').CompanyBrainBinding>;
      removeCompanyBrain: (agentId: string) => Promise<void>;
      testCompanyBrain: (agentId: string) => Promise<boolean>;
      listCompatibleProviders: () => Promise<import('../shared/connectors.js').CompatibleProviderProfile[]>;
      saveCompatibleProvider: (profile: import('../shared/connectors.js').CompatibleProviderProfile, apiKey?: string) => Promise<import('../shared/connectors.js').CompatibleProviderProfile>;
      removeCompatibleProvider: (id: string) => Promise<void>;
      testCompatibleProvider: (id: string) => Promise<import('../shared/connectors.js').CompatibleModelDiscovery>;
      isModelConfigured: (model: string) => Promise<boolean>;
      listModels: () => Promise<import('../shared/models.js').ModelCatalogResponse>;
      refreshModels: () => Promise<import('../shared/models.js').ModelCatalogResponse & { errors?: Record<string, string> }>;
      oauthAuthenticate: (provider: 'openai' | 'anthropic') => Promise<{
        success: boolean;
        tokens?: {
          accessToken: string;
          refreshToken?: string;
          expiresAt?: number;
          tokenType: string;
        };
        error?: string;
      }>;
      oauthPendingUrl: (provider: 'openai' | 'anthropic') => Promise<string | null>;
      oauthCancel: (provider: 'openai' | 'anthropic') => Promise<void>;
      oauthIsAuthenticated: (provider: 'openai' | 'anthropic') => Promise<boolean>;
      oauthIsConfigured: (provider: 'openai' | 'anthropic') => Promise<boolean>;
      oauthGetToken: (provider: 'openai' | 'anthropic') => Promise<string | null>;
      oauthLogout: (provider: 'openai' | 'anthropic') => Promise<void>;
      secondBrainGetConfig: () => Promise<{ enabled: boolean; url: string; hasToken: boolean; access?: string; blockPii?: boolean }>;
      secondBrainSetConfig: (config: { enabled?: boolean; url?: string; token?: string; access?: 'read' | 'write'; blockPii?: boolean }) =>
        Promise<{ enabled: boolean; url: string; hasToken: boolean; access?: string; blockPii?: boolean }>;
      secondBrainTest: () => Promise<{ ok: boolean; error?: string }>;
      granolaGetStatus: () => Promise<{ enabled: boolean; connected: boolean; account?: string; lastSync?: string; lastSyncError?: string; syncedCount: number; syncMinutes: number }>;
      granolaConnect: () => Promise<{ ok: boolean; account?: string; error?: string }>;
      granolaDisconnect: () => Promise<{ ok: boolean }>;
      granolaTest: () => Promise<{ ok: boolean; tools?: string[]; error?: string }>;
      granolaSyncNow: () => Promise<{ synced: number; skipped: number; removed?: number; error?: string }>;
      granolaSetSyncMinutes: (minutes: number) => Promise<{ ok: boolean; syncMinutes: number }>;
      activityDigest: () => Promise<{
        windowHours: number;
        executions: number;
        byChannel: Record<string, number>;
        recentExecs: Array<{ id: string; agentId: string; status: string; channel: string; startedAt?: string }>;
        integrations: Array<{ action: string; agentName: string; timestamp: string; output: Record<string, unknown> }>;
        whatsappMessages: number;
        memories: number;
      }>;
      governanceSummary: () => Promise<{
        totalEntries: number;
        totalExecutions: number;
        byCategory: Record<string, number>;
        byUser: Array<{ userId: string; count: number }>;
        topActions: Array<{ action: string; count: number }>;
        approvals: { pending: number; approved: number; rejected: number };
        execByStatus: Record<string, number>;
        execByChannel: Record<string, number>;
        topTools: Array<{ name: string; count: number }>;
        recent: Array<{ id: string; timestamp: string; userId: string; agentName: string; action: string; category: string }>;
      }>;
      appGetMode: () => Promise<'personal' | 'corporate' | 'unset'>;
      appSetMode: (mode: 'personal' | 'corporate') => Promise<{ ok: boolean; mode?: string; error?: string }>;
      brainInstallProduct: (product: 'personal' | 'corporate') => Promise<{ ok: boolean; path?: string; error?: string }>;
      onBrainInstallProgress: (callback: (p: { received: number; total: number }) => void) => () => void;
      whatsappGetStatus: () => Promise<{ status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error'; phone: string }>;
      whatsappStart: () => Promise<{ status: string; phone: string }>;
      whatsappStop: () => Promise<{ status: string; phone: string }>;
      whatsappSendMessage: (to: string, text: string) => Promise<{ ok: boolean }>;
      whatsappGetMessages: (limit?: number, remote?: string) => Promise<Array<{ id: string; direction: string; remote: string; text: string; timestamp: number }>>;
      whatsappClearMessages: () => Promise<{ ok: boolean }>;
      composioGetStatus: () => Promise<{ configured: boolean; keyHint: string | null }>;
      composioSetApiKey: (key: string) => Promise<{ configured: boolean; keyHint: string | null }>;
      composioClearApiKey: () => Promise<{ configured: boolean; keyHint: string | null }>;
      composioTest: () => Promise<{ ok: boolean; error?: string }>;
      composioListToolkits: () => Promise<Array<{ slug: string; name: string }>>;
      composioListConnections: () => Promise<Array<{ toolkit: string; connectedAccountId: string; status: string }>>;
      composioConnect: (toolkit: string) => Promise<{ id: string; redirectUrl: string | null }>;
      composioDisconnect: (id: string) => Promise<{ ok: boolean }>;
      agentReachStatus: () => Promise<{ ok: boolean; installed: boolean; channels: Array<{ name: string; status: string; backend: string | null }>; error?: string }>;
      onWhatsAppEvent: (callback: (event: {
        type: 'status' | 'qr' | 'message' | 'error';
        status?: string;
        qrDataUrl?: string;
        phone?: string;
        error?: string;
        message?: { from: string; text: string; timestamp: number };
      }) => void) => () => void;
      getSkills: () => Promise<Skill[]>;
      getSkill: (id: string) => Promise<Skill | null>;
      createSkill: (skill: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Skill>;
      updateSkill: (id: string, updates: Partial<Omit<Skill, 'id' | 'createdAt'>>) => Promise<Skill>;
      deleteSkill: (id: string) => Promise<void>;
      listSkillTools: () => Promise<Array<{ name: string; description: string }>>;
      improveSkill: (id: string) => Promise<{ improvedPrompt: string }>;
      importSkillFromGitHub: (url: string) => Promise<{
        skills: Array<{ name: string; description: string; prompt: string; toolNames: string[]; source: string; sourceRef?: string; files?: string[]; ignored?: string[] }>;
        skipped: Array<{ name: string; reason: string }>;
      }>;
      importSkillFromFolder: (dir?: string) => Promise<{
        skills: Array<{ name: string; description: string; prompt: string; toolNames: string[]; source: string; sourceRef?: string; files?: string[]; ignored?: string[] }>;
        skipped: Array<{ name: string; reason: string }>;
        canceled?: boolean;
      }>;
      listSkillMarketplace: () => Promise<Array<{
        id: string; name: string; description: string; source: string;
        tags: string[]; audience: string; version: string; featured?: boolean;
        installed: boolean; installedCount: number;
      }>>;
      installSkillFromMarketplace: (id: string) => Promise<{
        skills: Array<{ name: string; description: string; prompt: string; toolNames: string[]; source: string; sourceRef?: string; files?: string[]; ignored?: string[] }>;
        skipped: Array<{ name: string; reason: string }>;
      }>;
      onAgentEvent: (callback: (event: { executionId: string; type: string; data?: unknown }) => void) => () => void;
      getCompany: () => Promise<{ name: string; description: string; industry: string; website: string }>;
      updateCompany: (profile: Record<string, string>) => Promise<Record<string, string>>;
      updateCheck: () => Promise<{ ok: boolean; updateInfo?: { version: string } | null; error?: string }>;
      updateDownload: () => Promise<{ ok: boolean; error?: string }>;
      updateInstall: () => Promise<{ ok: boolean; error?: string }>;
      onUpdateEvent: (callback: (event: { type: string; version?: string; percent?: number }) => void) => () => void;
      onDeepLink: (callback: (event: { section: string; invite?: { org?: string; error?: string } }) => void) => () => void;
      triggersList: () => Promise<AgentTrigger[]>;
      triggersCreate: (input: Omit<AgentTrigger, 'id' | 'createdAt' | 'lastRunAt'>) => Promise<AgentTrigger>;
      triggersUpdate: (id: string, updates: Partial<Omit<AgentTrigger, 'id' | 'createdAt'>>) => Promise<AgentTrigger | null>;
      triggersDelete: (id: string) => Promise<{ ok: boolean }>;
      triggersSetWhatsAppAgent: (agentId: string) => Promise<{ ok: boolean }>;
      triggersGetWhatsAppAgent: () => Promise<{ agentId: string }>;
      getMonthlySpend: () => Promise<Array<{ agentId: string; agentName: string; costUsd: number; calls: number; monthlyBudgetUsd?: number }>>;
      getLlmUsage: (limit?: number) => Promise<LlmUsageRecord[]>;
      getRoutingDecisions: (limit?: number) => Promise<RoutingDecision[]>;
      getMemoryItems: (limit?: number) => Promise<MemoryItem[]>;
      retireMemory: (id: string) => Promise<{ ok: boolean }>;
      dataExport: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
      dataImport: () => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
      authGetState: () => Promise<{ hasUsers: boolean; currentUser: LocalUser | null }>;
      authSetupOwner: (input: { email: string; name: string; password: string }) => Promise<LocalUser>;
      authLogin: (email: string, password: string) => Promise<LocalUser>;
      authLogout: () => Promise<{ ok: boolean }>;
      authListUsers: () => Promise<LocalUser[]>;
      authCreateUser: (input: { email: string; name: string; role: UserRole; password: string }) => Promise<LocalUser>;
      authUpdateRole: (userId: string, role: UserRole) => Promise<{ ok: boolean }>;
      authDeleteUser: (userId: string) => Promise<{ ok: boolean }>;
      authChangePassword: (userId: string, newPassword: string) => Promise<{ ok: boolean }>;
      shareAgent: (id: string, shared: boolean) => Promise<{ ok: boolean }>;
      computerGetSettings: () => Promise<{ level: ComputerAccessLevel; allowedRoots: string[]; shellAllow: string[]; shellDeny: string[] }>;
      computerUpdateSettings: (s: { level?: ComputerAccessLevel; allowedRoots?: string[]; shellAllow?: string[]; shellDeny?: string[] }) =>
        Promise<{ level: ComputerAccessLevel; allowedRoots: string[]; shellAllow: string[]; shellDeny: string[] }>;
      listChatChannels: () => Promise<ChatChannelView[]>;
      getChatMessages: (channelId: string, opts?: { limit?: number; before?: string }) => Promise<ChannelMessage[]>;
      sendChatMessage: (channelId: string, text: string) => Promise<ChannelMessage>;
      createChatChannel: (input: { name: string; agentIds?: string[]; topic?: string }) => Promise<Channel>;
      renameChatChannel: (id: string, name: string) => Promise<Channel | null>;
      deleteChatChannel: (id: string) => Promise<void>;
      openAgentDm: (agentId: string) => Promise<Channel>;
      addChatChannelAgent: (channelId: string, agentId: string) => Promise<void>;
      removeChatChannelAgent: (channelId: string, agentId: string) => Promise<void>;
      postChatSystemMessage: (channelId: string, text: string) => Promise<ChannelMessage>;
      reactChatMessage: (messageId: string, emoji: string) => Promise<Record<string, string[]>>;
      markChatRead: (channelId: string) => Promise<void>;
      onChatEvent: (listener: (event: ChatEvent) => void) => () => void;
      personalBrainStatus: () => Promise<{ dir: string; files: string[] }>;
      personalBrainOpenFolder: () => Promise<{ ok: boolean }>;
      brainRequestCorporateAccess: (input: { scope?: 'read' | 'write'; reason?: string }) => Promise<Record<string, unknown>>;
      brainListRequests: () => Promise<Array<Record<string, unknown>>>;
      brainDecideRequest: (id: string, decision: 'approved' | 'rejected') => Promise<{ ok: boolean; status: string }>;
      brainCreatePersonalRepo: (repoName?: string) => Promise<{ ok: boolean; repo?: string; url?: string; dir?: string; error?: string }>;
    };
  }
}

