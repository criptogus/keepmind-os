import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { AgentConfig, AgentExecution, Skill } from '../../shared/types.js';
import { CODEX_DEFAULT_MODEL, providerForModel } from '../../shared/models.js';
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

interface CodexCompletedEvent {
  response?: {
    output?: Array<Record<string, unknown>>;
    usage?: unknown;
    status?: string;
    model?: string;
  };
}

export class AgentManager {
  private openaiClients: Map<string, OpenAI> = new Map();
  private anthropicClients: Map<string, Anthropic> = new Map();
  private oauthTokens: Map<string, string> = new Map();
  private oauthBetaHeaders: Map<string, string> = new Map();
  private oauthAccountIds: Map<string, string> = new Map();
  private activeExecutions: Map<string, AgentExecution> = new Map();
  private contextProvider?: (query: string) => Promise<string>;
  private skillLoader?: (skillIds: string[]) => Skill[];
  private autoSkillSelector?: (input: Record<string, unknown>, assigned: Skill[]) => Skill[];
  private modelRouter?: (model: string, input: Record<string, unknown>) => string;
  private currentAgentId?: string;
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
  setContextProvider(provider?: (query: string) => Promise<string>) {
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
  setAutoSkillSelector(selector?: (input: Record<string, unknown>, assigned: Skill[]) => Skill[]) {
    this.autoSkillSelector = selector;
  }

  /**
   * Optional model router: given the configured model and task input, returns
   * the model actually used for this execution (same provider family).
   */
  setModelRouter(router?: (model: string, input: Record<string, unknown>) => string) {
    this.modelRouter = router;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
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
  private resolveSkills(config: AgentConfig, input: Record<string, unknown>): Skill[] {
    const assigned = this.loadSkills(config);
    if (!this.autoSkillSelector) return assigned;
    try {
      const assignedIds = new Set(assigned.map((s) => s.id));
      const extra = this.autoSkillSelector(input, assigned).filter((s) => !assignedIds.has(s.id));
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
      const context = await this.contextProvider(query);
      if (!context) return prompt;
      return `${prompt}\n\n---\nRelevant organizational memory (second brain):\n${context.slice(0, 4000)}`;
    } catch {
      return prompt;
    }
  }

  async executeAgent(
    agentId: string,
    config: AgentConfig,
    input: Record<string, unknown>,
    onProgress?: (progress: number) => void,
    executionId: string = uuidv4(),
    onEvent?: (event: AgentStreamEvent) => void
  ): Promise<AgentExecution> {
    const execution: AgentExecution = {
      id: executionId,
      agentId,
      status: 'pending',
      input,
      progress: 0,
    };

    this.activeExecutions.set(executionId, execution);
    const prevAgentId = this.currentAgentId;
    this.currentAgentId = agentId;

    try {
      execution.status = 'running';
      execution.startedAt = new Date().toISOString();
      execution.progress = 10;
      onProgress?.(10);

      let output: Record<string, unknown>;
      const skills = this.resolveSkills(config, input);
      const constraints = this.constraintsProvider?.(config);
      const denied = constraints?.denyTools?.length ? new Set(constraints.denyTools) : undefined;
      const toolNames = this.enabledToolNames(config, skills, denied);
      const routedModel = this.modelRouter ? this.modelRouter(config.model, input) : config.model;
      const effectiveConfig: AgentConfig = {
        ...config,
        model: routedModel,
        systemPrompt: await this.buildSystemPrompt(config, input, skills),
      };

      const emit = (type: AgentStreamEvent['type'], data?: unknown) => {
        try { onEvent?.({ type, data }); } catch { /* renderer gone */ }
      };

      const provider = providerForModel(routedModel) || providerForModel(config.model);
      if (provider === 'openai') {
        output = await this.executeOpenAI(effectiveConfig, input, toolNames, emit, (progress) => {
          execution.progress = 10 + progress * 0.8;
          onProgress?.(execution.progress);
        }, constraints?.policy);
      } else if (provider === 'anthropic') {
        output = await this.executeAnthropic(effectiveConfig, input, toolNames, emit, (progress) => {
          execution.progress = 10 + progress * 0.8;
          onProgress?.(execution.progress);
        }, constraints?.policy);
      } else {
        throw new Error(`Unsupported model: ${config.model}`);
      }

      execution.status = 'completed';
      execution.completedAt = new Date().toISOString();
      execution.progress = 100;
      execution.output = output;

      return execution;
    } catch (error) {
      execution.status = 'failed';
      execution.completedAt = new Date().toISOString();
      execution.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
      this.currentAgentId = prevAgentId;
    }
  }

  private async runTool(name: string, argsJson: string, emit: (t: AgentStreamEvent['type'], d?: unknown) => void, policy?: ExecutionPolicy): Promise<string> {
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
    if (this.oauthTokens.has('openai')) {
      return this.executeOpenAICodex(config, input, toolNames, emit, onProgress, policy);
    }

    const client = this.openaiClients.get('default');
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
      const stream = await client.chat.completions.create({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: true,
      });

      onProgress?.(60);

      let content = '';
      let model = config.model;
      let finishReason: string | null = null;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          emit('chunk', delta);
        }
        if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      }

      onProgress?.(90);
      return { content, model, finishReason };
    }

