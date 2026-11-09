import { sanitizeEvidence } from './evidence';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { Supervisor } from '../../src/main/supervisor';
import { createConfig, writeConfig } from '../../src/main/paperclip-config';
import { pickPorts } from '../../src/main/ports';
import { resolveNode } from '../../src/main/node-runtime';
import { instanceSecrets } from '../../src/main/instance-secrets';
import { authenticateOperator } from '../../src/main/operator-auth';
import { PaperclipClient } from '../../src/main/paperclip-client';
import { Orchestrator, type WorkspaceState } from '../../src/main/orchestrator';
import { SpendGuard } from '../../src/main/spend-guard';
// @ts-expect-error Plain no-dependency ESM fixture.
import { startMockProvider } from '../fixtures/mock-provider.mjs';
const evidenceSecrets: string[] = ['mock-provider-key-only', ...Object.entries(process.env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/.test(key)).map(([, value]) => value!).filter(Boolean)];
const require = createRequire(import.meta.url);
let dir: string, supervisor: Supervisor, api: PaperclipClient, orchestrator: Orchestrator, base: string;
let provider: Awaited<ReturnType<typeof startMockProvider>>;
const state: WorkspaceState = { managedAgentIds: [] as string[], telemetry: false, companyId: undefined as string | undefined, agentId: undefined as string | undefined };
const report: Record<string, unknown> = { suite: 'real Paperclip + mock provider', startedAt: new Date().toISOString(), passed: false, connectorsExercised: ['custom'] };
const encryptor = { encrypt: (s: string) => Buffer.from(s).toString('base64'), decrypt: (s: string) => Buffer.from(s, 'base64').toString() }; // test-only; never production storage
beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zaos-integration-'));
    console.log(`ZAOS integration temp dir: ${dir}${process.env.ZAOS_KEEP === '1' ? ' (kept)' : ''}`);
    const ports = await pickPorts();
    base = `http://127.0.0.1:${ports.server}`;
    const node = await resolveNode();
    const secrets = await instanceSecrets(dir, encryptor);
    evidenceSecrets.push(...Object.values(secrets));
    const config = createConfig(dir, ports.server, ports.postgres);
    await writeConfig(dir, config);
    provider = await startMockProvider();
    supervisor = new Supervisor({ node: node.binary, entry: require.resolve('paperclipai/dist/index.js'), dataDir: dir, port: ports.server, secrets, bootTimeoutMs: 240000 });
    await supervisor.start();
    expect(supervisor.state).toBe('ready');
    const health = await (await fetch(`${base}/api/health`)).json();
    expect(health).toMatchObject({ deploymentMode: 'authenticated', deploymentExposure: 'private' });
    expect((await fetch(`${base}/api/companies`)).status).toBe(403);
    report.unauthenticatedCompaniesStatus = 403;
    // Verify actual listener, not merely the generated configuration.
    if (process.platform === 'linux') {
        const tables = await Promise.all(['/proc/net/tcp', '/proc/net/tcp6'].map(p => readFile(p, 'utf8')));
        const portHex = ports.server.toString(16).toUpperCase().padStart(4, '0');
        const listeners = tables.flatMap(t => t.split('\n')).map(l => l.trim().split(/\s+/)).filter(parts => parts[3] === '0A' && parts[1]?.endsWith(`:${portHex}`));
        expect(listeners.length).toBeGreaterThan(0);
        expect(listeners.every(parts => parts[1] === `0100007F:${portHex}`)).toBe(true);
    }
    else if (process.platform === 'darwin') {
        const output = await new Promise<string>((res, rej) => execFile('lsof', ['-nP', `-iTCP:${ports.server}`, '-sTCP:LISTEN', '-Fn'], (err, out) => err ? rej(err) : res(out)));
        const names = output.split('\n').filter(l => l.startsWith('n'));
        expect(names.length).toBeGreaterThan(0);
        expect(names.every(l => l === `n127.0.0.1:${ports.server}`)).toBe(true);
    }
    else
        throw new Error('Listener assertion supports macOS and Linux only');
    report.loopbackListenerVerified = true;
    api = new PaperclipClient(base, async (url, init) => {
        const response = await fetch(url, init);
        // Remember exact credentials minted by this isolated instance.
        const remember = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            for (const [key, item] of Object.entries(value)) {
                if (/key|token|secret|password/i.test(key) && typeof item === 'string') evidenceSecrets.push(item);
                else remember(item);
            }
        };
        await response.clone().json().then(remember).catch(() => {});
        return response;
    });
    await authenticateOperator(api, dir, encryptor, async () => {
        config.auth.disableSignUp = true;
        await writeConfig(dir, config);
    });
    await supervisor.stop();
    await supervisor.start();
    expect(supervisor.state).toBe('ready');
    const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'second-operator@zaos.local', password: 'test-only-second-password-1234', name: 'Second operator' }) });
    expect(signup.ok).toBe(false);
    report.disableSignUpHonoured = true;
    await authenticateOperator(api, dir, encryptor, async () => {
    });
    orchestrator = new Orchestrator(api, state, { node: node.binary, runnerPath: resolve('src/runner/zaos-runner.mjs'), cwd: resolve('.') }, async () => {
    }, () => ({ state: supervisor.state }));
}, 300000);
afterAll(async () => {
    try {
        if (!report.passed) {
            const evidence: Record<string, unknown> = { tempDir: dir, runs: [], comments: [] };
            const safeGet = async <T,>(path: string): Promise<T | undefined> => {
                try { return await api.request<T>('GET', path); }
                catch { return undefined; }
            };
            if (api && state.companyId) {
                const runs = await safeGet<{ id: string }[]>(`/api/companies/${state.companyId}/heartbeat-runs`);
                for (const run of (runs ?? []).slice(0, 20)) {
                    const chunks: string[] = [];
                    let offset = 0;
                    for (let page = 0; page < 4; page++) {
                        const chunk = await safeGet<{ content?: string; nextOffset?: number; totalBytes?: number }>(`/api/heartbeat-runs/${run.id}/log?offset=${offset}&limitBytes=16000`);
                        if (!chunk) break;
                        chunks.push(chunk.content ?? '');
                        const next = chunk.nextOffset;
                        if (typeof next !== 'number' || next <= offset || (chunk.totalBytes !== undefined && next >= chunk.totalBytes)) break;
                        offset = next;
                    }
                    (evidence.runs as unknown[]).push({ id: run.id, log: sanitizeEvidence(chunks.join(''), evidenceSecrets, 64000), truncated: true });
                }
                const issues = await safeGet<{ id: string }[]>(`/api/companies/${state.companyId}/issues`);
                for (const issue of (issues ?? []).slice(0, 20)) {
                    const comments = await safeGet<unknown>(`/api/issues/${issue.id}/comments`);
                    const interactions = await safeGet<unknown>(`/api/issues/${issue.id}/interactions`);
                    (evidence.comments as unknown[]).push({ issueId: issue.id, comments: sanitizeEvidence(comments ?? [], evidenceSecrets), interactions: sanitizeEvidence(interactions ?? [], evidenceSecrets) });
                }
            }
            await mkdir(resolve('evidence'), { recursive: true });
            await writeFile(resolve('evidence/integration-failure.json'), JSON.stringify(evidence, null, 2));
        }
    }
    finally {
        try {
            await supervisor?.stop();
        }
        finally {
            try {
                await provider?.close();
            }
            finally {
                if (dir && process.env.ZAOS_KEEP !== '1')
                    await rm(dir, { recursive: true, force: true });
                await mkdir(resolve('evidence'), { recursive: true });
                await writeFile(resolve('evidence/integration-report.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
            }
        }
    }
}, 30000);
it('executes, reconciles, leaves human review; refuses low budget without provider call', async () => {
    await orchestrator.createCompany('Example Research Studio');
    await orchestrator.setProviderKey('mock-provider-key-only');
    await orchestrator.createAgentFromTemplate('researcher', { baseUrl: `http://127.0.0.1:${provider.port}/v1`, model: 'mock', inputCentsPerMTok: 10000, outputCentsPerMTok: 20000, maxOutputTokens: 100, maxRunCents: 5 });
    await orchestrator.setSpendCap(100);
    await orchestrator.setPaidExecution(true, true);
    const result = await orchestrator.runTask('Research a fictional market', 'Write a concise synthetic brief for human review.');
    expect(result.status).toBe('succeeded');
    expect(result.result).toContain('Mock research result');
    expect(result.costCents).toBeCloseTo(1.4);
    expect(provider.state.calls).toBe(1);
    const issues = await api.request<{
        id: string;
        status: string;
        title: string;
        assigneeUserId: string | null;
    }[]>('GET', `/api/companies/${state.companyId}/issues`);
    const operator = await api.request<{ userId: string }>('GET', '/api/cli-auth/me');
    const reviewIssue = issues.find(i => i.title === 'Research a fictional market')!;
    expect(reviewIssue).toBeDefined();
    const interactions = await api.request<import('../../src/shared/types').ReviewInteraction[]>('GET', `/api/issues/${reviewIssue.id}/interactions`);
    const runs = await orchestrator.listRuns();
    const run = runs.find(r => r.issueId === reviewIssue.id)!;
    const interaction = interactions.find(i => i.sourceRunId === run.id && i.kind === 'request_confirmation')!;
    expect(interaction).toMatchObject({status: 'pending', resolverPolicy: 'human_only', addresseeUserId: operator.userId, continuationPolicy: 'none', idempotencyKey: `zaos-review:${run.id}`, payload: {detailsMarkdown: result.result}});
    const accepted = await orchestrator.acceptReview(reviewIssue.id);
    expect(accepted).toMatchObject({id: interaction.id, status: 'accepted'});
    const afterAcceptance = await api.request<{status: string}>('GET', `/api/issues/${reviewIssue.id}`);
    expect(afterAcceptance.status).toBe('done');
    const persisted = await api.request<import('../../src/shared/types').ReviewInteraction[]>('GET', `/api/issues/${reviewIssue.id}/interactions`);
    expect(persisted.find(i => i.id === interaction.id)?.status).toBe('accepted');
    report.reviewAcceptance = {interactionId: interaction.id, interactionStatus: accepted.status, issueStatus: afterAcceptance.status};
    const [quality, summary, overview] = await Promise.all([
        api.request<{ events: { runId?: string; heartbeatRunId?: string; reason: string }[] }>('GET', `/api/companies/${state.companyId}/costs/data-quality`),
        api.request<{ unpricedEventCount: number; pricingComplete: boolean; spendCents: number }>('GET', `/api/companies/${state.companyId}/costs/summary`),
        api.request<{ policies: { scopeType: string; scopeId: string; status: string; unpricedEventCount: number; remainingAmount: number }[] }>('GET', `/api/companies/${state.companyId}/budgets/overview`)
    ]);
    const policy = overview.policies.find(p => p.scopeType === 'agent' && p.scopeId === state.agentId);
    const runQualityEvents = quality.events.filter(e => (e.runId ?? e.heartbeatRunId) === run.id);
    report.happyPath = {
        status: result.status, costCents: result.costCents, inReview: reviewIssue.status === 'in_review',
        summary, agentPolicy: policy, dataQualityEvents: runQualityEvents
    };
    expect(summary.unpricedEventCount).toBe(0);
    expect(summary.pricingComplete).toBe(true);
    expect(summary.spendCents).toBeCloseTo(1.4);
    expect(policy).toMatchObject({ status: 'ok', unpricedEventCount: 0 });
    expect(policy!.remainingAmount).toBeCloseTo(98.6);
    expect(runQualityEvents.filter(e => e.reason !== 'unknown_billing')).toHaveLength(0);
    (report.happyPath as Record<string, unknown>).reconciled = true;
    const previous = process.env.ZAOS_CODEX_BIN;
    process.env.ZAOS_CODEX_BIN = resolve('test/fixtures/fake-codex.mjs');
    await chmod(process.env.ZAOS_CODEX_BIN, 0o755);
    try {
        await orchestrator.configureConnector({ connectorId: 'codex', mode: 'cli-subscription', model: '', limits: { monthlyRunCap: 2, cliTimeoutSec: 30 } });
        await orchestrator.setSpendCap(100);
        await orchestrator.setPaidExecution(true, true);
        const cliResult = await orchestrator.runTask('CLI fictional research', 'Draft a synthetic result for review.');
        expect(cliResult.status).toBe('succeeded');
        expect(cliResult.result).toContain('Fake Codex result');
        expect(cliResult.costCents).toBe(0);
        expect(state.monthlyRuns?.[new Date().toISOString().slice(0,7)]).toBe(1);
        const cliRun = (await orchestrator.listRuns()).find(r => r.issueId === cliResult.issueId)!;
        const log = await api.request<{ content: string }>('GET', `/api/heartbeat-runs/${cliRun.id}/log`);
        expect(log.content).toContain('subscription_included');
        report.connectorsExercised = ['custom','codex:cli-subscription'];
        report.cliSubscription = { status: cliResult.status, costCents: cliResult.costCents, runCount: 1, billingType: 'subscription_included' };
        await orchestrator.setPaidExecution(false, false);
    } finally {
        if (previous === undefined) delete process.env.ZAOS_CODEX_BIN; else process.env.ZAOS_CODEX_BIN = previous;
    }
    // Restore the API runner before testing its worst-case budget refusal.
    await orchestrator.configureConnector({
        connectorId: 'custom', mode: 'api', baseUrl: `http://127.0.0.1:${provider.port}/v1`, model: 'mock',
        prices: { inputCentsPerMTok: 10000, outputCentsPerMTok: 20000 },
        limits: { maxOutputTokens: 100, maxRunCents: 5 }
    });
    await expect(orchestrator.setSpendCap(0)).rejects.toThrow('cap of 0');
    report.zeroCapRejected = true;
    await orchestrator.setPaidExecution(false, false);
    // Keep a positive policy whose remaining amount is below runner's worst case.
    await new SpendGuard(api, state.companyId!).applyAgentCap(state.agentId!, 2, 0.1);
    await api.request('POST', `/api/agents/${state.agentId}/resume`, {});
    const before = provider.state.calls;
    const issue = await api.request<{
        id: string;
    }>('POST', `/api/companies/${state.companyId}/issues`, { title: 'Budget refusal', description: 'A synthetic task that must not reach the provider.', assigneeAgentId: state.agentId, status: 'todo' });
    let comments: {
        body: string;
    }[] = [];
    for (let i = 0; i < 120; i++) {
        comments = await api.request('GET', `/api/issues/${issue.id}/comments`);
        if (comments.some(c => c.body.includes('ZAOS refused')))
            break;
        await new Promise(r => setTimeout(r, 1000));
    }
    expect(comments.some(c => c.body.includes('ZAOS refused'))).toBe(true);
    expect(provider.state.calls).toBe(before);
    report.lowBudgetNoProviderCall = true;
    await api.request('POST', `/api/agents/${state.agentId}/pause`, {});
    await api.request('PATCH', `/api/issues/${issue.id}`, { status: 'cancelled' });
    report.passed = true;
}, 300000);
