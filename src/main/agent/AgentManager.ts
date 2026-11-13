import { CONVERSATION_PROMPT } from '../../shared/conversation.js';
import { RequiredCompanyBrainError } from '../keepmind/CompanyBrains.js';
import { isCompatibleModel } from '../../shared/connectors.js';
import type { CompatibleProviders } from '../connectors/CompatibleProviders.js';
import { CheckpointStore, CheckpointError } from '../execution/CheckpointStore.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { AgentConfig, AgentExecution, Skill } from '../../shared/types.js';
import { CODEX_DEFAULT_MODEL, providerForModel, estimateCallCost, costFromUsage } from '../../shared/models.js';
import { ToolRegistry, type ExecutionPolicy } from '../tools/registry.js';
import { v4 as uuidv4 } from 'uuid';

export interface AgentStreamEvent {
  type: 'chunk' | 'tool_call' | 'tool_result' | 'error';
  data?: unknown;
}

const MAX_TOOL_ITERATIONS = 6;

export interface ExecutionConstraints {
  policy?: ExecutionPolicy;
  /** Tool names hidden from the model for this execution (e.g. member role). */
  denyTools?: string[];
}

/** Normalized token usage reported by a provider call. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/** Usage record emitted after each provider call for the cost ledger. */
export interface UsageRecord {
  agentId: string;
  executionId?: string;
  model: string;
  provider: string;
  usage: TokenUsage;
  costUsd?: number;
  partial?: boolean;
}

/** Budget gate: throws when the agent's monthly spend + estimate exceeds its cap. */
export type BudgetChecker = (agentId: string, model: string, estimatedCostUsd: number) => void;

/** Called when an execution settles so memory items it used can be scored. */
export type MemoryOutcomeRecorder = (executionId: string, memoryIds: string[], succeeded: boolean) => void;

interface CodexCompletedEvent {
  response?: {
    output?: Array<Record<string, unknown>>;
    usage?: unknown;
    status?: string;
    model?: string;
  };
}

export class AgentManager {
  private compatibleProviders?: CompatibleProviders;
  setCompatibleProviders(providers: CompatibleProviders) { this.compatibleProviders = providers; }
  private openaiClients: Map<string, OpenAI> = new Map();
  private anthropicClients: Map<string, Anthropic> = new Map();
  private oauthTokens: Map<string, string> = new Map();
  private oauthBetaHeaders: Map<string, string> = new Map();
  private oauthAccountIds: Map<string, string> = new Map();
  private activeExecutions: Map<string, AgentExecution> = new Map();
  private contextProvider?: (query: string, agentId?: string) => Promise<string>;
  private skillLoader?: (skillIds: string[]) => Skill[];
  private autoSkillSelector?: (input: Record<string, unknown>, assigned: Skill[], agentId?: string) => Skill[];
  private modelRouter?: (model: string, input: Record<string, unknown>, agentId?: string) => string;
  private usageRecorder?: (rec: UsageRecord) => void;
  private budgetChecker?: BudgetChecker;
  private executionSpend?: (executionId: string) => number;
  setExecutionSpendProvider(provider: (executionId: string) => number) { this.executionSpend = provider; }
  private memoryOutcomeRecorder?: MemoryOutcomeRecorder;
  private toolCallRecorder?: (executionId: string, kind: 'call' | 'result', name: string, payload: { args?: unknown; result?: unknown; error?: unknown }) => void;
  private runContext = new AsyncLocalStorage<{ agentId: string; executionId: string; signal: AbortSignal; spentUsd: number; compatible?: ReturnType<CompatibleProviders['resolve']> }>();
  private controllers = new Map<string, AbortController>();
  private reservations = new Map<string, { agentId: string; estimate: number }>();

  private settleUnreported(executionId: string): void {
    const pending = this.reservations.get(executionId);
    if (!pending) return;
    this.usageRecorder?.({ agentId: pending.agentId, executionId, model: 'unreported', provider: 'unreported',
      usage: { promptTokens: 0, completionTokens: 0 }, costUsd: pending.estimate, partial: true });
    const context = this.runContext.getStore();
    if (context?.executionId === executionId) context.spentUsd += pending.estimate;
    this.reservations.delete(executionId);
  }

