import type { StorageManager } from '../storage/StorageManager.js';
import type { AgentStreamEvent } from '../agent/AgentManager.js';
import { parseMentions } from '../../shared/mentions.js';
import type {
  Agent, Team, AgentExecution, Approval, Channel, ChannelMessage, ChatEvent,
} from '../../shared/types.js';

export interface ChatManagerDeps {
  storage: StorageManager;
  runAgent: (agentId: string, input: Record<string, unknown>, onEvent: (e: AgentStreamEvent & { executionId?: string }) => void) => Promise<AgentExecution>;
  runTeam: (teamId: string, input: Record<string, unknown>) => Promise<{
    teamId: string;
    status: 'completed' | 'failed' | 'partial';
    results: Array<{ agentId: string; agentName: string; status: string; output?: Record<string, unknown>; error?: string }>;
    duration: number;
  }>;
  getAgents: () => Agent[];
  getTeams: () => Team[];
  currentExecutionId?: () => string | undefined;
  currentUser: () => { id: string; name?: string; email?: string } | null;
  emit: (event: ChatEvent) => void;
}

const FLUSH_MS = 80;

function extractText(output: Record<string, unknown> | undefined): string {
  if (!output) return '';
  const c = output.content ?? output.text ?? output.message;
  if (typeof c === 'string') return c;
  try { return JSON.stringify(output); } catch { return String(output); }
}

export class ChatManager {
  /** executionId → channelId, so approval cards can find their origin channel. */
  private executionChannel = new Map<string, string>();
  /** agentId → last channel that ran it (fallback when executionId unknown). */
  private agentChannel = new Map<string, string>();

  constructor(private deps: ChatManagerDeps) {}

  channelForExecution(executionId: string): string | null {
    return this.executionChannel.get(executionId) ?? null;
  }

  channelForAgent(agentId: string): string | null {
    return this.agentChannel.get(agentId) ?? null;
  }

  /**
   * Posts an approval card into the chat: the origin channel (when the
   * approval came from a chat-triggered run) and always #approvals.
   */
  notifyApprovalRequested(approval: Approval, executionId?: string): void {
    const { storage } = this.deps;
    const execId = executionId ?? this.deps.currentExecutionId?.() ?? null;
    const origin = (execId && this.channelForExecution(execId))
      ?? this.channelForAgent(approval.agentId);
    const approvalsCh = storage.listChannels().find((c) => c.name === 'approvals');
    const cardMeta = {
      kind: 'approval',
      approvalId: approval.id,
      agentName: approval.agentName,
      action: approval.action,
      status: approval.status,
    };
    const body = `⚠ Aprovação necessária — **${approval.agentName}** quer executar \`${approval.action}\``;
    if (origin) this.postSystemMessage(origin, body, cardMeta);
    if (approvalsCh && approvalsCh.id !== origin) {
      this.postSystemMessage(approvalsCh.id, body, cardMeta);
    }
  }

  async sendMessage(channelId: string, text: string, opts?: { parentId?: string; attachments?: Array<Record<string, unknown>> }): Promise<ChannelMessage> {
    const { storage } = this.deps;
    const channel = storage.getChannel(channelId);
    if (!channel) throw new Error('Channel not found');
    const trimmed = text.trim();
    const attachments = opts?.attachments?.length ? opts.attachments : undefined;
    if (!trimmed && !attachments?.length) throw new Error('Empty message');
    if (opts?.parentId) {
      const parent = storage.getMessage(opts.parentId);
      if (!parent || parent.channelId !== channelId) throw new Error('Thread parent not found');
    }

    const user = this.deps.currentUser();
    const msg = storage.saveMessage({
      channelId,
      authorKind: 'user',
      authorId: user?.id ?? 'system',
      authorName: user?.name ?? user?.email ?? 'Você',
      body: trimmed,
      status: 'done',
      parentId: opts?.parentId,
      meta: attachments?.length ? { attachments } : undefined,
    });
    this.deps.emit({ type: 'message-created', channelId, message: msg });

    const attPreviews = (attachments ?? [])
      .map((a) => `[anexo: ${String(a.name ?? 'arquivo')}${a.preview ? ` — ${String(a.preview).slice(0, 4000)}` : ''}]`)
      .join('\n');
    const agentText = [trimmed, attPreviews].filter(Boolean).join('\n\n');
    this.dispatchMentions(msg, channel, agentText || trimmed);
    return msg;
  }

