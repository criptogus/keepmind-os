import { CheckpointStore } from './execution/CheckpointStore.js';
import { HybridMemory, localEmbedder } from './integrations/HybridMemory.js';
import { WorkManager } from './work/WorkManager.js';
import type { CreateWorkInput, WorkAction } from '../shared/work.js';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron';
import * as path from 'path';
import { StorageManager } from './storage/StorageManager.js';
import { AgentManager } from './agent/AgentManager.js';
import { TeamExecutionEngine } from './agent/TeamExecutionEngine.js';
import { OAuthManager } from './auth/OAuthManager.js';
import { CredentialStore } from './auth/CredentialStore.js';
import { readCodexCliAuth, codexAuthToOAuthTokens } from './auth/CodexCliAuth.js';
import { SecondBrainManager } from './integrations/SecondBrainManager.js';
import { PersonalBrainManager } from './integrations/PersonalBrainManager.js';
import { WhatsAppManager } from './integrations/WhatsAppManager.js';
import { AudioTranscriber } from './integrations/AudioTranscriber.js';
import { ComposioManager } from './integrations/ComposioManager.js';
import { judgePii } from './integrations/PiiJudge.js';
import { TriggerManager } from './agent/TriggerManager.js';
import { LocalAuth } from './auth/LocalAuth.js';
import { importSkillsFromGitHub } from './integrations/SkillImporter.js';
import { MemoryManager } from './integrations/MemoryManager.js';
import { downloadAndOpenInstaller } from './integrations/productInstall.js';
import { createMemoryJudge } from './integrations/MemoryJudge.js';
import { getCachedCatalog, isCacheFresh, knownModelIds, refreshModelCatalog, type ProviderCredentials } from './integrations/ModelCatalog.js';
import { routeModelForTask, DEFAULT_MODEL, costFromUsage, type ModelProvider } from '../shared/models.js';
import { createServer, type Server } from 'node:http';
import { autoUpdater } from 'electron-updater';
import { installDownloadedMacUpdate } from './updater/macInstaller.js';
import { exec } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import type { Skill } from '../shared/types.js';
import { v4 as uuidv4 } from 'uuid';
import type { AgentConfig, CreateAgentInput, TeamConfig, GovernanceRule, AppSettings, AgentTrigger, Approval, LocalUser, UserRole, ComputerAccessLevel } from '../shared/types.js';
import { presetAvatarFor, avatarJson, parseAvatarDefinition } from '../shared/avatars.js';

if (process.env.KEEPMIND_DATA_DIR) app.setPath('userData', path.resolve(process.env.KEEPMIND_DATA_DIR));

let mainWindow: BrowserWindow | null = null;
let storageManager: StorageManager;
let agentManager: AgentManager;
let teamExecutionEngine: TeamExecutionEngine;
let oauthManager: OAuthManager;
let credentialStore: CredentialStore;
let secondBrainManager: SecondBrainManager;
let personalBrainManager: PersonalBrainManager;
let memoryManager: MemoryManager;
let hybridMemory: HybridMemory;
let webhookServer: Server | null = null;
let whatsAppManager: WhatsAppManager;
let composioManager: ComposioManager;
let triggerManager: TriggerManager;
let localAuth: LocalAuth;
let workManager: WorkManager;
let checkpoints: CheckpointStore;
let workspaceDir = '';
let tray: Tray | null = null;

// Raw API keys kept for catalog refresh (model lists). Session-only, like the
// clients themselves — keys are re-entered each app launch today.
const providerApiKeys: Partial<Record<ModelProvider, string>> = {};

const MAX_DELEGATION_DEPTH = 3;

const ROLE_RANK: Record<UserRole, number> = { member: 0, admin: 1, owner: 2 };
const currentRole = (): UserRole | undefined => localAuth?.getCurrentUser()?.role;
const hasRole = (min: UserRole): boolean => {
  // Single-user mode: with no accounts configured, everything is allowed.
  if (localAuth && !localAuth.hasUsers()) return true;
  const r = currentRole();
  return r !== undefined && ROLE_RANK[r] >= ROLE_RANK[min];
};
/** Throws a renderer-visible error when the caller lacks the role. */
function requireRole(min: UserRole): void {
  if (!hasRole(min)) throw new Error(`Requires ${min} role`);
}
/**
 * ipcMain.handle wrapper enforcing session auth: once any user exists,
 * every non-auth channel requires a logged-in user. Role checks happen
 * inside individual handlers via requireRole().
 */
function handle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (channel.startsWith('auth:')) return listener(event, ...args);
    if (localAuth?.hasUsers() && !localAuth.getCurrentUser()) {
      throw new Error('Login required');
    }
    return listener(event, ...args);
  });
}

const currentUserId = (): string | undefined => localAuth?.getCurrentUser()?.id;
const currentUserEmail = (): string => localAuth?.getCurrentUser()?.email ?? 'system';

/** Gated tools a member must never see offered to the model. */
const MEMBER_DENIED_TOOLS = ['shell_exec', 'file_write', 'open_url', 'whatsapp_send_message', 'delegate_to_agent', 'create_agent', 'review_agent', 'secondbrain_remember', 'personalbrain_remember', 'composio_execute'];

