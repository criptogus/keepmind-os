import { it, expect, vi } from 'vitest';
import { run } from '../src/runner/zaos-runner.mjs';
import { createMockPaperclip } from './fixtures/mock-paperclip.mjs';
const env = { ZAOS_REVIEWER_USER_ID: 'operator-user', PAPERCLIP_API_URL: 'http://127.0.0.1:12345', PAPERCLIP_API_KEY: 'agent-secret', PAPERCLIP_RUN_ID: 'r', PAPERCLIP_AGENT_ID: 'a', PAPERCLIP_COMPANY_ID: 'c', ZAOS_PROVIDER_BASE_URL: 'http://127.0.0.1:12346/v1', ZAOS_PROVIDER_API_KEY: 'provider-secret', ZAOS_PROVIDER_MODEL: 'mock', ZAOS_PRICE_INPUT_CENTS_PER_MTOK: '100', ZAOS_PRICE_OUTPUT_CENTS_PER_MTOK: '200', ZAOS_MAX_OUTPUT_TOKENS: '100', ZAOS_MAX_RUN_CENTS: '1' };
function setup() {
    const mock = createMockPaperclip();
    let calls = 0;
    const fetcher = async (url, init) => {
        if (String(url).includes('12346')) {
            calls++;
            return Response.json({ choices: [{ message: { content: 'Result' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
        }
        return mock.fetch(url, init);
    };
    return { mock, fetcher, calls: () => calls };
}
it.each([{ ZAOS_PRICE_INPUT_CENTS_PER_MTOK: undefined }, { ZAOS_MAX_RUN_CENTS: '0.000001' }, { ZAOS_PRICE_OUTPUT_CENTS_PER_MTOK: 'NaN' }])('refuses unsafe pricing %j', async (override) => {
    const s = setup();
    expect((await run({ ...env, ...override }, s.fetcher, vi.fn())).ok).toBe(false);
    expect(s.calls()).toBe(0);
    expect(s.mock.state.comments[0].body).toContain('refused');
});
it.each([0, -1, 0.001])('refuses insufficient budget %s', async (budget) => {
    const s = setup();
    s.mock.state.agent.budgetMonthlyCents = budget;
    expect((await run(env, s.fetcher, vi.fn())).ok).toBe(false);
    expect(s.calls()).toBe(0);
});
it('records price idempotently, comments and leaves human review', async () => {
    const s = setup(), log = vi.fn();
    s.mock.state.runs.push({ id: 'r', issueId: 'i', status: 'running' });
    expect((await run(env, s.fetcher, log)).ok).toBe(true);
    expect(s.calls()).toBe(1);
    expect(s.mock.state.runs[0].status).toBe('cancelled');
    expect(s.mock.state.comments.at(-1).createdByRunId).toBe('r');
    expect(s.mock.state.events[0]).toMatchObject({ heartbeatRunId: 'r', idempotencyKey: 'zaos:r', costStatus: 'reported', costCents: '0.014' });
    expect(s.mock.state.comments.at(-1).body).toBe('Result');
    expect(s.mock.state.issue).toMatchObject({ status: 'in_review', assigneeUserId: 'operator-user' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
});
it('redacts thrown errors containing keys', async () => {
    const s = setup(), log = vi.fn();
    const fetcher = (url, init) => String(url).includes('12346') ? Promise.reject(new Error(env.ZAOS_PROVIDER_API_KEY)) : s.mock.fetch(url, init);
    expect((await run(env, fetcher, log)).ok).toBe(false);
    expect(JSON.stringify([log.mock.calls, s.mock.state.comments])).not.toContain('provider-secret');
});
it('missing usage leaves cost unknown and never marks review', async () => {
    const s = setup();
    const fetcher = (url, init) => String(url).includes('12346') ? Promise.resolve(Response.json({ choices: [] })) : s.mock.fetch(url, init);
    await run(env, fetcher, vi.fn());
    expect(s.mock.state.events).toEqual([]);
    expect(s.mock.state.issue.status).toBe('todo');
});
it('does not pick tasks already awaiting human review', async () => {
    const s = setup();
    s.mock.state.issue.status = 'in_review';
    expect((await run(env, s.fetcher, vi.fn())).ok).toBe(false);
    expect(s.calls()).toBe(0);
});
it.each(['checkout', 'comment', 'review', 'release'])('reports sanitized Paperclip errors at %s', async step => {
    const s = setup(), stderr = vi.fn(), stdout = vi.fn();
    const fetcher = (url, init) => {
        const path = new URL(url).pathname;
        const fail = step === 'checkout' ? path.endsWith('/checkout') : step === 'comment' ? path.endsWith('/comments') : step === 'release' ? path.endsWith('/release') : init.method === 'PATCH';
        if (fail) return Promise.resolve(Response.json({ code: `denied ${env.PAPERCLIP_API_KEY}`, message: `${env.ZAOS_PROVIDER_API_KEY} ${env.PAPERCLIP_API_KEY} ${'x'.repeat(400)}`, unrelated: 'private-body' }, { status: 403 }));
        return s.fetcher(url, init);
    };
    expect((await run(env, fetcher, stdout, stderr)).ok).toBe(false);
    const errors = stderr.mock.calls.map(([line]) => JSON.parse(line).zaosError);
    expect(errors[0]).toMatchObject({ step, status: 403, code: 'denied [redacted]' });
    expect(errors[0].message.length).toBeLessThanOrEqual(300);
    const output = JSON.stringify([stderr.mock.calls, stdout.mock.calls, s.mock.state.comments]);
    for (const secret of [env.PAPERCLIP_API_KEY, env.ZAOS_PROVIDER_API_KEY, 'private-body']) expect(output).not.toContain(secret);
    if (step === 'checkout') {
        expect(s.calls()).toBe(0);
        expect(s.mock.state.comments[0].body).toContain('ZAOS refused');
    }
});
it('checks out with the schema and releases after review with run context', async () => {
    const s = setup();
    const fetcher = (url, init) => {
        expect(init.headers['X-Paperclip-Run-Id'] ?? init.headers.Authorization).toBeTruthy();
        if (!String(url).includes('12346')) expect(init.headers['X-Paperclip-Run-Id']).toBe(env.PAPERCLIP_RUN_ID);
        return s.fetcher(url, init);
    };
    expect((await run(env, fetcher, vi.fn(), vi.fn())).ok).toBe(true);
    const mutations = s.mock.state.requests.filter(r => r.method !== 'GET');
    expect(mutations.map(r => r.path)).toEqual(['/api/issues/i/checkout', '/api/companies/c/cost-events', '/api/issues/i/comments', '/api/issues/i', '/api/issues/i/release']);
    expect(mutations[0].body).toEqual({ agentId: 'a', expectedStatuses: ['todo', 'in_progress'] });
});
it('never reads provider error bodies into diagnostics', async () => {
    const s = setup(), stderr = vi.fn();
    await run(env, (url, init) => String(url).includes('12346') ? Promise.resolve(Response.json({ code: 'provider-body', message: env.ZAOS_PROVIDER_API_KEY }, { status: 500 })) : s.fetcher(url, init), vi.fn(), stderr);
    expect(JSON.parse(stderr.mock.calls[0][0]).zaosError).toMatchObject({ step: 'provider', code: null, message: null });
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('provider-body');
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(env.ZAOS_PROVIDER_API_KEY);
});
it('does not expose non-JSON Paperclip bodies or transport error messages', async () => {
    for (const response of [() => Promise.resolve(new Response(`${env.PAPERCLIP_API_KEY} ${env.ZAOS_PROVIDER_API_KEY}`, { status: 502 })), () => Promise.reject(new Error(`${env.PAPERCLIP_API_KEY} ${env.ZAOS_PROVIDER_API_KEY}`))]) {
        const stderr = vi.fn();
        expect((await run(env, response, vi.fn(), stderr)).ok).toBe(false);
        expect(stderr).toHaveBeenCalledTimes(1);
        const error = JSON.parse(stderr.mock.calls[0][0]).zaosError;
        expect(error).toMatchObject({ code: null, message: null });
        for (const key of [env.PAPERCLIP_API_KEY, env.ZAOS_PROVIDER_API_KEY]) expect(JSON.stringify(stderr.mock.calls)).not.toContain(key);
    }
});

it.each([undefined, '', '   '])('refuses a missing reviewer before provider execution (%j)', async reviewer => {
    const s = setup();
    const result = await run({ ...env, ZAOS_REVIEWER_USER_ID: reviewer }, s.fetcher, vi.fn());
    expect(result).toEqual({ ok: false, reason: 'Human reviewer user ID is required' });
    expect(s.calls()).toBe(0);
    expect(s.mock.state.events).toEqual([]);
    expect(s.mock.state.requests.some(r => r.method === 'PATCH')).toBe(false);
    expect(s.mock.state.requests.at(-1).path).toBe('/api/issues/i/release');
});
it('fake Paperclip rejects review without a human assignee', async () => {
    const mock = createMockPaperclip();
    const response = await mock.fetch(`${env.PAPERCLIP_API_URL}/api/issues/i`, { method: 'PATCH', body: JSON.stringify({ status: 'in_review' }) });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'invalid_issue_disposition' });
    expect(mock.state.issue.status).toBe('todo');
});
