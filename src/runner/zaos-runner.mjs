import { pathToFileURL } from 'node:url';
export async function run(env = process.env, fetcher = fetch, log = console.log, errorLog = console.error) {
    let issue, checkedOut = false;
    let context = { step: 'configuration', method: null, path: null, status: null };
    const redact = value => {
        for (const key of [env.PAPERCLIP_API_KEY, env.ZAOS_PROVIDER_API_KEY].filter(Boolean).sort((a, b) => b.length - a.length))
            value = value.split(key).join('[redacted]');
        return value;
    };
    const diagnostic = (fields = {}) => errorLog(JSON.stringify({ zaosError: { ...context, code: null, message: null, ...fields } }));
    const api = async (method, path, body, step = 'paperclip') => {
        context = { step, method, path: redact(path), status: null };
        try {
            const r = await fetcher(`${env.PAPERCLIP_API_URL}${path}`, { method, headers: { Authorization: `Bearer ${env.PAPERCLIP_API_KEY}`, 'Content-Type': 'application/json', 'X-Paperclip-Run-Id': env.PAPERCLIP_RUN_ID }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
            context.status = r.status;
            if (!r.ok) {
                const data = await r.json().catch(() => null);
                const fields = data?.error && typeof data.error === 'object' ? data.error : data;
                const code = typeof fields?.code === 'string' ? redact(fields.code) : null;
                const message = typeof fields?.message === 'string' ? fields.message : typeof data?.error === 'string' ? data.error : null;
                diagnostic({ code, message: message === null ? null : redact(message).slice(0, 300) });
                throw Object.assign(new Error('Paperclip request failed'), { diagnosed: true });
            }
            return r.status === 204 ? undefined : await r.json();
        }
        catch (error) {
            if (!error?.diagnosed) diagnostic();
            throw Object.assign(new Error('Paperclip request failed'), { diagnosed: true });
        }
    };
    const refuse = async (reason) => {
        if (issue)
            await api('POST', `/api/issues/${issue.id}/comments`, { body: `ZAOS refused: ${reason}` });
        return { ok: false, reason };
    };
    try {
        for (const k of ['PAPERCLIP_API_URL', 'PAPERCLIP_API_KEY', 'PAPERCLIP_RUN_ID', 'PAPERCLIP_AGENT_ID', 'PAPERCLIP_COMPANY_ID'])
            if (!env[k])
                throw new Error('Missing runner configuration');
        const inbox = await api('GET', '/api/agents/me/inbox-lite');
        const task = Array.isArray(inbox) ? inbox.find(i => ['todo', 'in_progress'].includes(i.status)) : undefined;
        if (!task)
            return { ok: false, reason: 'No assigned task' };
        issue = await api('GET', `/api/issues/${task.id}`);
        await api('POST', `/api/issues/${issue.id}/checkout`, { agentId: env.PAPERCLIP_AGENT_ID, expectedStatuses: ['todo', 'in_progress'] }, 'checkout');
        checkedOut = true;
        const reviewerUserId = env.ZAOS_REVIEWER_USER_ID?.trim();
        if (!reviewerUserId)
            return await refuse('Human reviewer user ID is required');
        const inputPrice = Number(env.ZAOS_PRICE_INPUT_CENTS_PER_MTOK), outputPrice = Number(env.ZAOS_PRICE_OUTPUT_CENTS_PER_MTOK), maxOutput = Number(env.ZAOS_MAX_OUTPUT_TOKENS), maxRun = Number(env.ZAOS_MAX_RUN_CENTS);
        if (![inputPrice, outputPrice, maxOutput, maxRun].every(n => Number.isFinite(n) && n > 0) || !Number.isSafeInteger(maxOutput))
            return await refuse('Known positive prices and run limits are required');
        const prompt = `${env.ZAOS_AGENT_INSTRUCTIONS || ''}\n${issue.title}\n${issue.description || ''}`;
        const worst = (Math.ceil(prompt.length / 3) * inputPrice + maxOutput * outputPrice) / 1000000;
        if (!Number.isFinite(worst) || worst > maxRun)
            return await refuse('Worst-case cost exceeds per-run maximum');
        const agent = await api('GET', '/api/agents/me');
        const budget = Number(agent.budgetMonthlyCents), spent = Number(agent.spentMonthlyCents);
        if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(spent) || spent < 0 || budget - spent < worst)
            return await refuse('Insufficient capped budget');
        if (!env.ZAOS_PROVIDER_API_KEY || !env.ZAOS_PROVIDER_MODEL)
            return await refuse('Provider configuration missing');
        const base = new URL(env.ZAOS_PROVIDER_BASE_URL || 'https://api.openai.com/v1');
        if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1')))
            return await refuse('Unsafe provider URL');
        context = { step: 'provider', method: 'POST', path: '/chat/completions', status: null };
        const response = await fetcher(`${base.href.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${env.ZAOS_PROVIDER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env.ZAOS_PROVIDER_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: maxOutput }), signal: AbortSignal.timeout(90000), redirect: 'error' });
        if (!response.ok)
            throw new Error('Provider request failed');
        const data = await response.json();
        const usage = data.usage;
        if (!usage || ![usage.prompt_tokens, usage.completion_tokens].every(n => Number.isSafeInteger(n) && n >= 0))
            throw new Error('Provider usage missing');
        const cost = (usage.prompt_tokens * inputPrice + usage.completion_tokens * outputPrice) / 1000000;
        if (!Number.isFinite(cost))
            throw new Error('Invalid usage cost');
        const result = data.choices?.[0]?.message?.content;
        if (typeof result !== 'string')
            throw new Error('Provider result missing');
        const event = await api('POST', `/api/companies/${env.PAPERCLIP_COMPANY_ID}/cost-events`, { agentId: env.PAPERCLIP_AGENT_ID, issueId: issue.id, heartbeatRunId: env.PAPERCLIP_RUN_ID, provider: base.hostname, model: env.ZAOS_PROVIDER_MODEL, billingType: 'metered_api', costStatus: 'reported', inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, costCents: String(cost), occurredAt: new Date().toISOString(), idempotencyKey: `zaos:${env.PAPERCLIP_RUN_ID}` });
        // Bounded acknowledgement only: never echo provider content, errors, keys or environments.
        log(JSON.stringify({ zaosReceipt: { eventId: event.id, runId: env.PAPERCLIP_RUN_ID, idempotencyKey: `zaos:${env.PAPERCLIP_RUN_ID}`, costCents: cost, costStatus: 'reported' } }));
        await api('POST', `/api/issues/${issue.id}/comments`, { body: redact(result) }, 'comment');
        await api('PATCH', `/api/issues/${issue.id}`, { status: 'in_review', assigneeUserId: reviewerUserId }, 'review');
        checkedOut = false;
        await api('POST', `/api/issues/${issue.id}/release`, undefined, 'release');
        return { ok: true, costCents: cost };
    }
    catch (error) {
        if (!error?.diagnosed) diagnostic();
        try {
            await refuse('Execution failed; cost may be unknown. Human review required.');
        }
        catch {
        }
        return { ok: false, reason: 'Execution failed; cost may be unknown' };
    }
    finally {
        if (checkedOut) {
            try { await api('POST', `/api/issues/${issue.id}/release`, undefined, 'release'); }
            catch (error) { if (!error?.diagnosed) diagnostic(); }
        }
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = await run();
    if (!result.ok) {
        console.error('ZAOS run refused or failed; inspect issue comments.');
        process.exitCode = 1;
    }
}
