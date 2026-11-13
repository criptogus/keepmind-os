import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FixtureKeepMindTransport, KeepMindService, KeepMindDeniedError, KeepMindUnavailableError, StdioKeepMindTransport } from '../../src/main/keepmind';
import type { KeepMindTransport } from '../../src/main/keepmind';
import { CompanyBrains } from '../../src/main/keepmind/CompanyBrains';
const roots: string[] = [];
const services: KeepMindService[] = [];
afterEach(() => { services.forEach(s => s.dispose()); services.length = 0; roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function setup(transport?: KeepMindTransport) {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'km-isolation-')); roots.push(root);
    cpSync(resolve('test/fixtures/keepmind'), root, { recursive: true });
    const service = new KeepMindService({ dataRoot: root, companyId: 'acme', transportFactory: context => transport ?? new FixtureKeepMindTransport(context.vault, context.companyId) });
    services.push(service);
    return { root, service };
}
const forbidden = /ACME_SECRET_TOKEN_9c1b|BETA_INTERNAL_TOKEN_2e8d|PERSONAL_TOKEN_4b0c/;
it('returns ACME internal only through search/read/list/recent', async () => {
    const { service } = setup();
    const hits = await service.search('TOKEN');
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('ACME_INTERNAL_TOKEN_7f3a');
    for (const output of [hits, await service.list(), await service.recent(), await service.read('notes/acme-plan.md')]) expect(JSON.stringify(output)).not.toMatch(forbidden);
    await expect(service.read('notes/acme-secret.md')).rejects.toBeInstanceOf(KeepMindDeniedError);
});
it('reports 0 leaks across 30 synthetic hostile handoffs with denied audits', async () => {
    const { root, service } = setup();
    const attacks: [string, Record<string, unknown>][] = [
        ['sb_read', { path: '../beta/memory/notes/beta-plan.md' }],
        ['sb_read', { path: '../../../personal/memory/notes/personal.md' }],
        ['sb_read', { path: join(root, 'companies/beta/memory/notes/beta-plan.md') }],
        ['sb_read', { path: 'notes/acme-secret.md' }],
        ['sb_search', { query: 'TOKEN', companyId: 'beta' }],
        ['sb_search', { query: 'TOKEN', clientId: 'zaos-beta' }],
        ['sb_search', { query: 'TOKEN', space: 'personal' }],
        ['sb_read', { path: 'notes/acme-plan.md', vault: root }],
        ['sb_write', { path: 'notes/acme-plan.md', content: 'evil' }],
        ['learning_search', { query: 'TOKEN' }]
    ];
    let handoffs = 0, leaks = 0, denials = 0;
    for (let cycle = 0; cycle < 3; cycle++) for (const [tool, args] of attacks) {
        handoffs++;
        try { const result = await service.call(tool, args); if (forbidden.test(JSON.stringify(result))) leaks++; }
        catch (error) { expect(error).toBeInstanceOf(KeepMindDeniedError); denials++; }
    }
    expect(handoffs, 'synthetic handoff count: 30').toBe(30);
    expect(leaks, '30 synthetic handoffs; leak count: 0').toBe(0);
    expect(denials, '30 synthetic handoffs; denied count: 30').toBe(30);
    const audit = readFileSync(join(root, 'keepmind/audit.jsonl'), 'utf8');
    expect(audit).not.toMatch(/TOKEN|notes\/|evil|beta|personal/);
    const lines = audit.trim().split('\n').map(line => JSON.parse(line));
    expect(lines.filter(line => !line.allowed)).toHaveLength(30);
    expect(lines.every(line => line.companyId === 'acme' && line.clientId === 'zaos-acme')).toBe(true);
});
it('filters wrong-space, secret, missing and elevated metadata even in a misconfigured vault', async () => {
    const { root, service } = setup();
    const vault = join(root, 'companies/acme/memory');
    cpSync(join(root, 'companies/beta/memory/notes/beta-plan.md'), join(vault, 'notes/beta.md'));
    cpSync(join(root, 'personal/memory/notes/personal.md'), join(vault, 'notes/personal.md'));
    writeFileSync(join(vault, 'notes/missing.md'), 'ACME_SECRET_TOKEN_9c1b');
    writeFileSync(join(vault, 'notes/elevated.md'), '---\nspace: company-acme\nclass: internal\nclass_override: secret\n---\nACME_SECRET_TOKEN_9c1b');
    for (const path of ['beta', 'personal', 'missing', 'elevated']) await expect(service.read(`notes/${path}.md`)).rejects.toBeInstanceOf(KeepMindDeniedError);
    expect(JSON.stringify(await service.search('TOKEN'))).not.toMatch(forbidden);
});
it('rejects a symlink escape without returning outside content', async () => {
    const { root, service } = setup();
    symlinkSync(join(root, 'companies/beta/memory/notes/beta-plan.md'), join(root, 'companies/acme/memory/notes/link.md'));
    await expect(service.read('notes/link.md')).rejects.toBeInstanceOf(KeepMindDeniedError);
});
it('distrusts transport snippets and metadata and filters each candidate by read', async () => {
    const content: Record<string, string> = {
        'notes/good.md': '---\nspace: company-acme\nclass: internal\n---\nACME_INTERNAL_TOKEN_7f3a',
        'notes/bad.md': '---\nspace: company-beta\nclass: internal\n---\nBETA_INTERNAL_TOKEN_2e8d'
    };
    const { service } = setup({ health: async () => true, dispose() {}, call: async (tool, args) => tool === 'sb_read' ? content[String(args.path)] : { hits: [{ path: 'notes/good.md', snippet: 'ACME_SECRET_TOKEN_9c1b' }, { path: 'notes/bad.md', class: 'internal', space: 'company-acme' }, { path: '../beta/bait.md' }] } });
    const hits = await service.search('TOKEN');
    expect(hits).toHaveLength(1);
    expect(JSON.stringify(hits)).not.toMatch(forbidden);
});
it('sanitizes unavailable transport failures', async () => {
    const { service } = setup({ health: async () => false, call: vi.fn(), dispose() {} });
    await expect(service.health()).rejects.toBeInstanceOf(KeepMindUnavailableError);
    await expect(service.search('plan')).rejects.toThrow('KeepMind unavailable');
});
it.each([false, 'throws'])('blocks required company context before provider calls: %s', async mode => {
    const { service } = setup({ health: async () => { if (mode === 'throws') throw new Error('SECRET'); return false; }, call: vi.fn(), dispose() {} });
    const settings = { getSetting: () => JSON.stringify([{ agentId: 'a', companyId: 'acme', dataRoot: '/tmp', node: '/node', entry: '/entry' }]), setSetting: vi.fn() };
    const brains = new CompanyBrains(settings, () => service);
    const provider = vi.fn();
    await expect((async () => { await brains.health('a'); provider(); })()).rejects.toThrow('company memory connection is unavailable');
    expect(provider).not.toHaveBeenCalled();
    expect(brains.binding('another-agent')).toBeUndefined();
});
it('speaks stdio JSON-RPC and clears pending calls when the child is unavailable', async () => {
    const { root } = setup();
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), killed: false, kill() { this.killed = true; return true; }, stdin: new Writable({ write(chunk, _encoding, done) {
        const message = JSON.parse(String(chunk));
        if (message.id !== undefined) {
            const result = message.method === 'tools/call' ? { content: [{ type: 'text', text: '(empty)' }] } : {};
            queueMicrotask(() => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n'));
        }
        done();
    } }) });
    const spawnProcess = vi.fn(() => child) as unknown as typeof spawn;
    const service = new KeepMindService({ dataRoot: root, companyId: 'acme', transportFactory: context => new StdioKeepMindTransport({ ...context, entry: '/fixture/mcp.mjs', node: process.execPath, timeoutMs: 1000 }, spawnProcess) }); services.push(service);
    await expect(service.health()).resolves.toBe(true);
    expect(await service.list()).toEqual([]);
    const spawnArgs = vi.mocked(spawnProcess).mock.calls[0];
    expect(spawnArgs[1]).toEqual(['/fixture/mcp.mjs']);
    const env = (spawnArgs[2] as { env: NodeJS.ProcessEnv }).env;
    expect(env.KEEPMIND_MCP_CLIENT).toBe('zaos-acme');
    expect(env.KEEPMIND_MEMORY_DIR).toBe(join(root, 'companies/acme/memory'));
    expect(env.KEEPMIND_MCP_ALLOW_PLAINTEXT).toBeUndefined();
    expect(Object.keys(JSON.parse(readFileSync(env.KEEPMIND_MCP_SCOPES!, 'utf8')))).toEqual(['zaos-acme']);
    service.dispose();
    await expect(service.health()).rejects.toBeInstanceOf(KeepMindUnavailableError);
});
