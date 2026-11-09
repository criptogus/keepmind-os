import { it, expect } from 'vitest';
import { startMockProvider } from './fixtures/mock-provider.mjs';
import { startMockPaperclip } from './fixtures/mock-paperclip.mjs';
import { Supervisor } from '../src/main/supervisor';
import { pickPort } from '../src/main/ports';
import { resolve } from 'node:path';
// Explicit opt-in on hosts permitting sockets: ZAOS_SOCKET_TESTS=1 npm test.
const socketIt = process.env.ZAOS_SOCKET_TESTS === '1' ? it : it.skip;
socketIt('mock HTTP fixtures bind loopback and count provider calls', async () => {
    const p = await startMockProvider();
    let pc;
    try {
        pc = await startMockPaperclip();
        const res = await fetch(`http://127.0.0.1:${p.port}/v1/chat/completions`, { method: 'POST', body: '{}' });
        expect((await res.json()).usage.prompt_tokens).toBe(100);
        expect(await (await fetch(`http://127.0.0.1:${p.port}/__calls`)).json()).toEqual({ calls: 1 });
        expect((await (await fetch(`http://127.0.0.1:${pc.port}/api/agents/me`)).json()).id).toBe('a');
    }
    finally {
        await p.close();
        await pc?.close();
    }
});
socketIt('supervises real fake-server child over loopback and kills it', async () => {
    const s = new Supervisor({ node: process.execPath, entry: resolve('test/fixtures/fake-server.mjs'), dataDir: '/tmp', port: await pickPort(), secrets: {}, bootTimeoutMs: 5000, graceMs: 1000 });
    try {
        await s.start();
        expect(s.state).toBe('ready');
    }
    finally {
        await s.stop();
    }
    expect(s.state).toBe('stopped');
}, 15000);
