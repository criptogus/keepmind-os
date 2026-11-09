import { it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { Supervisor } from '../src/main/supervisor';
function child() {
    const c = new EventEmitter() as ChildProcess;
    c.kill = vi.fn(() => {
        queueMicrotask(() => c.emit('exit', 0));
        return true;
    });
    return c;
}
it('transitions through ready and shutdown kills child', async () => {
    const c = child(), states: string[] = [];
    const spawn = vi.fn(() => c);
    const s = new Supervisor({ node: 'node', entry: 'fake', dataDir: '/tmp/x', port: 40000, secrets: {}, spawn, fetch: vi.fn().mockResolvedValue(Response.json({ status: 'ok' })), onState: v => states.push(v) });
    await s.start();
    expect(states).toEqual(['starting', 'ready']);
    expect(spawn.mock.calls[0]).toBeDefined();
    await s.stop();
    expect(c.kill).toHaveBeenCalledWith('SIGTERM');
    expect(s.state).toBe('stopped');
});
it('crashes restart with exponential backoff and maximum 3 retries', async () => {
    vi.useFakeTimers();
    try {
        const children: ChildProcess[] = [];
        const s = new Supervisor({ node: 'node', entry: 'fake', dataDir: '/tmp/x', port: 40000, secrets: {}, spawn: () => {
                const c = child();
                children.push(c);
                return c;
            }, fetch: vi.fn().mockImplementation(() => Promise.resolve(Response.json({ status: 'ok' }))), backoffMs: 100 });
        await s.start();
        for (let i = 0; i < 3; i++) {
            children.at(-1)!.emit('exit', 1);
            expect(s.state).toBe('crashed');
            await vi.advanceTimersByTimeAsync(100 * 2 ** i - 1);
            expect(children).toHaveLength(i + 1);
            await vi.advanceTimersByTimeAsync(1);
            expect(children).toHaveLength(i + 2);
        }
        children.at(-1)!.emit('exit', 1);
        await vi.advanceTimersByTimeAsync(10000);
        expect(children).toHaveLength(4);
        await s.stop();
    }
    finally {
        vi.useRealTimers();
    }
});
it('health timeout becomes unavailable and terminates child', async () => {
    const c = child();
    const s = new Supervisor({ node: 'node', entry: 'fake', dataDir: '/tmp/x', port: 40000, secrets: {}, spawn: () => c, fetch: vi.fn().mockRejectedValue(new Error('offline')), bootTimeoutMs: 5, pollMs: 1 });
    await s.start();
    expect(s.state).toBe('unavailable');
    expect(c.kill).toHaveBeenCalled();
    await s.stop();
});
it('escalates shutdown to SIGKILL after grace',async()=>{
 vi.useFakeTimers();try{
  const c=new EventEmitter() as ChildProcess;
  c.kill=vi.fn(signal=>{if(signal==='SIGKILL')queueMicrotask(()=>c.emit('exit',null,'SIGKILL'));return true;});
  const s=new Supervisor({node:'node',entry:'fake',dataDir:'/tmp/x',port:40000,secrets:{},spawn:()=>c,fetch:vi.fn().mockResolvedValue(Response.json({status:'ok'})),graceMs:50});
  await s.start();const stopping=s.stop();expect(c.kill).toHaveBeenCalledWith('SIGTERM');await vi.advanceTimersByTimeAsync(50);await stopping;expect(c.kill).toHaveBeenCalledWith('SIGKILL');expect(s.state).toBe('stopped');
 }finally{vi.useRealTimers();}
});
it('passes bundled Node PATH to Paperclip while preserving secrets and fixed env', async () => {
    const c = child();
    const spawn = vi.fn((_command: string, _args: string[], _options: import('node:child_process').SpawnOptions) => c);
    const s = new Supervisor({ node: '/r/node/bin/node', nodeDir: '/r/node/bin', entry: 'fake', dataDir: '/tmp/x', port: 40000, secrets: { TEST_SECRET: 'kept', PATH: '/secret/path' }, spawn, fetch: vi.fn().mockResolvedValue(Response.json({ status: 'ok' })) });
    try {
        await s.start();
        expect(spawn.mock.calls[0][2].env).toMatchObject({ PATH: `/r/node/bin${process.platform === 'win32' ? ';' : ':'}/secret/path`, TEST_SECRET: 'kept', HOST: '127.0.0.1', PAPERCLIP_HOME: '/tmp/x' });
    } finally { await s.stop(); }
});