const ACCESS_RANK: Record<ComputerAccessLevel, number> = { workspace: 0, authorized: 1, full: 2 };
function computerSettings() {
  const s = storageManager.getAllSettings();
  const parseList = (key: string): string[] => {
    try { const v = JSON.parse(s[key] || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  };
  return {
    level: (s['computer.access'] || 'workspace') as ComputerAccessLevel,
    allowedRoots: parseList('computer.allowedRoots'),
    shellAllow: parseList('computer.shellAllow'),
    shellDeny: parseList('computer.shellDeny'),
  };
}

/** Effective computer access for an execution: min(agent, install), member→workspace. */
function effectiveComputerAccess(agentLevel?: ComputerAccessLevel): { fileAccess: ComputerAccessLevel; shellAccess: 'disabled' | 'allowlist' | 'full' } {
  const cs = computerSettings();
  const effRank = Math.min(
    agentLevel ? ACCESS_RANK[agentLevel] : ACCESS_RANK.full,
    ACCESS_RANK[cs.level]
  );
  const level = (Object.keys(ACCESS_RANK) as ComputerAccessLevel[]).find((k) => ACCESS_RANK[k] === effRank) ?? 'workspace';
  const capped = currentRole() === 'member' ? 'workspace' : level;
  return {
    fileAccess: capped,
    shellAccess: capped === 'workspace' ? 'disabled' : capped === 'authorized' ? 'allowlist' : 'full',
  };
}

const EXPIRY_SKEW_MS = 60_000;

/**
 * Sync OpenAI OAuth credentials from a local Codex CLI install
 * (~/.codex/auth.json). Used when our stored token is missing/expired —
 * the CLI login shares the same OAuth client, so tokens are interchangeable.
 */
async function syncCodexCliAuth(): Promise<void> {
  const cli = readCodexCliAuth();
  if (!cli?.accessToken) return;

  const stored = credentialStore.getOAuth('openai');
  const storedValid = !!stored?.accessToken &&
    (!stored.expiresAt || stored.expiresAt > Date.now() + EXPIRY_SKEW_MS);
  if (storedValid) return;

  const cliValid = !cli.expiresAt || cli.expiresAt > Date.now() + EXPIRY_SKEW_MS;
  const apply = (tokens: { accessToken: string; refreshToken?: string; expiresAt?: number; tokenType?: string; accountId?: string }) => {
    agentManager.setOAuthToken('openai', tokens.accessToken);
    const accountId = tokens.accountId ?? cli.accountId;
    if (accountId) agentManager.setOAuthAccountId('openai', accountId);
    credentialStore.setOAuth('openai', {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? cli.refreshToken,
      expiresAt: tokens.expiresAt ?? cli.expiresAt,
      tokenType: tokens.tokenType ?? 'Bearer',
      accountId,
    });
    logOAuth(`codex-cli auth imported (accountId=${accountId ?? 'none'})`);
  };

  if (cliValid) {
    apply(codexAuthToOAuthTokens(cli));
    return;
  }
  if (cli.refreshToken) {
    try {
      const refreshed = await oauthManager.refreshToken('openai', cli.refreshToken);
      apply({ ...refreshed, accountId: cli.accountId });
    } catch (e) {
      logOAuth(`codex-cli token refresh failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
let activeDelegationDepth = 0;

/** Runs an agent execution end-to-end: streams events, persists the result. */
async function runAgentExecution(agentId: string, input: Record<string, unknown>, opts?: { userId?: string; resumeId?: string }) {
  const agent = storageManager.getAgent(agentId);
  if (!agent) throw new Error('Agent not found');
  // Members may only execute agents explicitly shared by an admin.
  if (currentRole() === 'member' && !agent.isShared) {
    throw new Error('This agent is not shared with members');
  }

  const concurrency = Math.max(1, Math.min(32, Number(storageManager.getSetting('maxConcurrentExecutions')) || 4));
  if (agentManager.getActiveExecutions().length >= concurrency) throw new Error('Concurrent execution limit reached; wait for a running task to finish');
  const previousRun = opts?.resumeId ? storageManager.getAgentExecution(opts.resumeId) : undefined;
  if (opts?.resumeId && (!previousRun || previousRun.agentId !== agentId || (previousRun.status !== 'failed' && !(previousRun.status === 'completed' && checkpoints.read(opts.resumeId)?.output)) || !checkpoints.read(opts.resumeId))) throw new Error('Execution cannot be resumed');
  if (previousRun) input = previousRun.input;
  const executionId = opts?.resumeId ?? uuidv4();
  const userId = opts?.userId ?? currentUserId() ?? 'system';
  const startedAt = previousRun?.startedAt ?? new Date().toISOString();
  if (typeof input.workTaskId === 'string') workManager.attachExecution(input.workTaskId, executionId);
  storageManager.saveAgentExecution({ id: executionId, agentId, input, userId, startedAt, status: 'running', progress: 0 });
  try {
    const execution = await agentManager.executeAgent(agentId, agent.config, input, (progress) => {
      storageManager.updateAgentExecutionProgress(executionId, progress);
    }, executionId, (event) => {
      mainWindow?.webContents.send('agents:event', { executionId, ...event });
    });
    execution.userId = userId;
    storageManager.saveAgentExecution(execution);
    return execution;
  } catch (error) {
    const previous = storageManager.getAgentExecution(executionId);
    storageManager.saveAgentExecution({ id: executionId, agentId, input, userId, startedAt,
      status: previous?.status === 'cancelled' ? 'cancelled' : 'failed', progress: previous?.progress ?? 0,
      completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    mainWindow?.webContents.send('agents:event', { executionId, type: 'done' });
  }
}

/** Seeds built-in skills once so agents can opt into computer/delegation tools. */
function seedBuiltInSkills() {
  const all = storageManager.getAllSkills();
  const byName = new Map(all.map((s) => [s.name, s]));
  const now = new Date().toISOString();
  const seeds: Array<Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>> = [
    {
      name: 'Local Computer',
      description: 'Read/write files, list directories, run shell commands and open URLs on this machine. Files are confined to the app workspace; shell commands have a 30s timeout.',
      prompt: 'You can operate the local computer through tools: file_read/file_write/file_list work inside the workspace directory, shell_exec runs commands, open_url opens URLs. Prefer file tools for documents; use shell_exec for scripts, git, package managers and system tasks. Always confirm destructive commands are necessary before running them.',
      toolNames: ['file_read', 'file_write', 'file_list', 'shell_exec', 'open_url'],
    },
    {
      name: 'Agent Delegation',
      description: 'Delegate sub-tasks to other agents, create subordinate specialists, and review their work.',
      prompt: 'You can hand off work to other agents with delegate_to_agent(agent, task). Use it when a sub-task benefits from a different agent persona or when work can be parallelized. Delegate focused, self-contained tasks and incorporate the returned results into your final answer. You can create a new specialist reporting to you with create_agent(name, description, systemPrompt, model?, skillNames?) when a recurring sub-area deserves its own agent — a human approves each creation. After delegating, record a quality review with review_agent(agent, rating, note) so the team learns which agents perform well.',
      toolNames: ['delegate_to_agent', 'create_agent', 'review_agent'],
    },
    {
      name: 'Second Brain',
      description: 'Search and store knowledge in the company second brain (KeepMind Corp).',
      prompt: 'Use secondbrain_search to recall company knowledge before answering questions about the business, and secondbrain_remember to persist important facts, decisions or notes the user shares.',
      toolNames: ['secondbrain_search', 'secondbrain_remember'],
    },
    {
      name: 'WhatsApp',
      description: 'Read incoming WhatsApp messages and send WhatsApp text messages via the connected account.',
      prompt: 'You can read recent incoming messages with whatsapp_read_messages(limit) and send replies with whatsapp_send_message(to, text). The "to" parameter is a phone number with country code and digits only (e.g. 5511999999999). Keep messages concise.',
      toolNames: ['whatsapp_send_message', 'whatsapp_read_messages'],
    },
    {
      name: 'Agent Reach — Internet Access',
      description: 'Read and search content across 15+ platforms (X/Twitter, Reddit, YouTube, GitHub, LinkedIn, Xiaohongshu, web, RSS) using the locally installed Agent Reach toolchain and real session credentials.',
      prompt: `Internet research and platform access via Agent Reach (CLI: agent-reach, config: ~/.agent-reach).

Agent Reach is a router/doctor layer — it does NOT wrap calls; you invoke the upstream CLIs/backends it configures. Workflow:

1. First call the agent_reach_status tool (or run \`agent-reach doctor --json\` via shell_exec) to see which backend serves each platform right now. Only use channels reporting ok/warn.
2. Zero-config reads: web pages via the web_read_url tool (Jina Reader, returns clean text); YouTube via \`yt-dlp --dump-json URL\` or \`yt-dlp --write-auto-subs --skip-download URL\`; GitHub via the \`gh\` CLI; general web search via \`mcporter call 'exa.web_search_exa(query: "...", numResults: 5)'\` when configured.
3. Authenticated channels (X/Twitter, Xiaohongshu, Reddit, Facebook, Instagram, LinkedIn, Bilibili, V2EX, podcasts) use the user's own browser session credentials configured in Agent Reach — never ask for passwords. If a channel fails, re-run doctor and follow the backend it reports as active.
4. For platform-specific command syntax you are unsure about, read the Agent Reach skill references under its install directory with file_read instead of guessing commands.

These are READ-ONLY research capabilities: never post, reply, like, follow or write to these platforms. Combine multiple platforms for research tasks (search + social discussion + video subtitles) and cite which source each fact came from.`,
      toolNames: ['shell_exec', 'file_read', 'web_read_url', 'agent_reach_status'],
    },
    {
      name: 'Diário de Obra',
      description: 'Registra e consulta o Relatório Diário de Obra (RDO): clima, efetivo por função, serviços executados, ocorrências, fotos e pendências.',
      prompt: `Você mantém o Diário de Obra (RDO) da construtora. Para cada registro inclua: data, clima (e efeito no trabalho), efetivo por função (pedreiro, servente, operador etc.), serviços executados por ambiente/andar, ocorrências (atrasos, falta de material, acidentes, paradas), equipamentos em uso e pendências para o dia seguinte.

Regras:
- Seja factual e cronológico; não invente dados — pergunte o que faltar
- Aponte sempre o que bloqueou a produtividade (falta de material, projeto, condição climática)
- Ao final do dia, gere um resumo executivo de 5 linhas para a diretoria
- Persista decisões e fatos importantes no second brain com secondbrain_remember`,
      toolNames: ['file_read', 'file_write', 'file_list', 'sheet_read', 'sheet_write', 'pdf_read', 'secondbrain_search', 'secondbrain_remember', 'get_current_time'],
    },
    {
      name: 'Orçamento e Planejamento',
      description: 'Composição de orçamento de obras: quantitativos, composições, BDI, curva ABC de insumos, cronograma físico-financeiro.',
      prompt: `Você é um orçamentista de obras. Ao montar ou revisar orçamentos:

- Separe sempre quantitativo → composição de custos → BDI → preço de venda
- Referencie composições SINAPI/ORSE quando aplicável e indique a fonte
- Aponte itens com maior impacto no custo total (curva ABC) antes de micro-otimizar
- Considere desperdícios por serviço (argamassa, aço, cerâmica) e custos indiretos de canteiro
- Use sheet_read/sheet_write para ler e atualizar planilhas de orçamento e cronograma
- Sinalize riscos: variações de preço de insumos, itens com quantitativo duvidoso, pendências de projeto`,
      toolNames: ['sheet_read', 'sheet_write', 'pdf_read', 'file_read', 'file_write', 'file_list', 'secondbrain_search', 'secondbrain_remember', 'web_read_url', 'get_current_time'],
    },
    {
      name: 'Segurança do Trabalho (NR)',
      description: 'Checklists de segurança conforme NRs (18, 35, 4, 33 etc.), PPRA, EPIs, ocorrências e não-conformidades.',
      prompt: `Você é um técnico de segurança do trabalho em construção civil. Ao avaliar ou gerar checklists:

- Baseie-se nas NRs aplicáveis: NR-18 (condições e meio ambiente de trabalho na indústria da construção), NR-35 (trabalho em altura), NR-4 (EPI), NR-33 (espaços confinados), NR-10 quando houver parte elétrica
- Verifique: guarda-corpos, andaimes, escadas, isolamento de áreas, EPIs por função, sinalização, condições do canteiro
- Classifique cada não-conformidade: crítica / maior / menor, com ação corretiva e prazo
- Nunca minimize risco — na dúvida, classifique como crítica e recomende paralisar a atividade
- Documente ocorrências e comunique imediatamente ao responsável pela obra`,
      toolNames: ['file_read', 'file_write', 'file_list', 'pdf_read', 'sheet_read', 'sheet_write', 'secondbrain_search', 'secondbrain_remember', 'get_current_time'],
    },
    {
      name: 'Documentos e Licitações',
      description: 'Leitura e análise de documentos de obra: ART, alvarás, memoriais, editais, propostas e contratos.',
      prompt: `Você analisa documentos da construção civil. Ao ler editais, propostas ou contratos:

- ART: verifique responsável técnico, endereço da obra, prazo de vigência e cobertura
- Edital de licitação: extraia prazos, critérios de habilitação, penalidades, retenções e garantias exigidas
- Contratos: aponte cláusulas de reajuste, medições, retenção, seguro e rescisão
- Propostas: compare preço global vs. composição de custos e identifique exclusões
- Use pdf_read para extrair texto de PDFs e sheet_read para planilhas de quantitativos
- Sempre cite a página/seção do documento que embasa cada conclusão`,
      toolNames: ['pdf_read', 'sheet_read', 'file_read', 'file_write', 'file_list', 'web_read_url', 'secondbrain_search', 'secondbrain_remember', 'get_current_time'],
    },
  ];
  for (const s of seeds) {
    const existing = byName.get(s.name);
    if (existing) {
      // Merge newly added built-in tools into skills seeded by older versions.
      const merged = [...new Set([...existing.toolNames, ...s.toolNames])];
      if (merged.length !== existing.toolNames.length) {
        storageManager.saveSkill({ ...existing, toolNames: merged, updatedAt: now });
      }
      continue;
    }
    storageManager.saveSkill({ ...s, id: uuidv4(), createdAt: now, updatedAt: now });
  }
}

function shellExec(command: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { signal, timeout: 30_000, maxBuffer: 1024 * 1024, cwd: workspaceDir || undefined }, (error, stdout, stderr) => {
      const out = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (error) {
        reject(new Error(`Command failed: ${error.message}`));
      } else {
        resolve(out || '(no output)');
      }
    });
  });
}

async function getAgentReachStatus() {
  try {
    const out = await shellExec('agent-reach doctor --json');
    const parsed = JSON.parse(out.slice(out.indexOf('{')));
    const channels = Object.entries(parsed as Record<string, { status?: string; active_backend?: string | null }>)
      .map(([name, v]) => ({ name, status: v.status ?? 'unknown', backend: v.active_backend ?? null }));
    return { ok: true, installed: true, channels };
  } catch (error) {
    return { ok: false, installed: false, error: error instanceof Error ? error.message : String(error), channels: [] };
  }
}

/**
 * Indexes an inbound WhatsApp message into the second brain — but only when
 * the agent assigned as WhatsApp auto-responder actually has second-brain
 * tools (directly or through an assigned skill). Keeps indexing opt-in per
 * agent role instead of mirroring every message globally.
 */
async function indexWhatsAppMessageToSecondBrain(from: string, text: string, timestamp: number, storedId?: string): Promise<void> {
  try {
    if (!secondBrainManager?.isConfigured()) return;
    if (storedId && storageManager.isWhatsAppMessageIndexed(storedId)) return;
    const agentId = triggerManager?.getWhatsAppAgentId();
    if (!agentId) return;
    const agent = storageManager.getAgent(agentId);
    if (!agent) return;
    const config = agent.config;
    const hasSecondBrain =
      (config?.tools || []).some((t) => t?.name?.startsWith('secondbrain_')) ||
      (config?.skillIds || []).some((id) => {
        const skill = storageManager.getSkill(id);
        return (skill?.toolNames || []).some((n) => n.startsWith('secondbrain_'));
      });
    if (!hasSecondBrain) return;
    await secondBrainManager.remember(
      `WhatsApp inbound message.\nFrom: ${from}\nTime: ${new Date(timestamp).toISOString()}\nText: ${text}`
    );
    if (storedId) storageManager.markWhatsAppMessageIndexed(storedId);
  } catch (error) {
    console.error('[whatsapp] second brain indexing failed:', error);
  }
}

/** Retries indexing for inbound messages whose earlier index attempt failed. */
async function retryWhatsAppIndexing(): Promise<void> {
  if (!secondBrainManager?.isConfigured()) return;
  for (const m of storageManager.getUnindexedWhatsAppMessages(20)) {
    await indexWhatsAppMessageToSecondBrain(m.remote, m.text, m.timestamp, m.id);
  }
}

// The main bundle is always built as CJS, so __filename is defined.
const __dirname = path.dirname(__filename);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    title: 'KeepMind OS',
    backgroundColor: '#ffffff',
  });

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Initialize managers
  storageManager = new StorageManager(path.join(app.getPath('userData'), 'data'));
  storageManager.recoverInterruptedExecutions();
  workManager = new WorkManager(storageManager);
  credentialStore = new CredentialStore(storageManager);
  // Decrypt stored credentials once via the async safeStorage API — avoids
  // the per-call deprecation warning from the sync decryptString.
  await credentialStore.warm();
  localAuth = new LocalAuth(storageManager);
  personalBrainManager = new PersonalBrainManager(app.getPath('userData'));
  memoryManager = new MemoryManager(storageManager);
  hybridMemory = new HybridMemory(storageManager, memoryManager);
  memoryManager.setJudge(createMemoryJudge(() => ({
    openai: providerApiKeys.openai ?? credentialStore.getApiKey('openai') ?? undefined,
    anthropic: providerApiKeys.anthropic ?? credentialStore.getApiKey('anthropic') ?? undefined,
  })));
  seedBuiltInSkills();
  agentManager = new AgentManager();
  checkpoints = new CheckpointStore(storageManager);
  agentManager.setCheckpointStore(checkpoints);
  teamExecutionEngine = new TeamExecutionEngine();
  oauthManager = new OAuthManager(agentManager, (provider, tokens) => {
    // Preserve accountId across refreshes — refresh responses don't include it.
    const prev = credentialStore.getOAuth(provider);
    credentialStore.setOAuth(provider, { ...tokens, accountId: tokens.accountId ?? prev?.accountId });
  }, async (url) => {
    logOAuth(`openExternal attempt: ${url.slice(0, 90)}`);
    // shell.openExternal can hang silently in packaged builds; the platform
    // command is deterministic. On Windows `start` treats the first quoted
    // arg as a window title, so an empty title arg is required.
    const cmd = process.platform === 'darwin' ? `open ${JSON.stringify(url)}`
      : process.platform === 'win32' ? `cmd /c start "" ${JSON.stringify(url)}`
      : `xdg-open ${JSON.stringify(url)}`;
    await new Promise<void>((resolve, reject) => {
      exec(cmd, (err) => (err ? reject(err) : resolve()));
    });
    logOAuth('openExternal done via platform command');
  });

  // Restore persisted credentials so agents keep working across restarts.
  for (const provider of ['openai', 'anthropic'] as const) {
    const key = credentialStore.getApiKey(provider);
    if (key) {
      agentManager.setApiKey(provider, key);
      providerApiKeys[provider] = key;
    }
    const tokens = credentialStore.getOAuth(provider);
    if (tokens?.accessToken) {
      const expired = !!tokens.expiresAt && tokens.expiresAt < Date.now();
      if (expired && tokens.refreshToken) {
        try {
          await oauthManager.refreshToken(provider, tokens.refreshToken);
          continue;
        } catch {
          // Fall through and try the stored access token anyway.
        }
      }
      agentManager.setOAuthToken(provider, tokens.accessToken);
      if (tokens.accountId) agentManager.setOAuthAccountId(provider, tokens.accountId);
      const beta = oauthManager.configuredBetaHeader(provider);
      if (beta) agentManager.setOAuthBetaHeader(provider, beta);
    }
  }

  // Import Codex CLI credentials (~/.codex/auth.json) when our stored OpenAI
  // token is missing or expired — the CLI login uses the same OAuth client,
  // so its tokens work directly against the Codex backend.
  await syncCodexCliAuth();

  secondBrainManager = new SecondBrainManager(storageManager, credentialStore);
  secondBrainManager.setPiiJudge((text) =>
    judgePii(text, () => ({ openai: providerApiKeys.openai, anthropic: providerApiKeys.anthropic }))
  );
  applyUpdateFeed();
  void refreshCorpLlmKeys();
  whatsAppManager = new WhatsAppManager(app.getPath('userData'));
  whatsAppManager.setTranscriber(new AudioTranscriber(
    path.join(app.getPath('userData'), 'whisper-models'),
    () => providerApiKeys.openai ?? credentialStore.getApiKey('openai')
  ));
  whatsAppManager.setEventHandler((event) => {
    mainWindow?.webContents.send('whatsapp:event', event);
    if (event.type === 'message' && event.message) {
      const m = event.message;
      // Groups: remote = group chat JID, text prefixed with group + sender
      // context; auto-responder stays DM-only (a bot replying in a group is unsafe).
      const remote = m.isGroup ? (m.chat || m.from) : m.from;
      const text = m.isGroup
        ? `[${m.chatName || 'grupo'}] ${m.senderName || m.from}: ${m.text}`
        : m.text;
      let storedId: string | undefined;
      try {
        storedId = storageManager.saveWhatsAppMessage({
          direction: 'in', remote, text, timestamp: m.timestamp, waId: m.id,
        });
      } catch (error) {
        console.error('[whatsapp] failed to persist message:', error);
      }
      if (!m.isGroup) void triggerManager?.onWhatsAppMessage(m.from, m.text);
      void indexWhatsAppMessageToSecondBrain(remote, text, m.timestamp, storedId);
    } else if (event.type === 'status' && event.status === 'connected') {
      // Catch up on messages that failed to index earlier (e.g. brain was down)
      // and retry WhatsApp replies queued while the LLM was unreachable.
      void retryWhatsAppIndexing();
      void triggerManager?.retryWhatsAppQueue();
    }
  });

  composioManager = new ComposioManager(
    credentialStore,
    storageManager,
    async (url) => {
      await new Promise<void>((resolve, reject) => {
        exec(`open ${JSON.stringify(url)}`, (err) => (err ? reject(err) : resolve()));
      });
    }
  );

  workspaceDir = path.join(app.getPath('userData'), 'workspace');
  await fs.mkdir(workspaceDir, { recursive: true });

  triggerManager = new TriggerManager(
    (key) => storageManager.getSetting(key),
    (key, value) => storageManager.setSetting(key, value)
  );
  triggerManager.attach({
    runAgent: (agentId, input) => runAgentExecution(agentId, input),
    getAgentName: (agentId) => storageManager.getAgent(agentId)?.name,
  });
  startWebhookServer();
  agentManager.setContextProvider(async (query) => {
    if (!secondBrainManager.isConfigured()) return '';
    return secondBrainManager.search(query, 5);
  });
  agentManager.setSkillLoader((skillIds: string[]): Skill[] => {
    const skills = skillIds
      .map((id) => storageManager.getSkill(id))
      .filter((s): s is Skill => s !== null);
    for (const s of skills) storageManager.incrementSkillUsage(s.id);
    return skills;
  });

  // Skill auto-router: activates up to 2 extra skills whose name/description
  // matches the task text. Disable with setting 'skills.autoRoute' = 'false'.
  agentManager.setAutoSkillSelector((input, assigned, agentId) => {
    if (storageManager.getSetting('skills.autoRoute') === 'false') return [];
    const text = JSON.stringify(input).toLowerCase();
    const tokens = text.match(/[a-zá-ú]{4,}/g) || [];
    const assignedIds = new Set(assigned.map((s) => s.id));
    const scored = storageManager.getAllSkills()
      .filter((s) => !assignedIds.has(s.id))
      .map((s) => {
        const haystack = `${s.name} ${s.description}`.toLowerCase();
        const skillTokens = new Set(haystack.match(/[a-zá-ú]{4,}/g) || []);
        let score = 0;
        for (const t of tokens) if (skillTokens.has(t)) score++;
        return { skill: s, score };
      });
    const picked = scored
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    try {
      storageManager.saveRoutingDecision({
        kind: 'skill',
        agentId,
        subject: text.slice(0, 200),
        candidates: scored.map((x) => ({ id: x.skill.name, score: x.score })).slice(0, 20),
        decision: picked.map((x) => x.skill.name),
        reason: 'keyword-overlap heuristic (score >= 2, max 2 skills)',
      });
    } catch { /* routing audit is best-effort */ }
    return picked.map((x) => x.skill);
  });

  // LLM model router: picks a cheaper or stronger model within the same
  // provider family based on task complexity, using the shared catalog
  // (bundled + live-fetched). Disable with 'llm.autoRoute'='false'.
  agentManager.setModelRouter((model, input, agentId) => {
    if (storageManager.getSetting('llm.autoRoute') === 'false') return model;
    const routed = routeModelForTask(model, JSON.stringify(input), knownModelIds(storageManager));
    if (routed !== model) {
      try {
        storageManager.saveRoutingDecision({
          kind: 'model',
          agentId,
          subject: JSON.stringify(input).slice(0, 200),
          candidates: [{ id: model, score: 0 }, { id: routed, score: 1 }],
          decision: [routed],
          reason: 'task-complexity heuristic within provider family',
        });
      } catch { /* routing audit is best-effort */ }
    }
    return routed;
  });
  agentManager.getToolRegistry().setContext({
    sendWhatsApp: async (to, text) => {
      if (whatsAppManager.getStatus().status !== 'connected') {
        throw new Error('WhatsApp is not connected');
      }
      await whatsAppManager.sendMessage(to, text);
      try {
        storageManager.saveWhatsAppMessage({ direction: 'out', remote: to, text, timestamp: Date.now() });
      } catch (error) {
        console.error('[whatsapp] failed to persist outgoing message:', error);
      }
    },
    getWhatsAppMessages: (limit = 20) =>
      storageManager.getWhatsAppMessages(limit, undefined, 'in')
        .reverse()
        .map((m) => ({ from: m.remote, text: m.text, timestamp: m.timestamp })),
    secondBrainSearch: async (query, limit) => {
      if (!secondBrainManager.isConfigured()) throw new Error('Second brain is not configured');
      return secondBrainManager.search(query, limit);
    },
    secondBrainRemember: async (content) => {
      if (!secondBrainManager.isConfigured()) throw new Error('Second brain is not configured');
      return secondBrainManager.remember(content);
    },
    workspaceDir,
    shellExec,
    openUrl: async (url) => {
      await shellExec(`open "${url.replace(/"/g, '')}"`);
    },
    webReadUrl: async (url) => {
      const res = await fetch(`https://r.jina.ai/${url.replace(/^https?:\/\//i, '')}`, {
        headers: { Accept: 'text/plain' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Jina reader failed (${res.status})`);
      return res.text();
    },
    agentReachStatus: () => getAgentReachStatus(),
    composioSearch: async (query) => {
      if (!composioManager.isConfigured()) throw new Error('Composio is not configured');
      const tools = await composioManager.searchTools(query);
      if (!tools.length) return 'No Composio tools found for that query (or no apps connected)';
      return tools.map((t) => `${t.slug}: ${t.name} — ${t.description}`).join('\n');
    },
    composioExecute: async (slug, argsJson) => {
      if (!composioManager.isConfigured()) throw new Error('Composio is not configured');
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(argsJson); } catch { throw new Error('args must be a JSON object string'); }
      return composioManager.execute(slug, args);
    },
    personalBrainSearch: async (query, limit) => {
      const model = storageManager.getSetting('memory.embeddingModel') || 'nomic-embed-text';
      const r = await hybridMemory.search(query, limit, storageManager.getSetting('memory.semantic') === 'true' ? localEmbedder(model) : undefined, model);
      if (r.text) return { text: r.text, ids: r.ids };
      return { text: await personalBrainManager.search(query, limit), ids: [] };
    },
    personalBrainRemember: async (content, file) => {
      const summary = await memoryManager.remember(content, file ?? 'fact');
      void personalBrainManager.remember(content, file).catch(() => {});
      return summary;
    },
    delegateTask: async (callerAgentId, agent, task) => {
      if (activeDelegationDepth >= MAX_DELEGATION_DEPTH) {
        throw new Error(`Delegation depth limit (${MAX_DELEGATION_DEPTH}) reached`);
      }
      const caller = callerAgentId ? storageManager.getAgent(callerAgentId) : null;
      const agents = storageManager.getAllAgents();
      const target = agents.find((a) => a.id === agent || a.name.toLowerCase() === agent.toLowerCase());
      if (!target) throw new Error(`Agent not found: ${agent}`);
      activeDelegationDepth++;
      try {
        const execution = await runAgentExecution(target.id, {
          channel: 'delegation',
          task,
          delegatedBy: caller?.name ?? 'agent',
        });
        const content = execution.output?.content;
        // Record the delegation edge for auditability and future org insights.
        try {
          storageManager.saveAuditLog({
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            agentId: caller?.id ?? 'system',
            agentName: caller?.name ?? 'system',
            action: 'agent_delegation',
            input: { to: target.name, task: String(task).slice(0, 500) },
            output: { executionId: execution.id, status: execution.status },
            metadata: { targetAgentId: target.id },
          });
        } catch { /* delegation audit is best-effort */ }
        return typeof content === 'string' ? content : JSON.stringify(execution.output ?? {});
      } finally {
        activeDelegationDepth--;
      }
    },
    createAgent: async (callerAgentId, spec) => {
      const caller = callerAgentId ? storageManager.getAgent(callerAgentId) : null;
      const name = spec.name.trim();
      if (!name) throw new Error('Agent name is required');
      if (storageManager.getAllAgents().some((a) => a.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`An agent named "${name}" already exists`);
      }
      const skillIds = (spec.skillNames ?? [])
        .map((n) => storageManager.getAllSkills().find((s) => s.name.toLowerCase() === n.toLowerCase())?.id)
        .filter((x): x is string => !!x);
      const now = new Date().toISOString();
      const agent = {
        id: uuidv4(),
        avatar: avatarJson(presetAvatarFor(`agent:${name}`)),
        name,
        description: spec.description?.slice(0, 300) || `Created by ${caller?.name ?? 'an agent'}`,
        config: {
          model: spec.model?.trim() || DEFAULT_MODEL.openai,
          temperature: 0.7,
          maxTokens: 2048,
          systemPrompt: spec.systemPrompt?.slice(0, 8000) || `You are ${name}, a specialist agent. ${spec.description ?? ''}`.trim(),
          tools: [{ name: 'delegate_to_agent', type: 'custom' as const, config: {} }],
          skillIds,
        },
        capabilities: ['text_generation', 'reasoning'],
        managerId: caller?.id,
        permissions: {
          canAccessNetwork: true,
          canAccessFileSystem: false,
          canExecuteCode: false,
          maxExecutionTime: 300,
        },
        createdAt: now,
        updatedAt: now,
      };
      storageManager.saveAgent(agent);
      storageManager.saveAuditLog({
        id: uuidv4(),
        timestamp: now,
        agentId: caller?.id ?? 'system',
        agentName: caller?.name ?? 'system',
        action: 'agent_created_by_agent',
        input: { spec },
        output: { agentId: agent.id, name: agent.name },
        metadata: {},
      });
      return `Created agent "${agent.name}" (id: ${agent.id})${caller ? ` reporting to ${caller.name}` : ''}. A human admin can configure its model, skills and tools.`;
    },
    reviewAgent: async (callerAgentId, agentRef, rating, note) => {
      const caller = callerAgentId ? storageManager.getAgent(callerAgentId) : null;
      const agents = storageManager.getAllAgents();
      const target = agents.find((a) => a.id === agentRef || a.name.toLowerCase() === agentRef.toLowerCase());
      if (!target) throw new Error(`Agent not found: ${agentRef}`);
      const now = new Date().toISOString();
      storageManager.saveAuditLog({
        id: uuidv4(),
        timestamp: now,
        agentId: caller?.id ?? 'system',
        agentName: caller?.name ?? 'system',
        action: 'agent_review',
        input: { agent: target.name, rating, note: note.slice(0, 2000) },
        output: { ok: true },
        metadata: { targetAgentId: target.id },
      });
      return `Review recorded for "${target.name}": ${rating}/5${note ? ` — ${note.slice(0, 200)}` : ''}`;
    },
  });

  // Cost ledger + budget gate + memory outcome scoring — all best-effort;
  // none of them may break an agent run.
  agentManager.setUsageRecorder((rec) => {
    try {
      storageManager.saveLlmUsage({
        agentId: rec.agentId,
        executionId: rec.executionId,
        model: rec.model,
        provider: rec.provider,
        promptTokens: rec.usage.promptTokens,
        completionTokens: rec.usage.completionTokens,
        costUsd: rec.costUsd ?? costFromUsage(rec.model, rec.usage.promptTokens, rec.usage.completionTokens),
        partial: rec.partial ?? false,
      });
    } catch (e) { console.error('[usage] ledger write failed:', e); }
  });
  agentManager.setBudgetChecker((agentId, _model, est) => {
    const agent = storageManager.getAgent(agentId);
    const cap = agent?.config.monthlyBudgetUsd;
    if (!cap || cap <= 0) return;
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const spent = storageManager.getAgentSpendSince(agentId, monthStart.toISOString());
    if (spent + est > cap) {
      throw new Error(
        `Monthly budget exceeded for "${agent?.name ?? agentId}": $${spent.toFixed(2)} spent this month ` +
        `+ ~$${est.toFixed(4)} estimated > $${cap.toFixed(2)} cap`
      );
    }
  });
  agentManager.setMemoryOutcomeRecorder((_executionId, memoryIds, succeeded) => {
    try { memoryManager.recordOutcome(memoryIds, succeeded); }
    catch (e) { console.error('[memory] outcome record failed:', e); }
  });

  // Per-execution constraints: install computer-access ceiling + agent cap +
  // member lockdown (members get workspace-only file access, no shell, and a
  // stripped tool set — sensitive tools are never even offered to the model).
  agentManager.setConstraintsProvider((config) => {
    const cs = computerSettings();
    const eff = effectiveComputerAccess(config.computerAccess);
    const denyTools = currentRole() === 'member' ? MEMBER_DENIED_TOOLS : undefined;
    return {
      denyTools,
      policy: {
        fileAccess: eff.fileAccess,
        allowedRoots: cs.allowedRoots,
        shellAccess: eff.shellAccess,
        shellAllow: cs.shellAllow,
        shellDeny: cs.shellDeny,
      },
    };
  });

  // Governance gate: sensitive tools require human approval unless autoApprove
  // is on or the gate is disabled ('gov.toolApproval'='false'). The tool call
  // waits (polling) for a decision; approval lets it proceed, rejection or
  // timeout returns an error string to the model as the tool result.
  const GATED_TOOLS = new Set(['shell_exec', 'file_write', 'open_url', 'whatsapp_send_message', 'delegate_to_agent', 'create_agent', 'composio_execute', 'secondbrain_remember']);
  const APPROVAL_TIMEOUT_MS = 24 * 60 * 60_000;
  const sanitizeArg = (v: unknown): unknown => {
    if (typeof v === 'string') return v.length > 500 ? v.slice(0, 500) + '…[truncated]' : v;
    if (Array.isArray(v)) return v.slice(0, 20).map(sanitizeArg);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, sanitizeArg(x)]));
    }
    return v;
  };
  // Canonical JSON (sorted keys, recursively) → sha256. Binds an approval to
  // the exact arguments the reviewer saw, so a mutated payload can never ride
  // on a stale approval (TOCTOU).
  const canonicalJson = (v: unknown): string => JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val);
  const argsFingerprint = (args: Record<string, unknown>) =>
    createHash('sha256').update(canonicalJson(args)).digest('hex').slice(0, 16);
  agentManager.getToolRegistry().setGate(async (name, args, policy) => {
    policy?.signal?.throwIfAborted();
    if (!GATED_TOOLS.has(name)) return null;
    if (storageManager.getSetting('gov.toolApproval') === 'false') return null;
    if (storageManager.getAllSettings().autoApprove === 'true') return null;

    const agentId = policy?.callerAgentId || '';
    const agent = agentId ? storageManager.getAgent(agentId) : null;
    const savedApprovalId = policy?.executionId && policy.toolCallKey
      ? policy.checkpoint?.approval(policy.executionId, policy.toolCallKey) : undefined;
    const savedApproval = savedApprovalId ? storageManager.getApproval(savedApprovalId) : undefined;
    if (savedApprovalId && !savedApproval) throw new Error('Saved approval is missing');
    const approval: Approval = savedApproval ?? {
      id: uuidv4(),
      type: 'agent_action',
      agentId,
      agentName: agent?.name || 'unknown',
      action: `tool:${name}`,
      context: {
        tool: name,
        executionId: policy?.executionId,
        workTaskId: policy?.workTaskId,
        args: structuredClone(args),
        argsHash: argsFingerprint(args),
        argsTruncated: false,
      },
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    if (approval.context.argsHash !== argsFingerprint(args) || approval.context.executionId !== policy?.executionId || approval.action !== `tool:${name}`) throw new Error('Approval binding changed');
    storageManager.saveApproval(approval);
    if (policy?.executionId && policy.toolCallKey) policy.checkpoint?.approval(policy.executionId, policy.toolCallKey, approval.id);
    mainWindow?.webContents.send('governance:approvalRequested', approval);

    const deadline = Date.parse(approval.createdAt) + APPROVAL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (policy?.signal?.aborted) {
        if (policy.signal.reason?.message !== 'Application shutting down') storageManager.updateApprovalStatus(approval.id, 'rejected', 'Execution cancelled', 'system');
        policy.signal.throwIfAborted();
      }
      await new Promise((r) => setTimeout(r, 1500));
      const current = storageManager.getApproval(approval.id);
      if (current?.status === 'approved') {
        if (current.context.argsHash !== argsFingerprint(args)) throw new Error('Approved action changed');
        return null;
      }
      if (current?.status === 'rejected') {
        return `Tool call rejected by reviewer${current.rejectionReason ? `: ${current.rejectionReason}` : ''}`;
      }
    }
    // Auto-expire so the queue doesn't accumulate stale approvals.
    storageManager.updateApprovalStatus(approval.id, 'rejected', 'auto-expired: no decision within timeout', 'system');
    return `Tool call timed out after ${APPROVAL_TIMEOUT_MS / 1000}s waiting for human approval (approval ${approval.id})`;
  });

  createWindow();
  setupTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
    showMainWindow();
  });
});

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function setupTray() {
  try {
    const iconPath = path.join(__dirname, 'tray-icon.png');
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;
    image.setTemplateImage(true);
    tray = new Tray(image.resize({ width: 18, height: 18 }));
    tray.setToolTip('KeepMind OS');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open KeepMind OS', click: showMainWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('click', showMainWindow);
  } catch (error) {
    console.error('Tray setup failed:', error);
  }
}

// Deep links: keepmind://<section> focuses the app and navigates there.
const DEEP_LINK_SECTIONS = new Set([
  'dashboard', 'agents', 'teams', 'skills', 'governance', 'logs', 'settings', 'advanced',
]);

function sectionFromDeepLink(url: string): string | null {
  try {
    const u = new URL(url);
    const section = u.hostname || u.pathname.replace(/^\//, '');
    return DEEP_LINK_SECTIONS.has(section) ? section : null;
  } catch {
    return null;
  }
}

/**
 * Points electron-updater at the corp-hosted releases feed. The feed URL
 * embeds the employee's sync token (path-scoped on the server), so we store
 * only the base in settings and rebuild the full URL from the secret store.
 */
function applyUpdateFeed(): void {
  try {
    const feedBase = storageManager.getSetting('update.feedBase');
    const token = credentialStore.getSecret('secondbrain');
    if (!feedBase || !token) return;
    autoUpdater.setFeedURL({ provider: 'generic', url: `${feedBase}/${token}` });
  } catch (error) {
    console.error('[update] failed to set feed URL:', error);
  }
}

/**
 * Fetches the caller's resolved corporate LLM keys (user > title > team >
 * role > org on the server) and installs them for agent execution. Runs in
 * memory only — local keys remain the fallback when the corp has none or is
 * unreachable. Works the same whether the corp is localhost or remote.
 */
async function refreshCorpLlmKeys(): Promise<void> {
  try {
    const cfg = secondBrainManager?.getConfig();
    if (!cfg?.enabled || !cfg.url || !cfg.token) return;
    for (const provider of ['openai', 'anthropic'] as const) {
      try {
        const res = await fetch(`${cfg.url}/api/llm/token?provider=${provider}`, {
          headers: { Authorization: `Bearer ${cfg.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;
        const body = (await res.json()) as { ok?: boolean; key?: string };
        if (body.ok && body.key) {
          agentManager.setApiKey(provider, body.key);
          providerApiKeys[provider] = body.key;
        }
      } catch {
        // Provider unreachable or no key — keep whatever local credential exists.
      }
    }
  } catch {
    // Second brain not configured — nothing to do.
  }
}

/**
 * Applies a corporate invite (keepmind://join?server=…&token=…): validates the
 * sync token against the corp's /api/client-config, then configures the second
 * brain (read-only by default — an admin can raise it to read+write later).
 */
async function applyCorpInvite(server: string, token: string): Promise<void> {
  try {
    const base = server.replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) throw new Error('Invalid server URL');
    const res = await fetch(`${base}/api/client-config`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Invite validation failed (HTTP ${res.status})`);
    const cfg = (await res.json()) as { org?: string };
    secondBrainManager.setConfig({ enabled: true, url: base, token, access: 'read' });
    storageManager.setSetting('update.feedBase', `${base}/releases`);
    applyUpdateFeed();
    void refreshCorpLlmKeys();
    storageManager.saveAuditLog({
      id: uuidv4(), timestamp: new Date().toISOString(),
      agentId: 'system', agentName: 'Invite', action: 'corp_invite_applied',
      input: { server: base, org: cfg.org }, output: {}, metadata: {},
      userId: currentUserId(),
    });
    mainWindow?.webContents.send('app:deepLink', { section: 'advanced', invite: { org: cfg.org } });
  } catch (error) {
    mainWindow?.webContents.send('app:deepLink', {
      section: 'advanced',
      invite: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

function handleDeepLink(url: string) {
  if (!url.startsWith('keepmind://')) return;
  console.log('Deep link received:', url);
  showMainWindow();
  try {
    const u = new URL(url);
    const section = u.hostname || u.pathname.replace(/^\//, '');
    if (section === 'join') {
      const server = u.searchParams.get('server');
      const token = u.searchParams.get('token');
      if (server && token) {
        void applyCorpInvite(server, token);
        return;
      }
    }
    if (DEEP_LINK_SECTIONS.has(section)) {
      mainWindow?.webContents.send('app:deepLink', { section });
    }
  } catch {
    // Malformed deep link — ignore.
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on('second-instance', (_event, argv) => {
  const url = argv.find((a) => a.startsWith('keepmind://'));
  if (url) {
    handleDeepLink(url);
  } else if (mainWindow) {
    showMainWindow();
  }
});

// Single-instance + protocol registration only in the packaged app — dev and
// test launches (electron .) must not fight each other for the lock.
if (app.isPackaged) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.setAsDefaultProtocolClient('keepmind');
  }
}

app.on('window-all-closed', async () => {
  triggerManager?.stop();
  await whatsAppManager?.stop();
  await agentManager.shutdown();
  storageManager.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers - System
handle('app:getVersion', () => {
  return app.getVersion();
});

handle('app:getPath', (_event, name: Parameters<typeof app.getPath>[0]) => {
  return app.getPath(name);
});

// Window controls
handle('window:minimize', () => {
  mainWindow?.minimize();
});

handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

handle('window:close', () => {
  mainWindow?.close();
});

// Local auth (phase-1 RBAC). auth:* channels bypass the session guard.
ipcMain.handle('auth:getState', () => {
  return {
    hasUsers: localAuth.hasUsers(),
    currentUser: localAuth.getCurrentUser(),
  };
});

ipcMain.handle('auth:setupOwner', (_event, input: { email: string; name: string; password: string }) => {
  const user = localAuth.setupOwner(input);
  localAuth.login(input.email, input.password);
  return user;
});

ipcMain.handle('auth:login', (_event, email: string, password: string) => {
  const user = localAuth.login(email, password);
  if (!user) throw new Error('Invalid email or password');
  return user;
});

ipcMain.handle('auth:logout', () => {
  localAuth.logout();
  return { ok: true };
});

ipcMain.handle('auth:listUsers', () => {
  requireRole('admin');
  return localAuth.listUsers();
});

ipcMain.handle('auth:createUser', (_event, input: { email: string; name: string; role: UserRole; password: string }) => {
  requireRole('admin');
  return localAuth.createUser({ ...input, createdBy: currentUserEmail() });
});

ipcMain.handle('auth:updateRole', (_event, userId: string, role: UserRole) => {
  const actor = localAuth.getCurrentUser();
  if (!actor) throw new Error('Login required');
  localAuth.updateRole(userId, role, actor);
  return { ok: true };
});

ipcMain.handle('auth:deleteUser', (_event, userId: string) => {
  const actor = localAuth.getCurrentUser();
  if (!actor) throw new Error('Login required');
  localAuth.deleteUser(userId, actor);
  return { ok: true };
});

ipcMain.handle('auth:changePassword', (_event, userId: string, newPassword: string) => {
  const actor = localAuth.getCurrentUser();
  if (!actor) throw new Error('Login required');
  if (actor.id !== userId) requireRole('admin');
  if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters');
  localAuth.changePassword(userId, newPassword);
  return { ok: true };
});

// Agents
handle('agents:reputations', () => {
  requireRole('member');
  return storageManager.getAgentReviewStats();
});

handle('agents:getList', () => {
  const all = storageManager.getAllAgents();
  // Members only see agents shared with them (hides private system prompts).
  if (currentRole() === 'member') return all.filter((a) => a.isShared);
  return all;
});

handle('agents:get', (_event, id: string) => {
  const agent = storageManager.getAgent(id);
  if (currentRole() === 'member' && agent && !agent.isShared) return null;
  return agent;
});

/** Rejects a manager assignment that would create a reporting cycle. */
function assertNoManagerCycle(agentId: string | undefined, managerId: string | null | undefined): void {
  if (!managerId) return;
  if (agentId && managerId === agentId) throw new Error('An agent cannot manage itself');
  const seen = new Set<string>();
  let cursor: string | undefined = managerId;
  while (cursor) {
    if (agentId && cursor === agentId) throw new Error('Manager assignment would create a reporting cycle');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = storageManager.getAgent(cursor)?.managerId;
  }
}

handle('agents:create', async (_event, input: CreateAgentInput) => {
  requireRole('admin');
  const { name, description, capabilities, avatar, managerId, ...config } = input;
  if (managerId) {
    if (!storageManager.getAgent(managerId)) throw new Error('Manager agent not found');
    assertNoManagerCycle(undefined, managerId);
  }
  const agentId = uuidv4();
  const now = new Date().toISOString();

  const agent = {
    id: agentId,
    avatar: avatar ?? avatarJson(presetAvatarFor(agentId)),
    name: name || config.systemPrompt.split('\n')[0].substring(0, 50) || 'Untitled Agent',
    description: description || config.systemPrompt.substring(0, 200),
    config,
    capabilities: capabilities?.length ? capabilities : ['text_generation', 'reasoning'],
    managerId: managerId || undefined,
    permissions: {
      canAccessNetwork: true,
      canAccessFileSystem: false,
      canExecuteCode: false,
      maxExecutionTime: 300,
    },
    createdAt: now,
    updatedAt: now,
  };

  storageManager.saveAgent(agent);
  return agent;
});

handle('agents:update', (_event, id: string, updates: Partial<AgentConfig> & { avatar?: string | null; managerId?: string | null }) => {
  requireRole('admin');
  const agent = storageManager.getAgent(id);
  if (!agent) throw new Error('Agent not found');

  const { avatar, managerId, ...config } = updates;
  if (managerId !== undefined) {
    if (managerId && !storageManager.getAgent(managerId)) throw new Error('Manager agent not found');
    assertNoManagerCycle(id, managerId);
  }
  let nextAvatar = agent.avatar;
  if (avatar !== undefined) {
    if (avatar === null || avatar === '') {
      nextAvatar = undefined;
    } else {
      const parsed = parseAvatarDefinition(avatar);
      if (!parsed) throw new Error('Invalid avatar definition');
      nextAvatar = avatarJson(parsed);
    }
  }

  const updated = {
    ...agent,
    avatar: nextAvatar,
    managerId: managerId === undefined ? agent.managerId : (managerId || undefined),
    config: { ...agent.config, ...config },
    updatedAt: new Date().toISOString(),
  };
  storageManager.saveAgent(updated);
  return updated;
});

handle('agents:delete', (_event, id: string) => {
  requireRole('admin');
  // Orphaned reports become top-level instead of pointing at a dead manager.
  for (const a of storageManager.getAllAgents()) {
    if (a.managerId === id) storageManager.saveAgent({ ...a, managerId: undefined, updatedAt: new Date().toISOString() });
  }
  storageManager.deleteAgent(id);
});

handle('agents:share', (_event, id: string, shared: boolean) => {
  requireRole('admin');
  const agent = storageManager.getAgent(id);
  if (!agent) throw new Error('Agent not found');
  const user = localAuth.getCurrentUser();
  storageManager.saveAgent({
    ...agent,
    isShared: shared,
    sharedBy: shared ? user?.email : undefined,
    sharedAt: shared ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true };
});

handle('agents:execute', async (_event, id: string, input: Record<string, unknown>) => {
  return runAgentExecution(id, input, { userId: currentUserId() });
});

handle('agents:cancelExecution', async (_event, executionId: string) => {
  agentManager.cancelExecution(executionId);
  const execution = storageManager.getAgentExecution(executionId);
  if (execution) {
    storageManager.updateAgentExecutionProgress(executionId, execution.progress, 'cancelled');
  }
});

handle('agents:getExecutions', (_event, agentId?: string) => {
  // Members see only their own executions; admins/owners see all.
  if (currentRole() === 'member') {
    return storageManager.getAgentExecutions(agentId, 50, currentUserId());
  }
  return storageManager.getAgentExecutions(agentId);
});

// Skills
handle('skills:getAll', () => {
  return storageManager.getAllSkills();
});

handle('skills:get', (_event, id: string) => {
  return storageManager.getSkill(id);
});

handle('skills:create', (_event, skill: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>) => {
  requireRole('admin');
  const now = new Date().toISOString();
  // Re-import of a skill with the same name bumps its version instead of
  // duplicating — the source link + ref are preserved for update checks.
  const existing = storageManager.findSkillByName(skill.name);
  const full: Skill = existing
    ? { ...existing, ...skill, id: existing.id, createdAt: existing.createdAt, updatedAt: now, version: (existing.version ?? 1) + 1 }
    : { ...skill, id: uuidv4(), createdAt: now, updatedAt: now, version: 1 };
  storageManager.saveSkill(full);
  return full;
});

handle('skills:update', (_event, id: string, updates: Partial<Omit<Skill, 'id' | 'createdAt'>>) => {
  requireRole('admin');
  const existing = storageManager.getSkill(id);
  if (!existing) throw new Error('Skill not found');
  const updated: Skill = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
  storageManager.saveSkill(updated);
  return updated;
});

handle('skills:delete', (_event, id: string) => {
  requireRole('admin');
  storageManager.deleteSkill(id);
});

handle('skills:listTools', () => {
  return agentManager.getToolRegistry().list();
});

handle('skills:importGitHub', async (_event, url: string) => {
  requireRole('admin');
  return importSkillsFromGitHub(url);
});

// AI-assisted skill improvement: rewrites a skill prompt using the default
// model, conditioned on recent execution outputs of agents using the skill.
handle('skills:improve', async (_event, id: string) => {
  requireRole('admin');
  const skill = storageManager.getSkill(id);
  if (!skill) throw new Error('Skill not found');

  const agents = storageManager.getAllAgents().filter((a) => a.config.skillIds?.includes(id));
  const executions = agents
    .flatMap((a) => storageManager.getAgentExecutions(a.id, 5))
    .slice(0, 10);

  const settings = storageManager.getAllSettings();
  const model = settings.defaultModel || DEFAULT_MODEL.openai;

  const metaConfig: AgentConfig = {
    model,
    temperature: 0.4,
    maxTokens: 2000,
    systemPrompt: `You improve agent skill prompts. Given a skill's current prompt and recent execution outputs, rewrite the prompt to be clearer, more specific, and more effective. Return ONLY the improved prompt text — no explanations, no markdown fences.`,
    tools: [],
  };

  const improveInput = {
    skillName: skill.name,
    skillDescription: skill.description,
    currentPrompt: skill.prompt,
    usageStats: {
      timesUsed: skill.usageCount ?? 0,
      lastUsedAt: skill.lastUsedAt ?? null,
      agentsUsing: agents.length,
    },
    recentExecutions: executions.map((e) => ({
      agent: agents.find((a) => a.id === e.agentId)?.name,
      status: e.status,
      output: e.output ? JSON.stringify(e.output).slice(0, 800) : undefined,
      error: e.error,
    })),
    instruction: 'Improve this skill prompt based on the execution history.',
  };

  const execution = await agentManager.executeAgent('skills-improver', metaConfig, improveInput);
  const improved = String(execution.output?.content || '').trim();
  if (!improved) throw new Error('Improvement returned empty result');
  return { improvedPrompt: improved };
});

// API Keys (persisted encrypted via safeStorage/OS keychain)
handle('api:setKey', (_event, provider: 'openai' | 'anthropic', key: string) => {
  requireRole('admin');
  agentManager.setApiKey(provider, key);
  providerApiKeys[provider] = key;
  credentialStore.setApiKey(provider, key);
});

handle('api:clearKey', (_event, provider: 'openai' | 'anthropic') => {
  requireRole('admin');
  agentManager.clearApiKey(provider);
  delete providerApiKeys[provider];
  credentialStore.clearApiKey(provider);
});

handle('api:hasKey', (_event, provider: 'openai' | 'anthropic') => {
  return credentialStore.hasApiKey(provider) || !!providerApiKeys[provider];
});

// Model catalog (bundled fallback + live provider lists)
function providerCredentials(provider: ModelProvider): ProviderCredentials | undefined {
  const apiKey = providerApiKeys[provider];
  const oauthToken = agentManager.getOAuthToken(provider);
  if (!apiKey && !oauthToken) return undefined;
  return {
    apiKey,
    oauthToken: provider === 'openai' ? undefined : oauthToken || undefined,
    oauthBetaHeader: provider === 'anthropic' ? agentManager.getOAuthBetaHeader(provider) || undefined : undefined,
  };
}

handle('models:list', async () => {
  // Lazily refresh stale caches when credentials are available.
  if (!isCacheFresh(storageManager)) {
    const openai = providerCredentials('openai');
    const anthropic = providerCredentials('anthropic');
    if (openai || anthropic) {
      await refreshModelCatalog(storageManager, { openai, anthropic }).catch(() => {});
    }
  }
  return getCachedCatalog(storageManager);
});

handle('models:refresh', async () => {
  return refreshModelCatalog(storageManager, {
    openai: providerCredentials('openai'),
    anthropic: providerCredentials('anthropic'),
  });
});

// OAuth Authentication
function logOAuth(message: string) {
  try {
    const file = path.join(app.getPath('userData'), 'oauth-debug.log');
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch { /* logging must never break auth */ }
}

handle('oauth:authenticate', async (_event, provider: 'openai' | 'anthropic') => {
  try {
    logOAuth(`authenticate start: ${provider}`);
    const tokens = await oauthManager.authenticate(provider);
    logOAuth(`authenticate success: ${provider}`);
    return { success: true, tokens };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logOAuth(`authenticate FAILED ${provider}: ${msg}`);
    return { success: false, error: msg };
  }
});

handle('oauth:isAuthenticated', (_event, provider: 'openai' | 'anthropic') => {
  return oauthManager.isAuthenticated(provider);
});

handle('oauth:isConfigured', (_event, provider: 'openai' | 'anthropic') => {
  return oauthManager.isConfigured(provider);
});

handle('oauth:getToken', (_event, provider: 'openai' | 'anthropic') => {
  return oauthManager.getToken(provider);
});

handle('oauth:logout', async (_event, provider: 'openai' | 'anthropic') => {
  requireRole('admin');
  await oauthManager.logout(provider);
  credentialStore.clearOAuth(provider);
});

// Teams
handle('teams:getList', () => {
  return storageManager.getAllTeams();
});

handle('teams:get', (_event, id: string) => {
  return storageManager.getTeam(id);
});

handle('teams:create', (_event, config: TeamConfig) => {
  requireRole('admin');
  const team = {
    id: uuidv4(),
    name: config.name,
    description: config.description || '',
    agentIds: config.agentIds || [],
    workflow: config.workflow || { id: uuidv4(), name: 'Default', steps: [], executionMode: 'sequential' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  storageManager.saveTeam(team);
  return team;
});

handle('teams:update', (_event, id: string, config: Partial<TeamConfig>) => {
  requireRole('admin');
  const team = storageManager.getTeam(id);
  if (!team) throw new Error('Team not found');
  
  const updated = {
    ...team,
    ...config,
    updatedAt: new Date().toISOString(),
  };
  storageManager.saveTeam(updated);
  return updated;
});

handle('teams:delete', (_event, id: string) => {
  requireRole('admin');
  storageManager.deleteTeam(id);
});

handle('teams:addAgent', (_event, teamId: string, agentId: string) => {
  requireRole('admin');
  const team = storageManager.getTeam(teamId);
  if (!team) throw new Error('Team not found');
  
  if (!team.agentIds.includes(agentId)) {
    team.agentIds.push(agentId);
    team.updatedAt = new Date().toISOString();
    storageManager.saveTeam(team);
  }
  return team;
});

handle('teams:removeAgent', (_event, teamId: string, agentId: string) => {
  requireRole('admin');
  const team = storageManager.getTeam(teamId);
  if (!team) throw new Error('Team not found');
  
  team.agentIds = team.agentIds.filter(id => id !== agentId);
  team.updatedAt = new Date().toISOString();
  storageManager.saveTeam(team);
  return team;
});

handle('teams:execute', async (_event, teamId: string, input: Record<string, unknown>) => {
  requireRole('admin');
  const team = storageManager.getTeam(teamId);
  if (!team) throw new Error('Team not found');

  const agents = storageManager.getAllAgents();
  const result = await teamExecutionEngine.executeTeam(team, agents, input, async (agentId, agentInput) => {
    return runAgentExecution(agentId, agentInput);
  });

  // Log team execution to audit
  storageManager.saveAuditLog({
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    agentId: 'team-execution',
    agentName: team.name,
    action: 'team_execute',
    input,
    output: result as unknown as Record<string, unknown>,
    metadata: { teamId, duration: result.duration },
  });

  return result;
});

// Governance
handle('governance:getState', () => {
  return {
    pendingApprovals: storageManager.getPendingApprovals(),
    rules: storageManager.getAllGovernanceRules(),
  };
});

handle('governance:getPendingApprovals', () => {
  return storageManager.getPendingApprovals();
});

handle('governance:approve', (_event, actionId: string) => {
  requireRole('admin');
  storageManager.updateApprovalStatus(actionId, 'approved', undefined, currentUserEmail());
  const approval = storageManager.getApproval(actionId);
  if (approval) {
    storageManager.saveAuditLog({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      agentId: approval.agentId || 'governance',
      agentName: approval.agentName || 'Governance',
      action: 'approval_approved',
      input: { approvalId: actionId },
      output: {},
      metadata: { tool: approval.action },
    });
  }
});

handle('governance:reject', (_event, actionId: string, reason: string) => {
  requireRole('admin');
  storageManager.updateApprovalStatus(actionId, 'rejected', reason, currentUserEmail());
  const approval = storageManager.getApproval(actionId);
  if (approval) {
    storageManager.saveAuditLog({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      agentId: approval.agentId || 'governance',
      agentName: approval.agentName || 'Governance',
      action: 'approval_rejected',
      input: { approvalId: actionId, reason },
      output: {},
      metadata: { tool: approval.action },
    });
  }
});

handle('governance:setRule', (_event, rule: GovernanceRule) => {
  requireRole('admin');
  storageManager.saveGovernanceRule(rule);
});

handle('governance:getRules', () => {
  return storageManager.getAllGovernanceRules();
});

handle('governance:deleteRule', (_event, ruleId: string) => {
  requireRole('admin');
  storageManager.deleteGovernanceRule(ruleId);
});

// Audit Logs
handle('audit:getLogs', (_event, limit = 100, offset = 0) => {
  if (currentRole() === 'member') return storageManager.getAuditLogs(limit, offset, currentUserId());
  return storageManager.getAuditLogs(limit, offset);
});

// Second Brain (KeepMind Corp) integration
handle('secondbrain:getConfig', () => {
  const { token, ...rest } = secondBrainManager.getConfig();
  return { ...rest, hasToken: token.length > 0 };
});

handle('secondbrain:setConfig', (_event, config: { enabled?: boolean; url?: string; token?: string; access?: 'read' | 'write'; blockPii?: boolean }) => {
  requireRole('admin');
  secondBrainManager.setConfig(config);
  void refreshCorpLlmKeys();
  const { token, ...rest } = secondBrainManager.getConfig();
  return { ...rest, hasToken: token.length > 0 };
});

handle('secondbrain:test', async () => {
  return secondBrainManager.testConnection();
});

// Personal vs corporate mode — chosen at onboarding, editable in Settings.
handle('app:getMode', () => {
  const mode = storageManager.getSetting('app.mode');
  return mode === 'personal' || mode === 'corporate' ? mode : 'unset';
});

handle('app:setMode', (_event, mode: string) => {
  requireRole('admin');
  if (mode !== 'personal' && mode !== 'corporate') {
    return { ok: false, error: 'Invalid mode' };
  }
  storageManager.setSetting('app.mode', mode);
  storageManager.saveAuditLog({
    id: uuidv4(), timestamp: new Date().toISOString(),
    agentId: 'system', agentName: 'System', action: 'app_mode_changed',
    input: { mode }, output: {}, metadata: {},
    userId: currentUserId(),
  });
  return { ok: true, mode };
});

// Guided second-brain install: downloads the right installer for this
// platform from GitHub Releases and opens it.
handle('brain:installProduct', async (_event, product: 'personal' | 'corporate') => {
  if (product !== 'personal' && product !== 'corporate') {
    return { ok: false, error: 'Invalid product' };
  }
  const platform = process.platform as 'darwin' | 'win32' | 'linux';
  if (!['darwin', 'win32', 'linux'].includes(platform)) {
    return { ok: false, error: `Unsupported platform: ${platform}` };
  }
  const { shell } = await import('electron');
  const result = await downloadAndOpenInstaller(
    product,
    platform,
    app.getPath('downloads'),
    (received, total) => {
      mainWindow?.webContents.send('brain:installProgress', { received, total });
    },
  );
  if (result.ok && result.path) {
    const open = await shell.openPath(result.path);
    if (open) return { ok: false, error: open, path: result.path };
    storageManager.saveAuditLog({
      id: uuidv4(), timestamp: new Date().toISOString(),
      agentId: 'system', agentName: 'System', action: 'brain_installer_downloaded',
      input: { product, platform }, output: { path: result.path }, metadata: {},
      userId: currentUserId(),
    });
  }
  return result;
});

// WhatsApp (Baileys)
handle('whatsapp:getStatus', () => {
  return whatsAppManager.getStatus();
});

handle('whatsapp:start', async () => {
  requireRole('admin');
  await whatsAppManager.start();
  return whatsAppManager.getStatus();
});

handle('whatsapp:stop', async () => {
  requireRole('admin');
  await whatsAppManager.stop();
  return whatsAppManager.getStatus();
});

handle('whatsapp:sendMessage', async (_event, to: string, text: string) => {
  requireRole('admin');
  await whatsAppManager.sendMessage(to, text);
  try {
    storageManager.saveWhatsAppMessage({ direction: 'out', remote: to, text, timestamp: Date.now() });
  } catch (error) {
    console.error('[whatsapp] failed to persist outgoing message:', error);
  }
  return { ok: true };
});

handle('whatsapp:getMessages', (_event, limit?: number, remote?: string) => {
  return storageManager.getWhatsAppMessages(limit ?? 50, remote || undefined);
});

handle('whatsapp:clearMessages', () => {
  storageManager.clearWhatsAppMessages();
  return { ok: true };
});

// Composio integrations — the company API key is admin-managed; each user
// connects their own SaaS accounts through Composio's hosted auth.
handle('composio:getStatus', () => {
  return { configured: composioManager.isConfigured(), keyHint: composioManager.keyHint() };
});

handle('composio:setApiKey', (_event, key: string) => {
  requireRole('admin');
  if (!key?.trim()) throw new Error('API key is required');
  composioManager.setApiKey(key);
  return { configured: true, keyHint: composioManager.keyHint() };
});

handle('composio:clearApiKey', () => {
  requireRole('admin');
  composioManager.clearApiKey();
  return { configured: false, keyHint: null };
});

handle('composio:test', async () => {
  return composioManager.testConnection();
});

handle('composio:listToolkits', async () => {
  requireRole('admin');
  return composioManager.listToolkits();
});

handle('composio:listConnections', async () => {
  return composioManager.refreshConnections();
});

handle('composio:connect', async (_event, toolkit: string) => {
  requireRole('admin');
  return composioManager.connect(String(toolkit));
});

handle('composio:disconnect', async (_event, connectedAccountId: string) => {
  requireRole('admin');
  await composioManager.disconnect(String(connectedAccountId));
  return { ok: true };
});

// Agent Reach diagnostics — reports which upstream backends are usable so
// agents (and the UI) know which platforms can be read right now.
handle('agentreach:status', () => getAgentReachStatus());

// Automation triggers + WhatsApp auto-responder
handle('triggers:list', () => {
  return triggerManager.list();
});

handle('triggers:create', (_event, input: Omit<AgentTrigger, 'id' | 'createdAt' | 'lastRunAt'>) => {
  requireRole('admin');
  const withToken = input.kind === 'webhook' && !input.webhookToken
    ? { ...input, webhookToken: randomBytes(16).toString('hex') }
    : input;
  return triggerManager.create(withToken);
});

handle('triggers:update', (_event, id: string, updates: Partial<Omit<AgentTrigger, 'id' | 'createdAt'>>) => {
  requireRole('admin');
  return triggerManager.update(id, updates);
});

handle('triggers:delete', (_event, id: string) => {
  requireRole('admin');
  return { ok: triggerManager.delete(id) };
});

handle('triggers:setWhatsAppAgent', (_event, agentId: string) => {
  requireRole('admin');
  triggerManager.setWhatsAppAgentId(agentId);
  return { ok: true };
});

handle('triggers:getWhatsAppAgent', () => {
  return { agentId: triggerManager.getWhatsAppAgentId() };
});

// Local webhook receiver — POST /webhook/<token> fires the matching trigger.
// Bound to 127.0.0.1 only; the unguessable token is the auth. Port is fixed
// via setting 'webhook.port' (default 47821) so firewalls/routers can whitelist.
function startWebhookServer(): void {
  if (webhookServer) return;
  const port = Number(storageManager.getSetting('webhook.port')) || 47821;
  webhookServer = createServer((req, res) => {
    const send = (code: number, body: string) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: code < 300, message: body }));
    };
    if (req.method !== 'POST' || !req.url?.startsWith('/webhook/')) {
      send(404, 'not found');
      return;
    }
    const token = decodeURIComponent(req.url.slice('/webhook/'.length).split('?')[0]);
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 256 * 1024) req.destroy(); });
    req.on('end', async () => {
      let payload: unknown = null;
      try { payload = body ? JSON.parse(body) : null; } catch { payload = body.slice(0, 4000); }
      const ok = await triggerManager.dispatchWebhook(token, payload);
      send(ok ? 202 : 404, ok ? 'triggered' : 'unknown or disabled webhook token');
    });
  });
  webhookServer.on('error', (e) => console.error('[webhook] server error:', e));
  webhookServer.listen(port, '127.0.0.1', () => {
    console.log(`[webhook] listening on http://127.0.0.1:${port}/webhook/<token>`);
  });
}