    // Tools enabled → non-streaming tool-call loop.
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = schemas.map((s) => ({
      type: 'function',
      function: { name: s.name, description: s.description, parameters: s.parameters as OpenAI.FunctionParameters },
    }));

    let lastResponse: OpenAI.Chat.Completions.ChatCompletion | null = null;
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      onProgress?.(20 + i * 10);
      const response = await client.chat.completions.create({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        tools,
        tool_choice: 'auto',
      });
      lastResponse = response;

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
        const result = await this.runTool(call.function.name, call.function.arguments, emit, policy);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.slice(0, 8000),
        });
      }
    }

    onProgress?.(90);
    const finalMsg = lastResponse?.choices[0]?.message;
    return {
      content: finalMsg?.content || '',
      model: lastResponse?.model,
      usage: lastResponse?.usage,
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

    let lastUsage: unknown;
    let lastModel = model;
    let finalContent = '';

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      onProgress?.(20 + i * 10);

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
        signal: AbortSignal.timeout(300_000),
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
      const functionCalls: Array<{ callId: string; name: string; args: string }> = [];

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
      lastUsage = response.usage;
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

      if (functionCalls.length === 0) break;

      // Feed the turn's output items back, then append tool results.
      inputItems.push(...outputItems);
      for (const call of functionCalls) {
        const result = await this.runTool(call.name, call.args, emit, policy);
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
      usage: lastUsage,
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
    const requestOpts = betaHeader ? { headers: { 'anthropic-beta': betaHeader } } : undefined;

    const schemas = this.toolRegistry.schemasFor(toolNames);

    // No tools → stream text deltas.
    if (schemas.length === 0) {
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
      onProgress?.(90);
      return {
        content,
        model: finalMessage.model,
        usage: finalMessage.usage,
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
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      onProgress?.(20 + i * 10);
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
      lastMessage = response;

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
        const result = await this.runTool(tu.name, JSON.stringify(tu.input ?? {}), emit, policy);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.slice(0, 8000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    onProgress?.(90);
    const text = lastMessage?.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('') || '';
    return {
      content: text,
      model: lastMessage?.model,
      usage: lastMessage?.usage,
      stopReason: lastMessage?.stop_reason,
    };
  }

  cancelExecution(executionId: string): void {
    const execution = this.activeExecutions.get(executionId);
    if (execution && execution.status === 'running') {
      execution.status = 'cancelled';
      execution.completedAt = new Date().toISOString();
    }
  }

  getActiveAgentId(): string | undefined {
    return this.currentAgentId;
  }

  getExecution(executionId: string): AgentExecution | undefined {
    return this.activeExecutions.get(executionId);
  }

  getActiveExecutions(): AgentExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  async shutdown(): Promise<void> {
    this.activeExecutions.clear();
    this.openaiClients.clear();
    this.anthropicClients.clear();
  }
}
