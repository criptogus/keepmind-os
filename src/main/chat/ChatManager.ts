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

  async sendMessage(channelId: string, text: string): Promise<ChannelMessage> {
    const { storage } = this.deps;
    const channel = storage.getChannel(channelId);
    if (!channel) throw new Error('Channel not found');
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Empty message');

    const user = this.deps.currentUser();
    const msg = storage.saveMessage({
      channelId,
      authorKind: 'user',
      authorId: user?.id ?? 'system',
      authorName: user?.name ?? user?.email ?? 'Você',
      body: trimmed,
      status: 'done',
    });
    this.deps.emit({ type: 'message-created', channelId, message: msg });

    this.dispatchMentions(msg, channel, trimmed);
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
    const mentions = parseMentions(text, this.deps.getAgents(), this.deps.getTeams());
    for (const m of mentions) {
      if (m.kind === 'agent') {
        const agent = this.deps.getAgents().find((a) => a.name === m.name);
        if (agent) void this.runAgentReply(channel, agent, text);
      } else {
        const team = this.deps.getTeams().find((t) => t.name === m.name);
        if (team) void this.runTeamReply(channel, team, text);
      }
    }
  }

  private async runAgentReply(channel: Channel, agent: Agent, text: string): Promise<void> {
    const { storage } = this.deps;
    this.agentChannel.set(agent.id, channel.id);
    const msg = storage.saveMessage({
      channelId: channel.id,
      authorKind: 'agent',
      authorId: agent.id,
      authorName: agent.name,
      body: '',
      status: 'streaming',
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

  private async runTeamReply(channel: Channel, team: Team, text: string): Promise<void> {
    const { storage } = this.deps;
    const msg = storage.saveMessage({
      channelId: channel.id,
      authorKind: 'team',
      authorId: team.id,
      authorName: team.name,
      body: '',
      status: 'streaming',
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
