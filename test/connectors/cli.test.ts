import { it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
// @ts-expect-error plain ESM
import { executeCli } from '../../src/runner/cli.mjs';
function fake() {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
    const spawn = vi.fn(() => child);
    return { child, spawn };
}
it.each(['codex','claude'])('uses safe argv, clean cwd and env for %s', async id => {
    const { child, spawn } = fake();
    child.stdin.on('finish', () => {
        child.stdout.write(id === 'codex' ? JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'safe' } }) : JSON.stringify({ result: 'safe' }));
        child.emit('close', 0);
    });
    expect(await executeCli(id, '/trusted/cli', 'model', 'prompt', 30, { PATH: '/bin', ZAOS_PROVIDER_API_KEY: 'secret', ANTHROPIC_API_KEY: 'secret' }, spawn)).toMatchObject({ result: 'safe', inputTokens: 0 });
    const [, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { shell: boolean; cwd: string; env: unknown }];
    expect(args.join(' ')).not.toMatch(/dangerously|danger-full-access|--bare/);
    expect(options.shell).toBe(false); expect(options.env).toEqual({ PATH: '/bin' });
    await expect(readFile(`${options.cwd}/anything`)).rejects.toThrow();
});
it('terminates a hung CLI and escalates to SIGKILL', async () => {
    const { child, spawn } = fake();
    let started!: () => void;
    const ready = new Promise<void>(r => { started = r; });
    spawn.mockImplementation(() => { started(); return child; });
    vi.useFakeTimers();
    const promise = executeCli('codex', '/trusted/cli', '', 'prompt', 30, {}, spawn);
    const rejected = expect(promise).rejects.toThrow('CLI execution failed');
    await ready;
    await vi.advanceTimersByTimeAsync(30000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null);
    await rejected;
    vi.useRealTimers();
});

it('caps captured stdout at one megabyte', async () => {
    const { child, spawn } = fake();
    child.stdin.on('finish', () => { child.stdout.write(Buffer.alloc(1024 * 1024 + 1)); child.emit('close', 0); });
    await expect(executeCli('codex', '/trusted/cli', '', 'prompt', 30, {}, spawn)).rejects.toThrow('CLI execution failed');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
});

it.each([0,1])('reduces CLI status to bounded enums (exit %s)', async code => {
    const { detectCli } = await import('../../src/main/connectors/cli');
    const old = process.env.ZAOS_CLAUDE_BIN;
    process.env.ZAOS_CLAUDE_BIN = process.execPath;
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
    const spawn = vi.fn(() => {
        queueMicrotask(() => { child.stdout.write(JSON.stringify({ authMethod: 'claude.ai', private: 'never expose' })); child.emit('close', code); });
        return child;
    });
    try {
        expect(await detectCli('claude', spawn as unknown as typeof import('node:child_process').spawn)).toEqual({ installed: true, loggedIn: code === 0, authMethod: 'subscription' });
        expect(spawn.mock.calls).toHaveLength(1);
    } finally { if (old === undefined) delete process.env.ZAOS_CLAUDE_BIN; else process.env.ZAOS_CLAUDE_BIN = old; }
});
