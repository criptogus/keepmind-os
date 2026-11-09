import { it, expect, vi } from 'vitest';
import { mkdtemp, stat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { instanceSecrets } from '../src/main/instance-secrets';
import { authenticateOperator } from '../src/main/operator-auth';
import { PaperclipClient } from '../src/main/paperclip-client';
import { pickPorts, pickPort } from '../src/main/ports';
import { resolveNode } from '../src/main/node-runtime';
import { writeConfig, createConfig } from '../src/main/paperclip-config';
import { SpendGuard, assertPaidRequirements } from '../src/main/spend-guard';
const enc = { encrypt: (s: string) => Buffer.from(s).toString('base64'), decrypt: (s: string) => Buffer.from(s, 'base64').toString() };
it('persists encrypted random instance secrets with restrictive mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zaos-unit-'));
    try {
        const a = await instanceSecrets(dir, enc);
        expect(await instanceSecrets(dir, enc)).toEqual(a);
        expect(new Set(Object.values(a)).size).toBe(3);
        expect((await stat(join(dir, 'zaos/instance-secrets.json'))).mode & 0o777).toBe(0o600);
        expect(await readFile(join(dir, 'zaos/instance-secrets.json'), 'utf8')).not.toContain(a.BETTER_AUTH_SECRET);
        await writeConfig(dir, createConfig(dir, 40001, 40002));
        expect(JSON.parse(await readFile(join(dir, 'instances/default/config.json'), 'utf8')).auth.disableSignUp).toBe(false);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
it('bootstraps once then signs in and disables signup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zaos-auth-'));
    try {
        const request = vi.fn().mockResolvedValue({}), disable = vi.fn();
        await authenticateOperator({ request }, dir, enc, disable);
        await authenticateOperator({ request }, dir, enc, disable);
        expect(request.mock.calls.map(c => c[1])).toEqual(['/api/auth/sign-up/email', '/api/bootstrap/claim', '/api/auth/sign-in/email']);
        expect(disable).toHaveBeenCalledTimes(2);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
it('selects available nonexcluded distinct ports', async () => {
    const values = [3000, 3100, 8642, 8787, 8794, 40000, 40000, 40001];
    expect(await pickPorts(async () => values.shift()!)).toEqual({ server: 40000, postgres: 40001 });
    await expect(pickPort(async () => 3000)).rejects.toThrow();
});
it('resolves explicit node binary and verifies version', async () => {
    const verify = vi.fn().mockResolvedValue('v24.22.1');
    expect(await resolveNode({ ZAOS_NODE_BINARY: '/node24' }, verify)).toEqual({ binary: '/node24', version: 'v24.22.1' });
    expect(verify).toHaveBeenCalledWith('/node24');
});
it('board client preserves session and Origin without leaking response errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { headers: { 'set-cookie': 'session=abc; HttpOnly' } })).mockResolvedValueOnce(Response.json({ id: 'c' })).mockResolvedValueOnce(new Response('secret', { status: 403 }));
    const client = new PaperclipClient('http://127.0.0.1:40000', fetcher);
    await client.request('POST', '/api/auth/sign-in/email', {});
    await client.request('GET', '/api/companies');
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ Origin: 'http://127.0.0.1:40000', Cookie: 'session=abc' });
    await expect(client.request('GET', '/api/companies')).rejects.toThrow('403');
    expect(() => new PaperclipClient('https://example.com')).toThrow();
});
it('applies nonzero hard-stop cap and requires consent', async () => {
    const request = vi.fn().mockResolvedValue({});
    const guard = new SpendGuard({ request }, 'c');
    await guard.applyAgentCap('a', 100, 1);
    expect(request.mock.calls[1][2]).toMatchObject({ amount: 100, hardStopEnabled: true, unpricedUsagePolicy: 'block', reservationCents: 1 });
    expect(() => assertPaidRequirements(undefined, false, 100, false)).toThrow();
});
it('adjusts only same-run unpriced process receipt with acknowledged ZAOS price', async () => {
    const receipt = { zaosReceipt: { eventId: 'priced', runId: 'r', idempotencyKey: 'zaos:r', costCents: 0.1, costStatus: 'reported' } };
    const request = vi.fn().mockImplementation(async (_method, path) => path.endsWith('/budgets/overview') ? { policies: [{scopeType: 'agent', scopeId: 'a', unpricedEventCount: 0}] } : path.endsWith('/log') ? { content: JSON.stringify({ stream: 'stdout', chunk: JSON.stringify(receipt) + '\n' }) } : { events: [{ id: 'u', runId: 'r', agentId: 'a', reason: 'missing_price' }, { id: 'status', heartbeatRunId: 'r', costStatus: 'unpriced' }, { id: 'reason', runId: 'r', reason: 'missing_model' }, { id: 'info', runId: 'r', provider: 'unknown', reason: 'unknown_billing', costCents: 0 }, { id: 'other', runId: 'other', reason: 'missing_price' }] });
    expect(await new SpendGuard({ request }, 'c').reconcileRun('r')).toBe('reconciled');
    expect(request.mock.calls.filter(c => c[0] === 'POST').map(c => c[1])).toEqual([
        '/api/companies/c/accounting/events/u/adjustments',
        '/api/companies/c/accounting/events/reason/adjustments',
        '/api/companies/c/accounting/events/info/adjustments'
    ]);
});
it.each([{ amount: 0, isActive: true }, { amount: 100, isActive: false }])('startup audit pauses invalid policy %j', async (policy) => {
    const request = vi.fn().mockResolvedValue({ policies: [{ scopeId: 'a', ...policy }] });
    expect(await new SpendGuard({ request }, 'c').startupAudit(['a'])).toEqual(['a']);
    expect(request.mock.calls[1][1]).toBe('/api/agents/a/pause');
});
it('refuses corrupt encrypted secrets instead of silently regenerating', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zaos-corrupt-'));
    try {
        await instanceSecrets(dir, enc);
        await expect(instanceSecrets(dir, { encrypt: enc.encrypt, decrypt: () => {
                throw new Error('key detail');
            } })).rejects.toThrow('Cannot decrypt');
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
it('reassembles fragmented receipt chunks and rejects foreign or invalid acknowledgements',async()=>{
 const {readZaosReceipt}=await import('../src/main/spend-guard');
 const receipt=JSON.stringify({zaosReceipt:{eventId:'priced',runId:'r',idempotencyKey:'zaos:r',costCents:0.1,costStatus:'reported'}})+'\n';
 const content=[receipt.slice(0,20),receipt.slice(20)].map(chunk=>JSON.stringify({stream:'stdout',chunk})).join('\n');
 expect(readZaosReceipt(content,'r')?.costCents).toBe(0.1);
 expect(readZaosReceipt(content,'other')).toBeUndefined();
 expect(readZaosReceipt(JSON.stringify({stream:'stderr',chunk:receipt}),'r')).toBeUndefined();
 expect(readZaosReceipt(content.replace('0.1','null'),'r')).toBeUndefined();
});

it.each([0, 1, undefined])('verifies policy after idempotent reconciliation retry: %s', async unpricedEventCount => {
    const receipt = { zaosReceipt: { eventId: 'priced', runId: 'r', idempotencyKey: 'zaos:r', costCents: 0.1, costStatus: 'reported' } };
    const request = vi.fn().mockImplementation(async (method, path) => {
        if (path.endsWith('/log')) return { content: JSON.stringify({ stream: 'stdout', chunk: JSON.stringify(receipt) + '\n' }) };
        if (path.endsWith('/costs/data-quality')) return { events: [{id: 'u', runId: 'r', agentId: 'a', provider: 'unknown', reason: 'unknown_billing'}] };
        if (method === 'POST') throw new Error('Paperclip request failed (409)');
        return {policies: unpricedEventCount === undefined ? [] : [{scopeType: 'agent', scopeId: 'a', unpricedEventCount}]};
    });
    const guard = new SpendGuard({ request }, 'c');
    for (let i = 0; i < 2; i++) expect(await guard.reconcileRun('r')).toBe(unpricedEventCount === 0 ? 'reconciled' : 'unknown cost');
    const adjustments = request.mock.calls.filter(c => c[0] === 'POST');
    expect(adjustments).toHaveLength(2);
    expect(adjustments.map(c => c[2].idempotencyKey)).toEqual(['zaos:reconcile:r:u', 'zaos:reconcile:r:u']);
});
