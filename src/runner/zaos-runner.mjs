import { executeCli } from './cli.mjs';
import { pathToFileURL } from 'node:url';
export async function run(env = process.env, fetcher = fetch, log = console.log, errorLog = console.error, cliExecutor = executeCli) {
    let issue, checkedOut = false;
    let context = { step: 'configuration', method: null, path: null, status: null };
    const redact = value => {
        for (const key of Object.entries(env).filter(([key]) => /(?:KEY|TOKEN|SECRET)$/.test(key)).map(([, value]) => value).filter(Boolean).sort((a, b) => b.length - a.length))
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
        const cli = env.ZAOS_CONNECTOR_MODE === 'cli-subscription';
        const inputPrice = Number(env.ZAOS_PRICE_INPUT_CENTS_PER_MTOK), outputPrice = Number(env.ZAOS_PRICE_OUTPUT_CENTS_PER_MTOK), maxOutput = Number(env.ZAOS_MAX_OUTPUT_TOKENS), maxRun = Number(env.ZAOS_MAX_RUN_CENTS);
        if (!cli && (![inputPrice, outputPrice, maxOutput, maxRun].every(n => Number.isFinite(n) && n > 0) || !Number.isSafeInteger(maxOutput)))
            return await refuse('Known positive prices and run limits are required');
        const prompt = `${env.ZAOS_AGENT_INSTRUCTIONS || ''}\n${issue.title}\n${issue.description || ''}`;
        const worst = cli ? 0 : (Math.ceil(prompt.length / 3) * inputPrice + maxOutput * outputPrice) / 1000000;
        if (!Number.isFinite(worst) || (!cli && worst > maxRun))
            return await refuse('Worst-case cost exceeds per-run maximum');
        const agent = await api('GET', '/api/agents/me');
        const budget = Number(agent.budgetMonthlyCents), spent = Number(agent.spentMonthlyCents);
        if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(spent) || spent < 0 || budget - spent < worst)
            return await refuse('Insufficient capped budget');
        let result, cost, provider, model = env.ZAOS_PROVIDER_MODEL || 'cli-default', inputTokens, outputTokens;
        const billingType = cli ? 'subscription_included' : 'metered_api';
        if (cli) {
            if (env.ZAOS_CONNECTOR === 'claude' && env.ZAOS_ENABLE_CLAUDE_SUBSCRIPTION !== '1') return await refuse('Subscription mode unavailable');
            const data = await cliExecutor(env.ZAOS_CONNECTOR, env.ZAOS_CLI_BIN, env.ZAOS_PROVIDER_MODEL, prompt, Number(env.ZAOS_CLI_TIMEOUT_SEC), env);
            result = data.result; cost = 0; inputTokens = data.inputTokens; outputTokens = data.outputTokens;
            provider = env.ZAOS_CONNECTOR === 'codex' ? 'openai-codex-cli' : 'anthropic-claude-cli';
        } else {
            if ((!env.ZAOS_PROVIDER_API_KEY && env.ZAOS_CONNECTOR !== 'hermes') || !env.ZAOS_PROVIDER_MODEL)
                return await refuse('Provider configuration missing');
            const base = new URL(env.ZAOS_PROVIDER_BASE_URL || 'https://api.openai.com/v1');
            if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1')))
                return await refuse('Unsafe provider URL');
            context = { step: 'provider', method: 'POST', path: '/chat/completions', status: null };
            const response = await fetcher(`${base.href.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { ...(env.ZAOS_PROVIDER_API_KEY ? { Authorization: `Bearer ${env.ZAOS_PROVIDER_API_KEY}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env.ZAOS_PROVIDER_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: maxOutput }), signal: AbortSignal.timeout(90000), redirect: 'error' });
            if (!response.ok)
                throw new Error('Provider request failed');
            const data = await response.json();
            const usage = data.usage;
            if (!usage || ![usage.prompt_tokens, usage.completion_tokens].every(n => Number.isSafeInteger(n) && n >= 0))
                throw new Error('Provider usage missing');
            cost = (usage.prompt_tokens * inputPrice + usage.completion_tokens * outputPrice) / 1000000;
            if (!Number.isFinite(cost))
                throw new Error('Invalid usage cost');
            result = data.choices?.[0]?.message?.content;
            if (typeof result !== 'string')
                throw new Error('Provider result missing');
            provider = base.hostname; inputTokens = usage.prompt_tokens; outputTokens = usage.completion_tokens;
        }
        const event = await api('POST', `/api/companies/${env.PAPERCLIP_COMPANY_ID}/cost-events`, { agentId: env.PAPERCLIP_AGENT_ID, issueId: issue.id, heartbeatRunId: env.PAPERCLIP_RUN_ID, provider, model, billingType, costStatus: 'reported', inputTokens, outputTokens, costCents: String(cost), occurredAt: new Date().toISOString(), idempotencyKey: `zaos:${env.PAPERCLIP_RUN_ID}` });
        // Bounded acknowledgement only: never echo provider content, errors, keys or environments.
        log(JSON.stringify({ zaosReceipt: { eventId: event.id, runId: env.PAPERCLIP_RUN_ID, idempotencyKey: `zaos:${env.PAPERCLIP_RUN_ID}`, costCents: cost, costStatus: 'reported', billingType } }));
        await api('POST', `/api/issues/${issue.id}/comments`, { body: redact(result) }, 'comment');
        await api('POST', `/api/issues/${issue.id}/interactions`, {
            kind: 'request_confirmation', resolverPolicy: 'human_only', addresseeUserId: reviewerUserId,
            idempotencyKey: `zaos-review:${env.PAPERCLIP_RUN_ID}`, sourceRunId: env.PAPERCLIP_RUN_ID,
            title: 'Review ZAOS result', summary: 'Draft ready for human review', continuationPolicy: 'none',
            payload: { version: 1, prompt: 'Review the draft result.', acceptLabel: 'Accept draft', rejectLabel: 'Request changes', detailsMarkdown: redact(result) }
        }, 'interaction');
        // The persisted interaction is sufficient even if Paperclip rejects this disposition.
        checkedOut = false;
        try { await api('PATCH', `/api/issues/${issue.id}`, { status: 'in_review' }, 'review'); }
        catch { /* api already emitted a sanitized zaosError */ }
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