// Cost/memory/routing inspection for the UI.
handle('usage:getMonthlySpend', () => {
  const agents = new Map(storageManager.getAllAgents().map((a) => [a.id, a.name]));
  return storageManager.getMonthlySpendByAgent().map((r) => ({
    ...r,
    agentName: agents.get(r.agentId) ?? r.agentId,
    monthlyBudgetUsd: storageManager.getAgent(r.agentId)?.config.monthlyBudgetUsd,
  }));
});
handle('usage:list', (_event, limit?: number) => storageManager.getLlmUsage(limit ?? 100));
handle('routing:list', (_event, limit?: number) => storageManager.getRoutingDecisions(limit ?? 50));
handle('memory:list', (_event, limit?: number) => memoryManager.list(limit ?? 100));
handle('memory:retire', (_event, id: string) => ({ ok: memoryManager.retire(id) }));

// Data export/import — full SQLite backup as a single file.
handle('data:export', async () => {
  requireRole('admin');
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export KeepMind OS data',
    defaultPath: `keepmind-os-backup-${new Date().toISOString().slice(0, 10)}.kmdb`,
    filters: [{ name: 'KeepMind OS backup', extensions: ['kmdb', 'db', 'sqlite'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const data = storageManager.backup();
  await fs.writeFile(result.filePath, data);
  return { ok: true, path: result.filePath };
});

handle('data:import', async () => {
  requireRole('admin');
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Import KeepMind OS data',
    properties: ['openFile'],
    filters: [{ name: 'KeepMind OS backup', extensions: ['kmdb', 'db', 'sqlite'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  const data = await fs.readFile(result.filePaths[0]);
  // Validate it looks like a SQLite database before replacing.
  if (data.length < 100 || data.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') {
    return { ok: false, error: 'Not a valid KeepMind OS backup file' };
  }
  storageManager.restore(data);
  return { ok: true };
});

// Company profile
handle('company:get', () => {
  const s = storageManager.getAllSettings();
  return {
    name: s['company.name'] || '',
    description: s['company.description'] || '',
    industry: s['company.industry'] || '',
    website: s['company.website'] || '',
  };
});

handle('company:update', (_event, profile: Record<string, string>) => {
  for (const [key, value] of Object.entries(profile)) {
    storageManager.setSetting(`company.${key}`, String(value));
  }
  return storageManager.getAllSettings();
});

// Settings
handle('settings:get', () => {
  const settings = storageManager.getAllSettings();
  return {
    theme: settings.theme || 'auto',
    language: settings.language || 'en',
    autoApprove: settings.autoApprove === 'true',
    defaultModel: settings.defaultModel || DEFAULT_MODEL.openai,
    maxConcurrentExecutions: parseInt(settings.maxConcurrentExecutions || '5'),
    auditRetentionDays: parseInt(settings.auditRetentionDays || '30'),
    onboardingCompleted: settings['onboarding.completed'] === 'true',
    skillsAutoRoute: settings['skills.autoRoute'] !== 'false',
    llmAutoRoute: settings['llm.autoRoute'] !== 'false',
    toolApprovalRequired: settings['gov.toolApproval'] !== 'false',
    soundEffects: settings.soundEffects === 'true',
    memorySemanticSearch: settings['memory.semantic'] === 'true',
    memoryEmbeddingModel: settings['memory.embeddingModel'] || 'nomic-embed-text',
    soundEvents: settings.soundEvents || 'attention,done,error,start',
  };
});

handle('settings:update', (_event, settings: Partial<AppSettings>) => {
  requireRole('admin');
  const KEY_MAP: Record<string, string> = {
    onboardingCompleted: 'onboarding.completed',
    memorySemanticSearch: 'memory.semantic',
    memoryEmbeddingModel: 'memory.embeddingModel',
    skillsAutoRoute: 'skills.autoRoute',
    llmAutoRoute: 'llm.autoRoute',
    toolApprovalRequired: 'gov.toolApproval',
  };
  Object.entries(settings).forEach(([key, value]) => {
    storageManager.setSetting(KEY_MAP[key] ?? key, String(value));
  });
  return storageManager.getAllSettings();
});

function logUpdater(message: string) {
  try {
    const file = path.join(app.getPath('userData'), 'updater-debug.log');
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch { /* logging must never break updates */ }
}
autoUpdater.logger = {
  info: (m) => logUpdater(`[info] ${m}`),
  warn: (m) => logUpdater(`[warn] ${m}`),
  error: (m) => logUpdater(`[error] ${m}`),
  debug: (m) => logUpdater(`[debug] ${m}`),
};
// On macOS, quitAndInstall is replaced by our own bundle swap
// (installDownloadedMacUpdate) because Squirrel.Mac rejects unsigned builds.
// autoInstallOnAppQuit would make downloadUpdate() hand the zip to native
// Squirrel anyway — a guaranteed signature failure — so keep it off.
autoUpdater.autoInstallOnAppQuit = false;

// Auto-update (electron-updater). Requires a configured publish feed
// (e.g. GitHub releases) in the packaged app; reports errors honestly.
handle('update:check', async () => {
  try {
    autoUpdater.autoDownload = false;
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A 404 from the feed (e.g. repo without published releases, or a corp
    // that hasn't uploaded installers yet) means "no update", not a failure.
    if (message.includes('404')) return { ok: true, updateInfo: null };
    return { ok: false, error: message };
  }
});

handle('update:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

handle('update:install', async () => {
  // Squirrel.Mac cannot update unsigned/ad-hoc apps (designated requirement is
  // the per-build cdhash), so on macOS we swap the bundle ourselves. Other
  // platforms keep the standard electron-updater path.
  if (process.platform === 'darwin' && app.isPackaged) {
    const result = await installDownloadedMacUpdate();
    if (!result.ok) return result;
    return { ok: true };
  }
  autoUpdater.quitAndInstall();
  return { ok: true };
});

autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('update:event', { type: 'available', version: info.version });
});
autoUpdater.on('update-not-available', () => {
  mainWindow?.webContents.send('update:event', { type: 'not-available' });
});
autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('update:event', { type: 'progress', percent: Math.round(progress.percent) });
});
autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('update:event', { type: 'downloaded', version: info.version });
});

// ── Computer access control (install-level ceiling for agent tools) ──
handle('computer:getSettings', () => computerSettings());

handle('computer:updateSettings', (_event, s: {
  level?: ComputerAccessLevel;
  allowedRoots?: string[];
  shellAllow?: string[];
  shellDeny?: string[];
}) => {
  requireRole('admin');
  if (s.level) storageManager.setSetting('computer.access', s.level);
  for (const [key, val] of [['computer.allowedRoots', s.allowedRoots], ['computer.shellAllow', s.shellAllow], ['computer.shellDeny', s.shellDeny]] as const) {
    if (val !== undefined) storageManager.setSetting(key, JSON.stringify(val.filter((v) => typeof v === 'string' && v.trim())));
  }
  storageManager.saveAuditLog({
    id: uuidv4(), timestamp: new Date().toISOString(),
    agentId: 'system', agentName: 'Settings', action: 'computer_access_updated',
    input: s as unknown as Record<string, unknown>, output: {}, metadata: {},
    userId: currentUserId(),
  });
  return computerSettings();
});

// ── Personal brain (local vault — never leaves the machine) ──
handle('personalbrain:status', async () => {
  return { dir: personalBrainManager.getDir(), files: await personalBrainManager.list() };
});

handle('personalbrain:openFolder', async () => {
  await personalBrainManager.ensureDir();
  await shellExec(`open ${JSON.stringify(personalBrainManager.getDir())}`);
  return { ok: true };
});

// ── Brain access requests (corporate GitHub repo + personal repo) ──
const CORP_BRAIN_REPO = 'criptogus/keepmind-corp';

handle('brain:requestCorporateAccess', (_event, input: { scope?: 'read' | 'write'; reason?: string } = {}) => {
  const user = localAuth.getCurrentUser();
  if (!user) throw new Error('Login required');
  const mine = storageManager.getBrainAccessRequests(user.id);
  const pending = mine.find((r) => r.kind === 'corporate_github' && r.status === 'pending');
  if (pending) return pending;
  const req = {
    id: uuidv4(), userId: user.id, userEmail: user.email,
    kind: 'corporate_github', scope: input.scope === 'write' ? 'write' : 'read',
    reason: input.reason?.slice(0, 500), status: 'pending',
    createdAt: new Date().toISOString(),
  };
  storageManager.saveBrainAccessRequest(req);
  storageManager.saveAuditLog({
    id: uuidv4(), timestamp: new Date().toISOString(),
    agentId: 'system', agentName: 'Brain Access', action: 'corporate_access_requested',
    input: { scope: req.scope, reason: req.reason }, output: {}, metadata: {}, userId: user.id,
  });
  return req;
});

handle('brain:listRequests', () => {
  // Members see only their own requests; admins/owners see all.
  if (currentRole() === 'member') return storageManager.getBrainAccessRequests(currentUserId());
  return storageManager.getBrainAccessRequests();
});

handle('brain:decideRequest', (_event, id: string, decision: 'approved' | 'rejected') => {
  requireRole('admin');
  const req = storageManager.getBrainAccessRequest(id);
  if (!req) throw new Error('Request not found');
  if (req.status !== 'pending') throw new Error(`Request already ${req.status}`);
  const status = decision === 'approved' ? 'approved' : 'rejected';
  storageManager.saveBrainAccessRequest({
    ...(req as Record<string, unknown>),
    status,
    decidedBy: currentUserEmail(),
    decidedAt: new Date().toISOString(),
  } as never);
  storageManager.saveAuditLog({
    id: uuidv4(), timestamp: new Date().toISOString(),
    agentId: 'system', agentName: 'Brain Access', action: `corporate_access_${status}`,
    input: { requestId: id, userEmail: req.userEmail }, output: {}, metadata: {}, userId: currentUserId(),
  });
  return { ok: true, status };
});

/**
 * Creates the user's PERSONAL second-brain GitHub repo — private by default —
 * using their own `gh` credentials, cloned into a private folder inside the
 * app's data dir. Explicitly user-triggered; never touches the corporate repo.
 */
handle('brain:createPersonalRepo', async (_event, repoName?: string) => {
  const user = localAuth.getCurrentUser();
  if (!user) throw new Error('Login required');

  const ghReady = await shellExec('gh auth status').then(() => true).catch(() => false);
  if (!ghReady) throw new Error('GitHub CLI (gh) is not authenticated. Run `gh auth login` first.');

  const owner = (await shellExec('gh api user --jq .login')).trim().split('\n').pop()!;
  const base = (repoName || `${user.email.split('@')[0]}-keepmind-brain`)
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (!base) throw new Error('Invalid repository name');
  const fullName = `${owner}/${base}`;
  const cloneDir = path.join(app.getPath('userData'), 'personal-brain-repo');

  // Create the private repo if it does not exist yet.
  const exists = await shellExec(`gh repo view ${fullName} --json name`).then(() => true).catch(() => false);
  if (!exists) {
    await shellExec(`gh repo create ${fullName} --private`);
  }
  await fs.mkdir(path.dirname(cloneDir), { recursive: true });
  const alreadyCloned = await fs.stat(path.join(cloneDir, '.git')).then(() => true).catch(() => false);
  if (!alreadyCloned) {
    await fs.rm(cloneDir, { recursive: true, force: true });
    await shellExec(`gh repo clone ${fullName} ${JSON.stringify(cloneDir)}`);
  }

  const repoUrl = `https://github.com/${fullName}`;
  // Mark the user's personal-repo request fulfilled, if one exists.
  const reqs = storageManager.getBrainAccessRequests(user.id)
    .filter((r) => r.kind === 'personal_github' && r.status === 'pending');
  for (const r of reqs) {
    storageManager.saveBrainAccessRequest({
      ...(r as Record<string, unknown>), status: 'fulfilled', repoUrl,
      decidedBy: 'system', decidedAt: new Date().toISOString(),
    } as never);
  }
  storageManager.saveAuditLog({
    id: uuidv4(), timestamp: new Date().toISOString(),
    agentId: 'system', agentName: 'Brain Access', action: 'personal_repo_created',
    input: { repo: fullName, dir: cloneDir }, output: { repoUrl }, metadata: {}, userId: user.id,
  });
  return { ok: true, repo: fullName, url: repoUrl, dir: cloneDir };
});


// Outcome-oriented workspace. Every call uses the existing authenticated IPC boundary.
function requireWorkAccess(id: string) {
  const task = workManager.get(id);
  if (currentRole() === 'member' && task.ownerId !== currentUserId()) throw new Error('Task access denied');
  return task;
}
handle('work:list', () => workManager.snapshot(currentRole() === 'member' ? currentUserId() : undefined));
handle('work:create', (_event, input: CreateWorkInput) => {
  const agent = storageManager.getAgent(input.agentId);
  if (!agent || (currentRole() === 'member' && !agent.isShared)) throw new Error('Agent unavailable');
  return workManager.create(input, currentUserId() ?? 'system');
});
handle('work:action', async (_event, id: string, action: WorkAction, note?: string) => {
  const existing = requireWorkAccess(id);
  if (action === 'run' || action === 'resume') {
    if (action === 'resume' && (existing.status !== 'blocked' || !existing.executionId || !checkpoints.read(existing.executionId))) throw new Error('No resumable checkpoint');
    if (action === 'run' && existing.executionId && checkpoints.read(existing.executionId)) throw new Error('Resume the checkpoint or request a revision to start new work');
    workManager.assertReady(id);
    // Claim is synchronous, so a second click cannot launch the same task again.
    void workManager.run(id, (agentId, input) => runAgentExecution(agentId, input, { resumeId: action === 'resume' ? existing.executionId : undefined }))
      .catch(error => console.error('[work]', error));
    return workManager.get(id);
  }
  if (!['accept','revise','cancel','comment','propose-rule'].includes(action)) throw new Error('Invalid action');
  const task = workManager.change(id, action, note);
  if (action === 'cancel') {
    for (const approval of storageManager.getPendingApprovals()) {
      if (approval.context.workTaskId === id) storageManager.updateApprovalStatus(approval.id, 'rejected', 'Task cancelled', currentUserId() ?? 'system');
    }
    for (const run of agentManager.getActiveExecutions()) {
      if (run.input.workTaskId === id) {
        agentManager.cancelExecution(run.id);
        storageManager.updateAgentExecutionProgress(run.id, run.progress, 'cancelled');
      }
    }
  }
  return task;
});
handle('work:reviewRule', (_event, id: string, accept: boolean) => {
  const rule = workManager.snapshot().rules.find(r => r.id === id);
  if (!rule) throw new Error('Rule not found');
  requireWorkAccess(rule.sourceTaskId);
  workManager.reviewRule(id, accept);
});
handle('work:export', () => JSON.stringify({ format: 'keepmind-work', version: 1,
  ...workManager.snapshot(currentRole() === 'member' ? currentUserId() : undefined) }, null, 2));

handle('work:checkpoint', (_event, id: string) => {
  const task = requireWorkAccess(id);
  return { available: !!task.executionId && !!checkpoints.read(task.executionId),
    steps: task.executionId ? checkpoints.steps(task.executionId) : [] };
});
handle('work:reconcile', (_event, id: string, key: string, result: string) => {
  requireRole('admin');
  const task = requireWorkAccess(id);
  if (task.status !== 'blocked' || !task.executionId) throw new Error('Only interrupted work can be reconciled');
  checkpoints.reconcile(task.executionId, key, result, currentUserId() ?? 'local-admin');
  workManager.change(id, 'comment', `Verified external result for ${key}: ${result}`);
});