  private beforeCall(config: AgentConfig, promptChars: number, policy?: ExecutionPolicy): void {
    policy?.signal?.throwIfAborted();
    if (!policy?.executionId || !policy.callerAgentId) return;
    this.settleUnreported(policy.executionId);
    const context = this.runContext.getStore();
    const profile = context?.compatible?.profile;
    if (isCompatibleModel(config.model) && !profile) throw new Error('Compatible provider not configured');
    const estimate = profile
      ? (Math.ceil(promptChars / 3) * profile.inputUsdPerMillion + Math.min(config.maxTokens, profile.maxOutputTokens) * profile.outputUsdPerMillion) / 1_000_000
      : estimateCallCost(config.model, promptChars, config.maxTokens);
    if (profile && (context!.spentUsd + estimate > profile.maxRunUsd)) throw new Error('Provider per-run budget exceeded');
    const reserved = [...this.reservations.entries()].filter(([id, r]) => id !== policy.executionId && r.agentId === policy.callerAgentId).reduce((sum, [, r]) => sum + r.estimate, 0);
    this.budgetChecker?.(policy.callerAgentId, config.model, estimate + reserved);
    this.reservations.set(policy.executionId, { agentId: policy.callerAgentId, estimate });
  }

  private recordCall(config: AgentConfig, usage: TokenUsage, policy?: ExecutionPolicy): void {
    if (!policy?.executionId || !policy.callerAgentId) return;
    // Persist before releasing the reservation so concurrent runs see the spend.
    this.usageRecorder?.({ agentId: policy.callerAgentId, executionId: policy.executionId,
      model: config.model, provider: this.runContext.getStore()?.compatible?.profile.kind || providerForModel(config.model) || 'unknown', usage, costUsd: this.compatibleCost(usage) });
    this.reservations.delete(policy.executionId);
  }

  private compatibleCost(usage: TokenUsage): number | undefined {
    const context = this.runContext.getStore();
    const profile = context?.compatible?.profile;
    if (!profile) return undefined;
    const cost = (usage.promptTokens * profile.inputUsdPerMillion + usage.completionTokens * profile.outputUsdPerMillion) / 1_000_000;
    context!.spentUsd += cost;
    return cost;
  }

  private checkpoints?: CheckpointStore;
  setCheckpointStore(store: CheckpointStore) { this.checkpoints = store; }
  private providerResponse<T>(policy: ExecutionPolicy | undefined, key: string, call: () => Promise<T>): Promise<T> {
    return policy?.checkpoint && policy.executionId ? policy.checkpoint.response(policy.executionId, key, call) : call();
  }

  private toolRegistry = new ToolRegistry();

  constructor() {
    // Initialize default clients
    this.initializeClients();
  }

  private initializeClients() {
    // Initialize OpenAI client if API key is available
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      this.openaiClients.set('default', new OpenAI({ apiKey: openaiKey }));
    }

