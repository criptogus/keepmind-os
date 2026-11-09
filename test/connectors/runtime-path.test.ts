import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
const canSpawn = !spawnSync(process.execPath, ['-e', '']).error;
import type { spawn } from 'node:child_process';
// @ts-expect-error plain ESM
import { executeCli } from '../../src/runner/cli.mjs';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each(['bundled', 'override'])('detects and runs env-node CLIs with no system Node on PATH (%s)', async mode => {
    vi.resetModules();
    const dir = await mkdtemp(join(tmpdir(), 'zaos-runtime-'));
    try {
        await mkdir(join(dir, 'node/bin'), { recursive: true });
        const binary = join(dir, 'node/bin/node');
        await symlink(process.execPath, binary);
        vi.stubEnv('PATH', '/no-system-node');
        vi.stubEnv('ZAOS_CODEX_BIN', resolve('test/fixtures/fake-codex.mjs'));
        vi.stubEnv('ZAOS_NODE_BINARY', mode === 'override' ? binary : '');
        const runtime = await import('../../src/main/node-runtime');
        const first = runtime.initializeNodeRuntime({ packaged: true, resourcesPath: dir });
        expect(runtime.initializeNodeRuntime({})).toBe(first);
        const cli = await import('../../src/main/connectors/cli');
        // Detection awaits the same pending startup resolution.
        expect(await cli.detectCli('codex')).toMatchObject({ installed: true, loggedIn: true });
        expect((await first).nodeDir).toBe(dirname(binary));
        const loginSpawn = vi.fn(() => {
            const child = new EventEmitter();
            queueMicrotask(() => child.emit('spawn'));
            return child;
        });
        await cli.startCliLogin('codex', loginSpawn as unknown as typeof spawn);
        expect(loginSpawn.mock.calls[0]).toEqual([
            resolve('test/fixtures/fake-codex.mjs'), ['login'],
            expect.objectContaining({ shell: false, env: expect.objectContaining({ PATH: dirname(binary) + ':/no-system-node' }) }),
        ]);
        if (canSpawn) expect(await executeCli('codex', resolve('test/fixtures/fake-codex.mjs'), '', 'hello', 30,
            { PATH: '/no-system-node', ZAOS_NODE_RUNTIME_DIR: dirname(binary) })).toMatchObject({ result: 'Fake Codex result' });
    } finally { await rm(dir, { recursive: true, force: true }); }
});

it('keeps detection available and its environment unchanged after Node resolution fails', async () => {
    vi.resetModules();
    vi.stubEnv('ZAOS_NODE_BINARY', '/missing/runtime/node');
    vi.stubEnv('ZAOS_CODEX_BIN', process.execPath);
    const runtime = await import('../../src/main/node-runtime');
    await expect(runtime.initializeNodeRuntime({})).rejects.toThrow();
    expect(await runtime.cliEnvironment()).toBe(process.env);
    const { detectCli } = await import('../../src/main/connectors/cli');
    const spawnProcess = vi.fn(() => {
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
        queueMicrotask(() => child.emit('close', 0));
        return child;
    });
    expect(await detectCli('codex', spawnProcess as unknown as typeof spawn)).toMatchObject({ loggedIn: true });
    expect(spawnProcess.mock.calls[0]).toEqual([process.execPath, ['login', 'status'], expect.objectContaining({ env: process.env, shell: false })]);
});

it.each(['codex', 'claude'])('prepends runtime PATH for %s task execution while stripping secrets', async id => {
    const spawnProcess = vi.fn(() => {
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
        child.stdin.on('finish', () => {
            child.stdout.write(JSON.stringify(id === 'codex' ? { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } } : { result: 'ok' }));
            child.emit('close', 0);
        });
        return child;
    });
    await executeCli(id, '/vendor/cli', '', 'hello', 30, { PATH: '/no-node', HOME: '/home/test', ZAOS_NODE_RUNTIME_DIR: '/bundled/bin', OPENAI_API_KEY: 'private' }, spawnProcess);
    expect(spawnProcess.mock.calls[0]).toEqual(['/vendor/cli', expect.any(Array), expect.objectContaining({ shell: false, env: { PATH: '/bundled/bin:/no-node', HOME: '/home/test' } })]);
});
