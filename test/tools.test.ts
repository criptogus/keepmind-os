import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/main/tools/registry.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'km-tools-'));
  return dir;
}

describe('ToolRegistry new tools', () => {
  it('file_write + file_read + file_list round-trip inside workspace', async () => {
    const ws = await makeWorkspace();
    const reg = new ToolRegistry();
    reg.setContext({ workspaceDir: ws });

    await reg.execute('file_write', { path: 'sub/hello.txt', content: 'hi there' });
    const content = await reg.execute('file_read', { path: 'sub/hello.txt' });
    expect(content).toBe('hi there');
    const list = await reg.execute('file_list', { path: 'sub' });
    expect(list).toContain('hello.txt');
  });

  it('rejects path traversal outside workspace', async () => {
    const ws = await makeWorkspace();
    const reg = new ToolRegistry();
    reg.setContext({ workspaceDir: ws });
    await expect(reg.execute('file_read', { path: '../etc/passwd' })).rejects.toThrow(/escapes/);
    await expect(reg.execute('file_write', { path: '../../evil.txt', content: 'x' })).rejects.toThrow(/escapes/);
  });

  it('shell_exec runs a command', async () => {
    const reg = new ToolRegistry();
    reg.setContext({
      shellExec: async (cmd) => `ran: ${cmd}`,
    });
    const out = await reg.execute('shell_exec', { command: 'echo hi' });
    expect(out).toBe('ran: echo hi');
  });

  it('shell_exec errors when no context', async () => {
    const reg = new ToolRegistry();
    await expect(reg.execute('shell_exec', { command: 'ls' })).rejects.toThrow(/not available/);
  });

  it('open_url validates http(s)', async () => {
    const reg = new ToolRegistry();
    const opened: string[] = [];
    reg.setContext({ openUrl: async (u) => { opened.push(u); } });
    await reg.execute('open_url', { url: 'https://example.com' });
    expect(opened).toEqual(['https://example.com']);
    await expect(reg.execute('open_url', { url: 'file:///etc/passwd' })).rejects.toThrow(/http/);
  });

  it('delegate_to_agent requires context', async () => {
    const reg = new ToolRegistry();
    await expect(reg.execute('delegate_to_agent', { agent: 'x', task: 'y' })).rejects.toThrow(/not available/);
  });

  it('whatsapp_read_messages returns buffered messages (read-only)', async () => {
    const reg = new ToolRegistry();
    const msgs = [
      { from: '5511999999999', text: 'oi', timestamp: 1700000000000 },
      { from: '5511888888888', text: 'tudo bem?', timestamp: 1700000001000 },
    ];
    reg.setContext({ getWhatsAppMessages: (limit = 20) => msgs.slice(-limit) });
    const out = await reg.execute('whatsapp_read_messages', { limit: 10 });
    expect(out).toContain('5511999999999: oi');
    expect(out).toContain('5511888888888: tudo bem?');
    // respects limit
    const out1 = await reg.execute('whatsapp_read_messages', { limit: 1 });
    expect(out1).toContain('tudo bem?');
    expect(out1).not.toContain('oi');
  });

  it('whatsapp_read_messages returns empty-state text and errors without context', async () => {
    const reg = new ToolRegistry();
    reg.setContext({ getWhatsAppMessages: () => [] });
    expect(await reg.execute('whatsapp_read_messages', {})).toBe('No recent WhatsApp messages');
    const reg2 = new ToolRegistry();
    await expect(reg2.execute('whatsapp_read_messages', {})).rejects.toThrow(/not connected/);
  });

  it('web_read_url validates URL and returns page text', async () => {
    const reg = new ToolRegistry();
    const seen: string[] = [];
    reg.setContext({ webReadUrl: async (u) => { seen.push(u); return 'page content'; } });
    const out = await reg.execute('web_read_url', { url: 'https://example.com/a' });
    expect(out).toBe('page content');
    expect(seen).toEqual(['https://example.com/a']);
    await expect(reg.execute('web_read_url', { url: 'file:///etc/passwd' })).rejects.toThrow(/http/);
    const reg2 = new ToolRegistry();
    await expect(reg2.execute('web_read_url', { url: 'https://x.com' })).rejects.toThrow(/not available/);
  });

  it('agent_reach_status reports channels or missing install', async () => {
    const reg = new ToolRegistry();
    reg.setContext({
      agentReachStatus: async () => ({
        installed: true,
        channels: [
          { name: 'youtube', status: 'ok', backend: 'yt-dlp' },
          { name: 'reddit', status: 'error', backend: null },
        ],
      }),
    });
    const out = await reg.execute('agent_reach_status', {});
    expect(out).toContain('youtube: ok (yt-dlp)');
    expect(out).toContain('reddit: error');

    const reg2 = new ToolRegistry();
    reg2.setContext({ agentReachStatus: async () => ({ installed: false, channels: [] }) });
    expect(await reg2.execute('agent_reach_status', {})).toContain('not installed');
  });

  it('lists new tool names', () => {
    const reg = new ToolRegistry();
    const names = reg.list().map((t) => t.name);
    for (const n of ['delegate_to_agent', 'file_read', 'file_write', 'file_list', 'shell_exec', 'open_url', 'whatsapp_read_messages', 'web_read_url', 'agent_reach_status']) {
      expect(names).toContain(n);
    }
  });

  it('gate blocks execution and returns the denial message', async () => {
    const reg = new ToolRegistry();
    let handlerRan = false;
    reg.register({
      name: 'test_tool',
      description: 'test',
      parameters: {},
      handler: async () => { handlerRan = true; return 'ok'; },
    });
    reg.setGate(async (name) => (name === 'test_tool' ? 'denied by governance' : null));
    const out = await reg.execute('test_tool', {});
    expect(out).toBe('denied by governance');
    expect(handlerRan).toBe(false);
  });

  it('gate allows execution when it returns null', async () => {
    const reg = new ToolRegistry();
    reg.setGate(async () => null);
    const out = await reg.execute('get_current_time', {});
    expect(out).toContain('T'); // ISO timestamp
  });
});
