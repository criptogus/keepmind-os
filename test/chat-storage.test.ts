import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageManager } from '../src/main/storage/StorageManager.js';
import type { Agent } from '../src/shared/types.js';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-data' },
}));

import { vi } from 'vitest';

function makeAgent(id: string, name: string): Agent {
  const now = new Date().toISOString();
  return {
    id,
    name,
    description: '',
    config: { model: 'gpt-4', temperature: 0.7, maxTokens: 1024, systemPrompt: '', tools: [] },
    capabilities: [],
    permissions: { canAccessNetwork: false, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 60 },
    createdAt: now,
    updatedAt: now,
  } as Agent;
}

describe('StorageManager chat', () => {
  let dir: string;
  let storage: StorageManager;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-chat-'));
    storage = new StorageManager(dir);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ensureDefaultChannels creates geral + approvals once', () => {
    storage.saveAgent(makeAgent('a1', 'Ana'));
    storage.ensureDefaultChannels();
    storage.ensureDefaultChannels();
    const channels = storage.listChannels('u1');
    const names = channels.map((c) => c.name);
    expect(names).toContain('geral');
    expect(names).toContain('approvals');
    expect(channels.filter((c) => c.name === 'geral')).toHaveLength(1);
    const geral = channels.find((c) => c.name === 'geral')!;
    expect(geral.agents.map((a) => a.name)).toContain('Ana');
  });

  it('createChannel/listChannels round-trip with unread counting', () => {
    storage.ensureDefaultChannels();
    const ch = storage.createChannel({ name: 'projeto-x', agentIds: [] });
    expect(ch.name).toBe('projeto-x');
    expect(ch.kind).toBe('channel');

    storage.saveMessage({ channelId: ch.id, authorKind: 'agent', authorId: 'a1', authorName: 'Ana', body: 'oi', status: 'done' });
    let view = storage.listChannels('u1').find((c) => c.id === ch.id)!;
    expect(view.unread).toBe(1);

    storage.markChannelRead(ch.id, 'u1');
    view = storage.listChannels('u1').find((c) => c.id === ch.id)!;
    expect(view.unread).toBe(0);
  });

  it('does not count own user messages as unread', () => {
    storage.ensureDefaultChannels();
    const ch = storage.createChannel({ name: 'c1' });
    storage.saveMessage({ channelId: ch.id, authorKind: 'user', authorId: 'u1', authorName: 'Eu', body: 'msg', status: 'done' });
    const view = storage.listChannels('u1').find((c) => c.id === ch.id)!;
    expect(view.unread).toBe(0);
  });

  it('findDmChannel returns the dm for an agent', () => {
    storage.saveAgent(makeAgent('a2', 'Beto'));
    const dm = storage.createChannel({ name: 'Beto', kind: 'dm', agentId: 'a2' });
    expect(dm.kind).toBe('dm');
    expect(dm.agentId).toBe('a2');
    expect(storage.findDmChannel('a2')?.id).toBe(dm.id);
    expect(storage.findDmChannel('nope')).toBeNull();
  });

  it('getMessages paginates with before cursor', () => {
    storage.ensureDefaultChannels();
    const ch = storage.createChannel({ name: 'chat' });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const m = storage.saveMessage({ channelId: ch.id, authorKind: 'user', authorId: 'u', authorName: 'U', body: `m${i}`, status: 'done' });
      ids.push(m.id);
    }
    const all = storage.getMessages(ch.id);
    expect(all.map((m) => m.body)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    const older = storage.getMessages(ch.id, { before: ids[3], limit: 2 });
    expect(older.map((m) => m.body)).toEqual(['m1', 'm2']);
  });

  it('updateMessage patches body/status/meta', () => {
    storage.ensureDefaultChannels();
    const ch = storage.createChannel({ name: 'chat' });
    const m = storage.saveMessage({ channelId: ch.id, authorKind: 'agent', authorId: 'a', authorName: 'A', body: '', status: 'streaming' });
    storage.updateMessage(m.id, { body: 'parcial', status: 'done', meta: { toolCalls: [{ name: 'x' }] } });
    const msgs = storage.getMessages(ch.id);
    expect(msgs[0].body).toBe('parcial');
    expect(msgs[0].status).toBe('done');
    expect(msgs[0].meta?.toolCalls).toEqual([{ name: 'x' }]);
  });

  it('threads: replies excluded from main feed, getThreadMessages returns them, replyCount set', () => {
    storage.ensureDefaultChannels();
    const ch = storage.createChannel({ name: 'thr' });
    const parent = storage.saveMessage({ channelId: ch.id, authorKind: 'user', authorId: 'u', authorName: 'U', body: 'top', status: 'done' });
    storage.saveMessage({ channelId: ch.id, authorKind: 'user', authorId: 'u', authorName: 'U', body: 'r1', status: 'done', parentId: parent.id });
    storage.saveMessage({ channelId: ch.id, authorKind: 'agent', authorId: 'a', authorName: 'A', body: 'r2', status: 'done', parentId: parent.id });
    storage.saveMessage({ channelId: ch.id, authorKind: 'user', authorId: 'u', authorName: 'U', body: 'top2', status: 'done' });

    const feed = storage.getMessages(ch.id);
    expect(feed.map((m) => m.body)).toEqual(['top', 'top2']);
    expect(feed[0].replyCount).toBe(2);
    expect(feed[1].replyCount).toBe(0);

    const thread = storage.getThreadMessages(parent.id);
    expect(thread.map((m) => m.body)).toEqual(['r1', 'r2']);
    expect(thread[0].parentId).toBe(parent.id);
  });

  it('channel agent membership add/remove', () => {
    storage.saveAgent(makeAgent('a3', 'Cida'));
    const ch = storage.createChannel({ name: 'eq' });
    storage.addChannelAgent(ch.id, 'a3');
    let view = storage.listChannels('u').find((c) => c.id === ch.id)!;
    expect(view.agents.map((a) => a.id)).toContain('a3');
    storage.removeChannelAgent(ch.id, 'a3');
    view = storage.listChannels('u').find((c) => c.id === ch.id)!;
    expect(view.agents).toHaveLength(0);
  });
});
