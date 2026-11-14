import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageManager } from '../src/main/storage/StorageManager.js';
import { ChatManager } from '../src/main/chat/ChatManager.js';
import type { Agent, Team, AgentExecution, ChatEvent } from '../src/shared/types.js';
import type { AgentStreamEvent } from '../src/main/agent/AgentManager.js';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-data' },
}));

function makeAgent(id: string, name: string): Agent {
  const now = new Date().toISOString();
  return {
    id, name, description: '',
    config: { model: 'gpt-4', temperature: 0.7, maxTokens: 1024, systemPrompt: '', tools: [] },
    capabilities: [],
    permissions: { canAccessNetwork: false, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 60 },
    createdAt: now, updatedAt: now,
  } as Agent;
}

function makeTeam(id: string, name: string, agentIds: string[]): Team {
  const now = new Date().toISOString();
  return {
    id, name, description: '', agentIds,
    workflow: { id: 'w1', name: 'default', steps: [], executionMode: 'sequential' },
    createdAt: now, updatedAt: now,
  } as Team;
}

function makeExecution(agentId: string): AgentExecution {
  return { id: `ex-${agentId}`, agentId, status: 'completed', input: {}, output: { content: 'resposta final' }, progress: 100 };
}

describe('ChatManager', () => {
  let dir: string;
  let storage: StorageManager;
  let events: ChatEvent[];
  let agents: Agent[];
  let teams: Team[];
  let chat: ChatManager;

  const runAgent = vi.fn(async (agentId: string, _input: Record<string, unknown>, onEvent?: (e: AgentStreamEvent) => void) => {
    onEvent?.({ type: 'chunk', data: 'Olá ' });
    onEvent?.({ type: 'tool_call', data: { name: 'file_read' } });
    onEvent?.({ type: 'tool_result', data: { name: 'file_read' } });
    onEvent?.({ type: 'chunk', data: 'mundo' });
    return makeExecution(agentId);
  });
  const runTeam = vi.fn(async () => ({
    teamId: 't1', status: 'completed' as const, duration: 5,
    results: [{ agentId: 'a1', agentName: 'Ana', status: 'completed' as const, output: { content: 'ok' } }],
  }));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-chatmgr-'));
    storage = new StorageManager(dir);
    storage.saveAgent(makeAgent('a1', 'Ana'));
    storage.saveAgent(makeAgent('a2', 'Beto'));
    storage.ensureDefaultChannels();
    agents = storage.getAllAgents();
    teams = [makeTeam('t1', 'Vendas', ['a1'])];
    events = [];
    runAgent.mockClear();
    runTeam.mockClear();
    chat = new ChatManager({
      storage,
      runAgent,
      runTeam,
      getAgents: () => agents,
      getTeams: () => teams,
      currentUser: () => ({ id: 'u1', name: 'Gus', email: 'gus@x.com' }),
      emit: (e) => events.push(e),
    });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists a plain user message with no mentions', async () => {
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    const msg = await chat.sendMessage(ch.id, 'bom dia');
    expect(msg.authorKind).toBe('user');
    expect(msg.authorName).toBe('Gus');
    expect(runAgent).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'message-created')).toBe(true);
  });

  it('routes @agent mention to a streaming reply', async () => {
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    await chat.sendMessage(ch.id, '@Ana faz um resumo');
    // sendMessage resolves after dispatch; the async reply may still be in flight.
    await vi.waitFor(() => {
      const msgs = storage.getMessages(ch.id);
      expect(msgs.some((m) => m.authorKind === 'agent' && m.status === 'done')).toBe(true);
    });
    const reply = storage.getMessages(ch.id).find((m) => m.authorKind === 'agent')!;
    expect(reply.authorName).toBe('Ana');
    expect(reply.body).toBe('resposta final');
    expect(reply.executionId).toBe('ex-a1');
    const tc = (reply.meta?.toolCalls as Array<{ name: string }> | undefined) ?? [];
    expect(tc.some((t) => t.name === 'file_read')).toBe(true);
  });

  it('does not trigger on unknown mention', async () => {
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    await chat.sendMessage(ch.id, '@Fantasma olá');
    await new Promise((r) => setTimeout(r, 20));
    expect(runAgent).not.toHaveBeenCalled();
    expect(runTeam).not.toHaveBeenCalled();
  });

  it('routes two mentions to two executions', async () => {
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    await chat.sendMessage(ch.id, '@Ana e @Beto vejam isso');
    await vi.waitFor(() => {
      expect(storage.getMessages(ch.id).filter((m) => m.authorKind === 'agent' && m.status === 'done')).toHaveLength(2);
    });
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it('thread replies without mentions do not auto-dispatch', async () => {
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    const parent = await chat.sendMessage(ch.id, 'assunto');
    await chat.sendMessage(ch.id, 'concordo', { parentId: parent.id });
    await new Promise((r) => setTimeout(r, 20));
    expect(runAgent).not.toHaveBeenCalled();
    expect(runTeam).not.toHaveBeenCalled();
    expect(storage.getThreadMessages(parent.id)).toHaveLength(1);
    expect(storage.getMessages(ch.id).some((m) => m.parentId)).toBe(false);
  });

  it('mention inside a thread replies inside the thread', async () => {
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    const parent = await chat.sendMessage(ch.id, 'preciso de ajuda');
    await chat.sendMessage(ch.id, '@Ana detalha isso', { parentId: parent.id });
    await vi.waitFor(() => {
      expect(storage.getThreadMessages(parent.id).some((m) => m.authorKind === 'agent' && m.status === 'done')).toBe(true);
    });
    const reply = storage.getThreadMessages(parent.id).find((m) => m.authorKind === 'agent')!;
    expect(reply.parentId).toBe(parent.id);
    expect(storage.getMessages(ch.id).filter((m) => m.authorKind === 'agent')).toHaveLength(0);
  });

  it('marks failed executions as error status', async () => {
    runAgent.mockRejectedValueOnce(new Error('provider down'));
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    await chat.sendMessage(ch.id, '@Ana tenta');
    await vi.waitFor(() => {
      const reply = storage.getMessages(ch.id).find((m) => m.authorKind === 'agent');
      expect(reply?.status).toBe('error');
    });
    const reply = storage.getMessages(ch.id).find((m) => m.authorKind === 'agent')!;
    expect(reply.body).toContain('provider down');
  });

  it('routes @team mention to a consolidated reply', async () => {
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    await chat.sendMessage(ch.id, '@Vendas fecha o mês');
    await vi.waitFor(() => {
      expect(storage.getMessages(ch.id).some((m) => m.authorKind === 'team' && m.status === 'done')).toBe(true);
    });
    const reply = storage.getMessages(ch.id).find((m) => m.authorKind === 'team')!;
    expect(reply.authorName).toBe('Vendas');
    expect(reply.body).toContain('ok');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('posts approval cards to origin channel and #approvals', async () => {
    const geral = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    await chat.sendMessage(geral.id, '@Ana faz algo sensível');
    await vi.waitFor(() => {
      expect(storage.getMessages(geral.id).some((m) => m.authorKind === 'agent' && m.status === 'done')).toBe(true);
    });
    chat.notifyApprovalRequested({
      id: 'ap1', type: 'agent_action', agentId: 'a1', agentName: 'Ana',
      action: 'tool:shell_exec', context: {}, status: 'pending', createdAt: new Date().toISOString(),
    } as any);
    const geralMsgs = storage.getMessages(geral.id).filter((m) => m.meta?.kind === 'approval');
    expect(geralMsgs).toHaveLength(1);
    const approvalsCh = storage.listChannels('u1').find((c) => c.name === 'approvals')!;
    const approvalMsgs = storage.getMessages(approvalsCh.id).filter((m) => m.meta?.kind === 'approval');
    expect(approvalMsgs).toHaveLength(1);
    expect((approvalMsgs[0].meta as any).approvalId).toBe('ap1');
  });

  it('sendMessage to missing channel throws', async () => {
    await expect(chat.sendMessage('nope', 'hi')).rejects.toThrow();
  });

  it('auto-routes DM messages to the channel agent without a mention', async () => {
    const dm = storage.createChannel({ name: 'Ana', kind: 'dm', agentId: 'a1' });
    agents = storage.getAllAgents();
    await chat.sendMessage(dm.id, 'e ai, tudo bem?');
    await vi.waitFor(() => {
      expect(storage.getMessages(dm.id).some((m) => m.authorKind === 'agent' && m.status === 'done')).toBe(true);
    });
    expect(runAgent).toHaveBeenCalledWith('a1', expect.objectContaining({ message: 'e ai, tudo bem?' }), expect.any(Function));
  });

  it('auto-routes channel messages to the KeepMind assistant when no mention', async () => {
    storage.saveAgent(makeAgent('k1', 'KeepMind'));
    agents = storage.getAllAgents();
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    await chat.sendMessage(ch.id, 'que horas são?');
    await vi.waitFor(() => {
      expect(storage.getMessages(ch.id).some((m) => m.authorKind === 'agent' && m.authorId === 'k1' && m.status === 'done')).toBe(true);
    });
  });

  it('does not auto-route when KeepMind assistant is absent', async () => {
    const ch = storage.listChannels('u1').find((c) => c.name === 'geral')!;
    await chat.sendMessage(ch.id, 'mensagem solta');
    await new Promise((r) => setTimeout(r, 30));
    expect(runAgent).not.toHaveBeenCalled();
  });
});