  /** Toggle an emoji reaction on a message; returns the updated reactions map. */
  react(messageId: string, emoji: string, userId?: string): Record<string, string[]> {
    const { storage } = this.deps;
    const msg = storage.getMessage(messageId);
    if (!msg) throw new Error('Message not found');
    const channelId = msg.channelId;
    const uid = userId ?? this.deps.currentUser()?.id ?? 'system';
    const meta = { ...(msg.meta ?? {}) } as Record<string, unknown>;
    const reactions = { ...((meta.reactions as Record<string, string[]>) ?? {}) };
    const users = new Set(reactions[emoji] ?? []);
    if (users.has(uid)) users.delete(uid); else users.add(uid);
    if (users.size) reactions[emoji] = [...users]; else delete reactions[emoji];
    if (Object.keys(reactions).length) meta.reactions = reactions; else delete meta.reactions;
    storage.updateMessage(messageId, { meta });
    const fresh = storage.getMessage(messageId);
    if (fresh) this.deps.emit({ type: 'message-updated', channelId, message: fresh });
    return reactions;
  }

  /** Agent-authored message posted via tools (chat_post). */
  postAgentMessage(channelName: string, agent: Agent, body: string, parentId?: string): ChannelMessage {
    const channel = this.deps.storage.listChannels().find((c) => c.name.toLowerCase() === channelName.toLowerCase().replace(/^#/, ''));
    if (!channel) throw new Error(`Channel not found: ${channelName}`);
    if (parentId) {
      const parent = this.deps.storage.getMessage(parentId);
      if (!parent || parent.channelId !== channel.id) throw new Error('Thread parent not found');
    }
    const msg = this.deps.storage.saveMessage({
      channelId: channel.id,
      authorKind: 'agent',
      authorId: agent.id,
      authorName: agent.name,
      body: body.slice(0, 8000),
      status: 'done',
      parentId,
    });
    this.deps.emit({ type: 'message-created', channelId: channel.id, message: msg });
    return msg;
  }

  /** Recent messages of a channel for agent tools. */
  readChannel(channelName: string, limit = 20): string {
    const channel = this.deps.storage.listChannels().find((c) => c.name.toLowerCase() === channelName.toLowerCase().replace(/^#/, ''));
    if (!channel) throw new Error(`Channel not found: ${channelName}`);
    const msgs = this.deps.storage.getMessages(channel.id, { limit: Math.min(limit, 50) });
    const lines = msgs.map((m) => {
      const atts = (m.meta?.attachments as Array<{ name: string; preview?: string }> | undefined) ?? [];
      const attTxt = atts.length ? ` [anexos: ${atts.map((a) => a.name + (a.preview ? ` — ${a.preview.slice(0, 200)}` : '')).join('; ')}]` : '';
      const parent = m.parentId ? ' (thread)' : '';
      return `[${m.createdAt}] ${m.authorName}${parent}: ${m.body.slice(0, 500)}${attTxt}`;
    });
    return lines.join('\n') || '(canal vazio)';
  }

  /** System-authored message (approval cards, notices). */
  postSystemMessage(channelId: string, body: string, meta?: Record<string, unknown>): ChannelMessage {
    const msg = this.deps.storage.saveMessage({
      channelId,
      authorKind: 'system',
      authorId: 'system',
      authorName: 'KeepMind',
      body,
      status: 'done',
      meta,
    });
    this.deps.emit({ type: 'message-created', channelId, message: msg });
    return msg;
  }

  private dispatchMentions(userMsg: ChannelMessage, channel: Channel, text: string): void {
    const parentId = userMsg.parentId;
    const mentions = parseMentions(text, this.deps.getAgents(), this.deps.getTeams());
    // Agentic routing: explicit mentions win; otherwise DMs go to their agent
    // and channel messages go to the built-in KeepMind assistant, which can
    // answer, configure the app or delegate to specialists on its own.
    if (mentions.length === 0) {
      if (parentId) return; // thread replies stay conversational — no auto-dispatch
      const agents = this.deps.getAgents();
      if (channel.kind === 'dm' && channel.agentId) {
        const dmAgent = agents.find((a) => a.id === channel.agentId);
        if (dmAgent) void this.runAgentReply(channel, dmAgent, text, parentId);
        return;
      }
      const assistant = agents.find((a) => a.name === 'KeepMind');
      if (assistant) void this.runAgentReply(channel, assistant, text, parentId);
      return;
    }
    for (const m of mentions) {
      if (m.kind === 'agent') {
        const agent = this.deps.getAgents().find((a) => a.name === m.name);
        if (agent) void this.runAgentReply(channel, agent, text, parentId);
      } else {
        const team = this.deps.getTeams().find((t) => t.name === m.name);
        if (team) void this.runTeamReply(channel, team, text, parentId);
      }
    }
  }

  private async runAgentReply(channel: Channel, agent: Agent, text: string, parentId?: string): Promise<void> {
    const { storage } = this.deps;
    this.agentChannel.set(agent.id, channel.id);
    const msg = storage.saveMessage({
      channelId: channel.id,
      authorKind: 'agent',
      authorId: agent.id,
      authorName: agent.name,
      body: '',
      status: 'streaming',
      parentId,
    });
    this.deps.emit({ type: 'message-created', channelId: channel.id, message: msg });

    let body = '';
    const toolCalls: Array<Record<string, unknown>> = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const persist = (status?: ChannelMessage['status']) => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      storage.updateMessage(msg.id, {
        body,
        status: status ?? 'streaming',
        meta: toolCalls.length ? { toolCalls } : undefined,
      });
      const fresh = storage.getMessages(channel.id, { limit: 500 }).find((x) => x.id === msg.id);
      if (fresh) this.deps.emit({ type: 'message-updated', channelId: channel.id, message: fresh });
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => persist(), FLUSH_MS);
    };

    try {
      const execution = await this.deps.runAgent(
        agent.id,
        { message: text, channel: channel.name, mentionedBy: 'user' },
        (event) => {
          if (event.executionId) this.executionChannel.set(event.executionId, channel.id);
          if (event.type === 'chunk' && typeof event.data === 'string') {
            body += event.data;
            scheduleFlush();
          } else if (event.type === 'tool_call') {
            toolCalls.push({ name: (event.data as any)?.name ?? 'tool', status: 'pending' });
            persist();
          } else if (event.type === 'tool_result') {
            const last = [...toolCalls].reverse().find((t) => t.status === 'pending');
            if (last) last.status = 'done';
            persist();
          } else if (event.type === 'error') {
            body += `\n\n_⚠ ${String(event.data ?? 'erro')}_`;
            persist();
          }
        },
      );
      this.executionChannel.set(execution.id, channel.id);
      storage.updateMessage(msg.id, { executionId: execution.id });
      const finalBody = extractText(execution.output) || body;
      body = finalBody;
      persist('done');
    } catch (err) {
      body += `\n\n_⚠ ${err instanceof Error ? err.message : String(err)}_`;
      persist('error');
    }
  }

  private async runTeamReply(channel: Channel, team: Team, text: string, parentId?: string): Promise<void> {
    const { storage } = this.deps;
    const msg = storage.saveMessage({
      channelId: channel.id,
      authorKind: 'team',
      authorId: team.id,
      authorName: team.name,
      body: '',
      status: 'streaming',
      parentId,
    });
    this.deps.emit({ type: 'message-created', channelId: channel.id, message: msg });

    const setBody = (body: string, status: ChannelMessage['status'], meta?: Record<string, unknown>) => {
      storage.updateMessage(msg.id, { body, status, meta });
      const fresh = storage.getMessages(channel.id, { limit: 200 }).find((x) => x.id === msg.id);
      if (fresh) this.deps.emit({ type: 'message-updated', channelId: channel.id, message: fresh });
    };

    try {
      const result = await this.deps.runTeam(team.id, { message: text, channel: channel.name });
      const lines = result.results.map((r) => {
        const out = extractText(r.output);
        return r.status === 'completed'
          ? `**${r.agentName}**: ${out || '✓'}`
          : `**${r.agentName}**: ⚠ ${r.error ?? 'falhou'}`;
      });
      setBody(
        `_${result.status === 'completed' ? 'concluído' : result.status}_ · ${result.duration}ms\n\n${lines.join('\n')}`,
        result.status === 'failed' ? 'error' : 'done',
        { teamResults: result.results },
      );
    } catch (err) {
      setBody(`_⚠ ${err instanceof Error ? err.message : String(err)}_`, 'error');
    }
  }
}