    // Initialize Anthropic client if API key is available
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      this.anthropicClients.set('default', new Anthropic({ apiKey: anthropicKey }));
    }
  }

  setApiKey(provider: 'openai' | 'anthropic', key: string) {
    if (provider === 'openai') {
      this.openaiClients.set('default', new OpenAI({ apiKey: key }));
    } else {
      this.anthropicClients.set('default', new Anthropic({ apiKey: key }));
    }
  }

  clearApiKey(provider: 'openai' | 'anthropic'): void {
    if (provider === 'openai') {
      this.openaiClients.delete('default');
    } else {
      this.anthropicClients.delete('default');
    }
  }

  setOAuthToken(provider: 'openai' | 'anthropic', token: string) {
    this.oauthTokens.set(provider, token);
    // OAuth tokens are Bearer credentials. Anthropic accepts authToken in the SDK;
    // OpenAI ChatGPT-subscription tokens target chatgpt.com/backend-api/codex
    // (Responses API), not api.openai.com — handled in executeOpenAI.
    if (provider === 'anthropic') {
      this.anthropicClients.set('default', new Anthropic({ authToken: token }));
    }
  }

  hasOAuthToken(provider: 'openai' | 'anthropic'): boolean {
    return this.oauthTokens.has(provider);
  }

  getOAuthToken(provider: 'openai' | 'anthropic'): string | null {
    return this.oauthTokens.get(provider) || null;
  }

  clearOAuthToken(provider: 'openai' | 'anthropic'): void {
    this.oauthTokens.delete(provider);
    this.oauthBetaHeaders.delete(provider);
    this.oauthAccountIds.delete(provider);
    // Anthropic OAuth uses an authToken client — drop it. OpenAI OAuth doesn't
    // create a client (Codex backend path), so an existing client is a real
    // API-key client and must be preserved.
    if (provider === 'anthropic') {
      this.anthropicClients.delete('default');
    }
  }

  setOAuthBetaHeader(provider: 'openai' | 'anthropic', header: string): void {
    this.oauthBetaHeaders.set(provider, header);
  }

  getOAuthBetaHeader(provider: 'openai' | 'anthropic'): string | null {
    return this.oauthBetaHeaders.get(provider) || null;
  }

  setOAuthAccountId(provider: 'openai' | 'anthropic', accountId: string): void {
    this.oauthAccountIds.set(provider, accountId);
  }

  getOAuthAccountId(provider: 'openai' | 'anthropic'): string | null {
    return this.oauthAccountIds.get(provider) || null;
  }

  /** Optional hook (e.g. SecondBrainManager) that returns extra context for a query. */
  setContextProvider(provider?: (query: string, agentId?: string) => Promise<string>) {
    this.contextProvider = provider;
  }

  /** Loads Skill rows for the skillIds referenced by an agent config. */
  setSkillLoader(loader?: (skillIds: string[]) => Skill[]) {
    this.skillLoader = loader;
  }

  /**
   * Optional auto-router: given the task input and the agent's assigned skills,
   * returns additional skills to activate automatically (deduped by caller).
   */
  setAutoSkillSelector(selector?: (input: Record<string, unknown>, assigned: Skill[], agentId?: string) => Skill[]) {
    this.autoSkillSelector = selector;
  }

  /**
   * Optional model router: given the configured model and task input, returns
   * the model actually used for this execution (same provider family).
   */
  setModelRouter(router?: (model: string, input: Record<string, unknown>, agentId?: string) => string) {
    this.modelRouter = router;
  }

  /** Receives normalized token usage after every provider call (cost ledger). */
  setUsageRecorder(recorder?: (rec: UsageRecord) => void) {
    this.usageRecorder = recorder;
  }

  /** Enforces per-agent monthly LLM budgets before a call is made. */
  setBudgetChecker(checker?: BudgetChecker) {
    this.budgetChecker = checker;
  }

  /** Scores memory items an execution used once it completes or fails. */
  setMemoryOutcomeRecorder(recorder?: MemoryOutcomeRecorder) {
    this.memoryOutcomeRecorder = recorder;
  }

  /** Persists tool_call/tool_result events for the execution audit trail. */
  setToolCallRecorder(recorder?: (executionId: string, kind: 'call' | 'result', name: string, payload: { args?: unknown; result?: unknown; error?: unknown }) => void) {
    this.toolCallRecorder = recorder;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  previewTools(agentId: string, config: AgentConfig, input: Record<string, unknown>) {
    const skills = this.resolveSkills(config, input, agentId);

    const constraints = this.constraintsProvider?.(config);
    const denied = constraints?.denyTools?.length ? new Set(constraints.denyTools) : undefined;
    return this.enabledToolNames(config, skills, denied);
  }

  private loadSkills(config: AgentConfig): Skill[] {
    if (!this.skillLoader || !config.skillIds?.length) return [];
    try {
      return this.skillLoader(config.skillIds);
    } catch {
      return [];
    }
  }

  /** Assigned skills + auto-routed skills, deduped by id. */
  private resolveSkills(config: AgentConfig, input: Record<string, unknown>, agentId?: string): Skill[] {
    const assigned = this.loadSkills(config);
    if (!this.autoSkillSelector) return assigned;
    try {
      const assignedIds = new Set(assigned.map((s) => s.id));
      const extra = this.autoSkillSelector(input, assigned, agentId).filter((s) => !assignedIds.has(s.id));
      return [...assigned, ...extra];
    } catch {
      return assigned;
    }
  }

  /** Per-execution constraints: computer access policy + tools hidden from the model. */
  private constraintsProvider?: (config: AgentConfig) => ExecutionConstraints | undefined;

  setConstraintsProvider(provider?: (config: AgentConfig) => ExecutionConstraints | undefined) {
    this.constraintsProvider = provider;
  }

  /** Tool names enabled for this execution: agent-declared + skill-declared, filtered to registry. */
  private enabledToolNames(config: AgentConfig, skills: Skill[], denied?: Set<string>): string[] {
    const names = new Set<string>();
    for (const s of skills) for (const n of s.toolNames) names.add(n);
    for (const t of config.tools || []) if (t?.name) names.add(t.name);
    return [...names].filter((n) => this.toolRegistry.get(n) !== undefined && !denied?.has(n));
  }

  private async buildSystemPrompt(config: AgentConfig, input: Record<string, unknown>, skills: Skill[]): Promise<string> {
    let prompt = config.systemPrompt;

    if (skills.length > 0) {
      const skillBlock = skills
        .map((s) => `### Skill: ${s.name}\n${s.description ? s.description + '\n' : ''}${s.prompt}`)
        .join('\n\n');
      prompt += `\n\n---\nActivated skills:\n${skillBlock}`;
    }

    if (!this.contextProvider) return prompt;
    try {
      const query = JSON.stringify(input).slice(0, 500);
      const context = await this.contextProvider(query, this.getActiveAgentId());
      if (!context) return prompt;
      return `${prompt}\n\n---\nRelevant organizational memory (second brain):\n${context.slice(0, 4000)}`;
    } catch (error) {
      if (error instanceof RequiredCompanyBrainError) throw error;
      return prompt;
    }
  }

  async executeAgent(
    agentId: string, config: AgentConfig, input: Record<string, unknown>,
    onProgress?: (progress: number) => void, executionId: string = uuidv4(),
    onEvent?: (event: AgentStreamEvent) => void, opts?: { conversationOnly?: boolean; dryRun?: boolean; onSkillsResolved?: (ids: string[]) => void }
  ): Promise<AgentExecution> {
    if (this.controllers.has(executionId)) throw new CheckpointError('Execution already active');
    const timeoutSeconds = opts?.conversationOnly ? Math.min(config.executionTimeoutSeconds ?? 60, 60) : config.executionTimeoutSeconds ?? 300;
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) throw new Error('Invalid execution timeout');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Execution time limit reached')), timeoutSeconds * 1000);
    const parent = this.runContext.getStore()?.signal;
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort();
    parent?.addEventListener('abort', abort, { once: true });
    this.controllers.set(executionId, controller);
    try {
      return await this.runContext.run({ agentId, executionId, signal: controller.signal, spentUsd: this.executionSpend?.(executionId) ?? 0, compatible: isCompatibleModel(config.model) ? this.compatibleProviders?.resolve(config.model) : undefined }, () =>
        this.executeAgentInternal(agentId, config, input, onProgress, executionId, onEvent, opts));
    } finally {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abort);
      this.controllers.delete(executionId);
      this.settleUnreported(executionId);
    }
  }

  private async executeAgentInternal(
    agentId: string,
    config: AgentConfig,
    input: Record<string, unknown>,
    onProgress?: (progress: number) => void,
    executionId: string = uuidv4(),
    onEvent?: (event: AgentStreamEvent) => void,
    opts?: { conversationOnly?: boolean; dryRun?: boolean; onSkillsResolved?: (ids: string[]) => void }
  ): Promise<AgentExecution> {
    const execution: AgentExecution = {
      dryRun: opts?.dryRun === true,
      id: executionId,
      agentId,
      status: 'pending',
      input,
      progress: 0,
    };

    this.activeExecutions.set(executionId, execution);
    const signal = this.runContext.getStore()!.signal;
    // Per-execution memory sink: brain search tools tag the items they
    // returned so outcomes can be attributed when the run settles.
    const memoryIds = new Set<string>();

    try {
      signal.throwIfAborted();
      execution.status = 'running';
      execution.startedAt = new Date().toISOString();
      execution.progress = 10;
      onProgress?.(10);

      let output: Record<string, unknown>;
      const skills = opts?.conversationOnly ? [] : this.resolveSkills(config, input, agentId);
      execution.activatedSkillIds = skills.map(skill => skill.id);
      opts?.onSkillsResolved?.(execution.activatedSkillIds);
      const constraints = this.constraintsProvider?.(config);
      const denied = constraints?.denyTools?.length ? new Set(constraints.denyTools) : undefined;
      const toolNames = opts?.conversationOnly ? [] : this.enabledToolNames(config, skills, denied);
      const routedModel = !opts?.conversationOnly && this.modelRouter ? this.modelRouter(config.model, input, agentId) : config.model;
      const effectiveConfig: AgentConfig = {
        ...config,
        model: routedModel,
        systemPrompt: opts?.conversationOnly ? CONVERSATION_PROMPT : await this.buildSystemPrompt(config, input, skills),
        ...(opts?.conversationOnly ? { temperature: 0, maxTokens: Math.min(config.maxTokens, 1800) } : {}),
      };

      // Dry-run: collect every tool call the model attempts so the final
      // output doubles as an actionable plan a human can review/approve.
      const plannedActions: Array<{ name: string; args: unknown }> = [];
      const emit = (type: AgentStreamEvent['type'], data?: unknown) => {
        if (opts?.dryRun && type === 'tool_call' && data && typeof data === 'object') {
          const d = data as { name?: string; args?: unknown };
          if (d.name) plannedActions.push({ name: d.name, args: d.args });
        }
        if ((type === 'tool_call' || type === 'tool_result') && data && typeof data === 'object' && this.toolCallRecorder) {
          const d = data as { name?: string; args?: unknown; result?: unknown; error?: unknown };
          if (d.name) {
            try {
              this.toolCallRecorder(executionId, type === 'tool_call' ? 'call' : 'result', d.name, {
                args: d.args, result: d.result, error: d.error,
              });
            } catch { /* audit trail is best-effort */ }
          }
        }
        try { onEvent?.({ type, data }); } catch { /* renderer gone */ }
      };

      const checkpoint = this.checkpoints?.open(executionId, { agentId, config, input, routedModel, ...(opts?.dryRun ? { dryRun: true } : {}),
        transport: this.runContext.getStore()?.compatible ? JSON.stringify(this.runContext.getStore()!.compatible!.profile) : this.oauthTokens.has('openai') && providerForModel(routedModel) === 'openai' ? 'codex' : providerForModel(routedModel),
        schemas: this.toolRegistry.schemasFor(toolNames) }, effectiveConfig.systemPrompt);
      if (checkpoint) effectiveConfig.systemPrompt = checkpoint.systemPrompt;
      const execPolicy: ExecutionPolicy = {
        checkpoint: this.checkpoints,
        ...(constraints?.policy ?? {}),
        memoryUsage: memoryIds,
        callerAgentId: agentId,
        dryRun: opts?.dryRun === true,
        executionId, signal, allowedTools: toolNames,
        workTaskId: typeof input.workTaskId === 'string' ? input.workTaskId : undefined,
      };

      const provider = providerForModel(routedModel) || providerForModel(config.model);
      if (checkpoint?.output) {
        output = checkpoint.output;
      } else if (provider === 'openai') {
        output = await this.executeOpenAI(effectiveConfig, input, toolNames, emit, (progress) => {
          execution.progress = 10 + progress * 0.8;
          onProgress?.(execution.progress);
        }, execPolicy);
      } else if (provider === 'anthropic') {
        output = await this.executeAnthropic(effectiveConfig, input, toolNames, emit, (progress) => {
          execution.progress = 10 + progress * 0.8;
          onProgress?.(execution.progress);
        }, execPolicy);
      } else {
        throw new Error(`Unsupported model: ${config.model}`);
      }

      signal.throwIfAborted();
      this.checkpoints?.complete(executionId, output);
      execution.status = 'completed';
      execution.completedAt = new Date().toISOString();
      execution.progress = 100;
      execution.output = opts?.dryRun
        ? { ...output, dryRun: true, plannedActions }
        : output;

      return execution;
    } catch (error) {
      execution.status = signal.aborted ? 'cancelled' : 'failed';
      execution.completedAt = new Date().toISOString();
      execution.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);


    }
  }

  private async runTool(name: string, argsJson: string, emit: (t: AgentStreamEvent['type'], d?: unknown) => void, policy?: ExecutionPolicy): Promise<string> {
    policy?.signal?.throwIfAborted();
    let args: Record<string, unknown> = {};
    try {
      args = argsJson ? JSON.parse(argsJson) : {};
    } catch {
      args = {};
    }
    emit('tool_call', { name, args });
    try {
      const result = await this.toolRegistry.execute(name, args, policy);
      emit('tool_result', { name, result: result.slice(0, 2000) });
      return result;
    } catch (error) {
      policy?.signal?.throwIfAborted();
      if (error instanceof CheckpointError || policy?.checkpoint) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      emit('tool_result', { name, error: msg });
      return `Tool error: ${msg}`;
    }
  }

  private async executeOpenAI(
    config: AgentConfig,
    input: Record<string, unknown>,
    toolNames: string[],
    emit: (t: AgentStreamEvent['type'], d?: unknown) => void,
    onProgress?: (progress: number) => void,
    policy?: ExecutionPolicy
  ): Promise<Record<string, unknown>> {
    // ChatGPT-subscription OAuth tokens route through the Codex backend
    // (Responses API over SSE), not api.openai.com.
    if (!isCompatibleModel(config.model) && this.oauthTokens.has('openai')) {
      return this.executeOpenAICodex(config, input, toolNames, emit, onProgress, policy);
    }

    const compatible = this.runContext.getStore()?.compatible;
    const client = isCompatibleModel(config.model) ? compatible?.client : this.openaiClients.get('default');
    const requestModel = compatible?.profile.model ?? config.model;
    const maxTokens = Math.min(config.maxTokens, compatible?.profile.maxOutputTokens ?? config.maxTokens);
    if (!client) {
      throw new Error('OpenAI API key not configured');
    }

    onProgress?.(20);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: JSON.stringify(input) },
    ];

    const schemas = this.toolRegistry.schemasFor(toolNames);

    // No tools → stream the response token-by-token.
    if (schemas.length === 0) {
      this.beforeCall(config, JSON.stringify(messages).length, policy);
      const stream = await client.chat.completions.create({
        model: requestModel,
        messages,
        temperature: config.temperature,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }, { signal: policy?.signal });

      onProgress?.(60);

      let content = '';
      let model = config.model;
      let finishReason: string | null = null;
      let usage: TokenUsage | undefined;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          emit('chunk', delta);
        }
        if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        const u = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
        if (u) usage = { promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0 };
      }

      onProgress?.(90);
      if (usage) this.recordCall(config, usage, policy);
      return { content, model, finishReason, usage };
    }

    // Tools enabled → non-streaming tool-call loop.
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = schemas.map((s) => ({
      type: 'function',
      function: { name: s.name, description: s.description, parameters: s.parameters as OpenAI.FunctionParameters },
    }));

    let lastResponse: OpenAI.Chat.Completions.ChatCompletion | null = null;
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      policy?.signal?.throwIfAborted();
      onProgress?.(20 + i * 10);
      const response = await this.providerResponse(policy, `openai:${i}`, async () => {
      this.beforeCall(config, JSON.stringify(messages).length, policy);
      const response = await client.chat.completions.create({
        model: requestModel,
        messages,
        temperature: config.temperature,
        max_tokens: maxTokens,
        tools,
        tool_choice: 'auto',
      }, { signal: policy?.signal });
      if (response.usage) this.recordCall(config, { promptTokens: response.usage.prompt_tokens ?? 0, completionTokens: response.usage.completion_tokens ?? 0 }, policy);
      return response;
      });
      lastResponse = response;
      if (response.usage) {
        usage.promptTokens += response.usage.prompt_tokens ?? 0;
        usage.completionTokens += response.usage.completion_tokens ?? 0;
      }

      const msg = response.choices[0]?.message;
      if (!msg) break;

      if (msg.content) emit('chunk', msg.content);

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length === 0 || response.choices[0]?.finish_reason !== 'tool_calls') {
        break;
      }

      messages.push(msg as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam);
      for (const call of toolCalls) {
        if (call.type !== 'function') continue;
        const result = await this.runTool(call.function.name, call.function.arguments, emit, { ...policy, toolCallKey: `openai:${i}:${call.id}` });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.slice(0, 8000),
        });
      }
    }

    onProgress?.(90);
    if (lastResponse?.choices[0]?.finish_reason === 'tool_calls') throw new Error('Tool iteration limit reached; review progress before retrying');
    const finalMsg = lastResponse?.choices[0]?.message;
    return {
      content: finalMsg?.content || '',
      model: lastResponse?.model,
      usage,
      finishReason: lastResponse?.choices[0]?.finish_reason,
    };
  }

  /**
   * ChatGPT-subscription path: POST https://chatgpt.com/backend-api/codex/responses
   * (OpenAI Responses API over SSE — the backend requires stream:true).
   * Requires a ChatGPT Plus/Pro/Team/Enterprise plan — the OAuth token is
   * scoped to the Codex backend, not api.openai.com.
   */
  private async executeOpenAICodex(
    config: AgentConfig,
    input: Record<string, unknown>,
    toolNames: string[],
    emit: (t: AgentStreamEvent['type'], d?: unknown) => void,
    onProgress?: (progress: number) => void,
    policy?: ExecutionPolicy
  ): Promise<Record<string, unknown>> {
    const token = this.oauthTokens.get('openai');
    if (!token) {
      throw new Error('OpenAI OAuth token not configured');
    }

    onProgress?.(20);

    // Codex backend only serves current gpt-5/6 and codex-line models;
    // pass those through, map anything older to the current codex default.
    const model = /^gpt-[56]/.test(config.model) || config.model.includes('codex')
      ? config.model
      : CODEX_DEFAULT_MODEL;

    const accountId = this.oauthAccountIds.get('openai');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
      // The Codex backend expects the standard Codex client identity.
      'originator': 'codex_cli_rs',
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
    };

    const schemas = this.toolRegistry.schemasFor(toolNames);
    const tools = schemas.map((s) => ({
      type: 'function',
      name: s.name,
      description: s.description,
      parameters: s.parameters,
    }));

    // Responses API input is a list of items; the conversation accumulates
    // across tool-call iterations (store:false → fully stateted by us).
    const inputItems: unknown[] = [{
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: JSON.stringify(input) }],
    }];

    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
    let lastModel = model;
    let finalContent = '';

    const absorbUsage = (u: unknown) => {
      const r = u as Record<string, unknown> | null | undefined;
      if (!r || typeof r !== 'object') return;
      const prompt = Number(r.input_tokens ?? r.prompt_tokens ?? 0);
      const completion = Number(r.output_tokens ?? r.completion_tokens ?? 0);
      usage.promptTokens += prompt;
      usage.completionTokens += completion;
    };

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      policy?.signal?.throwIfAborted();
      onProgress?.(20 + i * 10);

      const response = await this.providerResponse(policy, `codex:${i}`, async () => {
      this.beforeCall({ ...config, model }, config.systemPrompt.length + JSON.stringify(inputItems).length, policy);
      const res = await fetch('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          instructions: config.systemPrompt,
          input: inputItems,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? 'auto' : undefined,
          store: false,
          stream: true,
        }),
        signal: AbortSignal.any([AbortSignal.timeout(300_000), ...(policy?.signal ? [policy.signal] : [])]),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new Error(`Codex backend error (${res.status}): ${text.slice(0, 300)}`);
      }

      // Parse the SSE stream: output_text deltas stream to the UI, while
      // response.completed carries the final response object (output items,
      // usage, status) and function_call items drive the tool loop.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let completed: CodexCompletedEvent | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const ev of events) {
          const dataLine = ev.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let evt: { type?: string; delta?: string; response?: any };
          try {
            evt = JSON.parse(dataLine.slice(5).trim());
          } catch { continue; }
          if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
            finalContent += evt.delta;
            emit('chunk', evt.delta);
          } else if (evt.type === 'response.completed' && evt.response) {
            completed = evt as unknown as CodexCompletedEvent;
          } else if (evt.type === 'response.failed' || evt.type === 'error') {
            throw new Error(`Codex stream error: ${JSON.stringify(evt).slice(0, 300)}`);
          }
        }
      }

      const response = completed?.response;
      if (!response) {
        throw new Error('Codex stream ended without response.completed');
      }
      const u = response.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      this.recordCall({ ...config, model }, { promptTokens: u?.input_tokens ?? 0, completionTokens: u?.output_tokens ?? 0 }, policy);
      return response;
      });
      absorbUsage(response.usage);
      const functionCalls: Array<{ callId: string; name: string; args: string }> = [];
      if (response.model) lastModel = response.model;

      // Collect function calls from the completed output items.
      const outputItems = Array.isArray(response.output) ? response.output : [];
      for (const item of outputItems) {
        if (item.type === 'function_call') {
          functionCalls.push({
            callId: String(item.call_id ?? item.id ?? ''),
            name: String(item.name ?? ''),
            args: String(item.arguments ?? '{}'),
          });
        }
      }

      onProgress?.(80);

      finalContent = outputItems.flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(part => part.type === 'output_text').map(part => String(part.text ?? '')).join('');
      if (functionCalls.length === 0) break;
      if (i === MAX_TOOL_ITERATIONS - 1) throw new Error('Tool iteration limit reached; review progress before retrying');

      // Feed the turn's output items back, then append tool results.
      inputItems.push(...outputItems);
      for (const call of functionCalls) {
        const result = await this.runTool(call.name, call.args, emit, { ...policy, toolCallKey: `codex:${i}:${call.callId}` });
        inputItems.push({
          type: 'function_call_output',
          call_id: call.callId,
          output: result.slice(0, 8000),
        });
      }
    }

    return {
      content: finalContent,
      model: lastModel,
      usage,
    };
  }

  private async executeAnthropic(
    config: AgentConfig,
    input: Record<string, unknown>,
    toolNames: string[],
    emit: (t: AgentStreamEvent['type'], d?: unknown) => void,
    onProgress?: (progress: number) => void,
    policy?: ExecutionPolicy
  ): Promise<Record<string, unknown>> {
    const client = this.anthropicClients.get('default');
    if (!client) {
      throw new Error('Anthropic API key not configured');
    }

    onProgress?.(20);

    const betaHeader = this.oauthBetaHeaders.get('anthropic');
    const requestOpts = { signal: policy?.signal, ...(betaHeader ? { headers: { 'anthropic-beta': betaHeader } } : {}) };

    const schemas = this.toolRegistry.schemasFor(toolNames);

    // No tools → stream text deltas.
    if (schemas.length === 0) {
      this.beforeCall(config, config.systemPrompt.length + JSON.stringify(input).length, policy);
      const stream = client.messages.stream(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          system: config.systemPrompt,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        },
        requestOpts
      );

      let content = '';
      stream.on('text', (text) => {
        content += text;
        emit('chunk', text);
      });

      const finalMessage = await stream.finalMessage();
      this.recordCall(config, { promptTokens: finalMessage.usage?.input_tokens ?? 0, completionTokens: finalMessage.usage?.output_tokens ?? 0 }, policy);
      onProgress?.(90);
      return {
        content,
        model: finalMessage.model,
        usage: {
          promptTokens: finalMessage.usage?.input_tokens ?? 0,
          completionTokens: finalMessage.usage?.output_tokens ?? 0,
        },
        stopReason: finalMessage.stop_reason,
      };
    }

    // Tools → tool_use loop (non-streaming).
    const tools = schemas.map((s) => ({
      name: s.name,
      description: s.description,
      input_schema: s.parameters as Anthropic.Tool.InputSchema,
    }));

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: JSON.stringify(input) },
    ];

    let lastMessage: Anthropic.Message | null = null;
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      policy?.signal?.throwIfAborted();
      onProgress?.(20 + i * 10);
      const response = await this.providerResponse(policy, `anthropic:${i}`, async () => {
      this.beforeCall(config, config.systemPrompt.length + JSON.stringify(messages).length, policy);
      const response = await client.messages.create(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          system: config.systemPrompt,
          messages,
          tools,
        },
        requestOpts
      );
      this.recordCall(config, { promptTokens: response.usage?.input_tokens ?? 0, completionTokens: response.usage?.output_tokens ?? 0 }, policy);
      return response;
      });
      lastMessage = response;
      usage.promptTokens += response.usage?.input_tokens ?? 0;
      usage.completionTokens += response.usage?.output_tokens ?? 0;

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      const textParts = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (textParts) emit('chunk', textParts);

      if (toolUses.length === 0 || response.stop_reason !== 'tool_use') break;

      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const result = await this.runTool(tu.name, JSON.stringify(tu.input ?? {}), emit, { ...policy, toolCallKey: `anthropic:${i}:${tu.id}` });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.slice(0, 8000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    onProgress?.(90);
    if (lastMessage?.stop_reason === 'tool_use') throw new Error('Tool iteration limit reached; review progress before retrying');
    const text = lastMessage?.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('') || '';
    return {
      content: text,
      model: lastMessage?.model,
      usage,
      stopReason: lastMessage?.stop_reason,
    };
  }

  cancelExecution(executionId: string): void {
    this.controllers.get(executionId)?.abort(new Error('Execution cancelled'));
    const execution = this.activeExecutions.get(executionId);
    if (execution && execution.status === 'running') {
      execution.status = 'cancelled';
      execution.completedAt = new Date().toISOString();
    }
  }

  getActiveAgentId(): string | undefined {
    return this.runContext.getStore()?.agentId;
  }

  getExecution(executionId: string): AgentExecution | undefined {
    return this.activeExecutions.get(executionId);
  }

  getActiveExecutions(): AgentExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort(new Error('Application shutting down'));
    this.activeExecutions.clear();
    this.openaiClients.clear();
    this.anthropicClients.clear();
  }
}

