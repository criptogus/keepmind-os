import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
export function createMockPaperclip() {
    const state = { agent: { id: 'a', budgetMonthlyCents: 100, spentMonthlyCents: 0 }, issue: { id: 'i', title: 'Research', description: 'Write a brief', status: 'todo' }, comments: [], events: [], requests: [], policies: [], runs: [] };
    async function request(method, path, body) {
        state.requests.push({ method, path, body });
        if (path.endsWith('/api/health'))
            return { status: 'ok' };
        if (path === '/api/cli-auth/me')
            return { userId: 'operator-user', user: { id: 'operator-user' } };
        if (path === '/api/agents/me/inbox-lite')
            return [state.issue];
        if (path === '/api/agents/me' || path === '/api/agents/a')
            return state.agent;
        if (path === '/api/issues/i' && method === 'GET')
            return state.issue;
        if (path.endsWith('/checkout') || path.endsWith('/release')) return state.issue;
        if (path.endsWith('/comments')) {
            if (method === 'POST')
                state.comments.push({ ...body, createdByAgentId: 'a', createdByRunId: state.runs.find(r => r.issueId === state.issue.id && r.status === 'running')?.id });
            return state.comments;
        }
        if (path === '/api/issues/i' && method === 'PATCH') {
            if (body.status === 'in_review' && !body.assigneeUserId?.trim())
                throw Object.assign(new Error('Human review path required'), { status: 422, code: 'invalid_issue_disposition' });
            if (body.assigneeUserId) {
                state.issue.assigneeAgentId = null;
                for (const run of state.runs) {
                    if (run.issueId === state.issue.id && run.status === 'running') run.status = 'cancelled';
                }
            }
            return Object.assign(state.issue, body);
        }
        if (path.endsWith('/cost-events')) {
            const event = { id: `event-${state.events.length}`, ...body };
            state.events.push(event);
            state.agent.spentMonthlyCents += Number(body.costCents);
            return event;
        }
        if (path.endsWith('/costs/data-quality'))
            return { events: state.events.filter(e => e.costStatus === 'unpriced'), runs: [] };
        if (path.endsWith('/budgets/overview'))
            return { policies: state.policies };
        if (path.endsWith('/budgets/policies')) {
            state.policies.push(body);
            return body;
        }
        if (path.endsWith('/heartbeat-runs'))
            return state.runs;
        if (path.endsWith('/budgets')) {
            Object.assign(state.agent, body);
            return state.agent;
        }
        if (path.endsWith('/pause')) {
            state.agent.status = 'paused';
            return state.agent;
        }
        if (path.endsWith('/resume')) {
            state.agent.status = 'idle';
            return state.agent;
        }
        if (path.endsWith('/log'))
            return { content: '' };
        if (path.endsWith('/companies'))
            return { id: 'c' };
        if (path.endsWith('/agents') && method === 'POST')
            return { ...state.agent, ...body };
        if (path.endsWith('/secrets'))
            return { id: 'secret' };
        if (path.endsWith('/adjustments'))
            return body;
        throw new Error(`Unhandled mock endpoint ${method} ${path}`);
    }
    const fetcher = async (url, init = {}) => {
        try {
            const result = await request(init.method ?? 'GET', new URL(url).pathname, init.body ? JSON.parse(init.body) : undefined);
            return new Response(JSON.stringify(result), { status: 200 });
        }
        catch (error) {
            return Response.json({ code: error.code }, { status: error.status ?? 404 });
        }
    };
    return { state, request, fetch: fetcher };
}
export async function startMockPaperclip() {
    const mock = createMockPaperclip();
    const server = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req)
            body += chunk;
        try {
            const result = await mock.request(req.method, req.url, body ? JSON.parse(body) : undefined);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
        }
        catch (error) {
            res.statusCode = error.status ?? 404;
            res.end(JSON.stringify({ code: error.code }));
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return { ...mock, server, port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const s = await startMockPaperclip();
    console.log(JSON.stringify({ port: s.port }));
}
