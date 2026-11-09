import type { KeepMindService } from './keepmind/service';
import { withNodePath } from './node-runtime';
import { testConnector } from './connectors/test';
import { registry, buildConfig, listConnectors, assertSubscription } from './connectors/registry';
import { resolveCli, startCliLogin } from './connectors/cli';
import type { ConnectorConfig, ConnectorId, ConfigureConnector, ConnectorDetection, Agent, BoardApi, ProviderConfig, Run, Issue, TaskResult, ReviewInteraction } from '../shared/types';
import { SpendGuard, assertPaidRequirements, parseCap } from './spend-guard';
import { templates } from './templates';
import { validateAdapter } from './adapter-guard';
import { validatePayload } from './ipc-validation';
export interface WorkspaceState {
    companyId?: string;
    agentId?: string;
    managedAgentIds: string[];
    provider?: ProviderConfig;
    connector?: ConnectorConfig;
    monthlyRuns?: Record<string, number>;
    secretId?: string;
    cap?: number;
    telemetry: boolean;
}
export class Orchestrator {
    private paid = false;
    private busy = false;
    constructor(private api: BoardApi, private state: WorkspaceState, private runtime: {
        node: string;
        nodeDir?: string;
        runnerPath: string;
        cwd: string;
    }, private save: (s: WorkspaceState) => Promise<void>, private status: () => unknown, private sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)), private detector = (id: ConnectorId): Promise<ConnectorDetection> => registry[id].detect(), private keepmind?: KeepMindService | null) {
        if (!state.connector && state.provider) state.connector = { ...state.provider, connectorId: 'custom', mode: 'api', priceKnown: true };
    }
    testConnector(payload: import("../shared/types").TestConnector) { return testConnector(payload, fetch, id => this.detectConnector(id)); }
    listConnectors() { return listConnectors(); }
    detectConnector(id: ConnectorId) { validatePayload('detectConnector', { id }); return this.detector(id); }
    listConnectorModels(id: ConnectorId) { validatePayload('listConnectorModels', { id }); return registry[id].models(); }
    async startConnectorLogin(id: ConnectorId) { assertSubscription(id); await startCliLogin(id as 'codex' | 'claude'); }
    async configureConnector(payload: ConfigureConnector) {
        validatePayload('configureConnector', payload);
        await this.setPaidExecution(false, false);
        const config = await buildConfig(payload);
        if (this.state.agentId) {
            const current = await this.api.request<{ adapterConfig: Record<string, unknown> & { env?: Record<string, unknown> } }>('GET', `/api/agents/${this.agent()}`);
            validateAdapter('process', current.adapterConfig, this.runtime.runnerPath);
            const env = await this.connectorEnv(config);
            await this.api.request('PATCH', `/api/agents/${this.agent()}`, { adapterConfig: { ...current.adapterConfig, timeoutSec: config.mode === 'cli-subscription' ? config.cliTimeoutSec + 30 : 120, env: { ZAOS_REVIEWER_USER_ID: current.adapterConfig.env?.ZAOS_REVIEWER_USER_ID, ZAOS_AGENT_INSTRUCTIONS: current.adapterConfig.env?.ZAOS_AGENT_INSTRUCTIONS, ...env } } });
        }
        this.state.connector = config;
        this.state.provider = config.mode === 'api' ? config : undefined;
        await this.save(this.state);
    }
    private async connectorEnv(config: ConnectorConfig): Promise<Record<string, unknown>> {
        const common = { ...(this.runtime.nodeDir ? { ...withNodePath({ PATH: process.env.PATH }, this.runtime.nodeDir), ZAOS_NODE_RUNTIME_DIR: this.runtime.nodeDir } : {}), ZAOS_CONNECTOR: config.connectorId, ZAOS_CONNECTOR_MODE: config.mode, ZAOS_PROVIDER_MODEL: config.model };
        if (config.mode === 'cli-subscription') {
            const bin = await resolveCli(config.connectorId);
            if (!bin) throw new Error('CLI not installed');
            return { ...common, ZAOS_CLI_BIN: bin, ...(config.connectorId === 'claude' ? { ZAOS_ENABLE_CLAUDE_SUBSCRIPTION: '1' } : {}), ZAOS_CLI_TIMEOUT_SEC: String(config.cliTimeoutSec) };
        }
        return { ...common, ZAOS_PROVIDER_BASE_URL: config.baseUrl, ...(this.state.secretId ? { ZAOS_PROVIDER_API_KEY: { type: 'secret_ref', secretId: this.state.secretId, version: 'latest' } } : {}), ZAOS_PRICE_INPUT_CENTS_PER_MTOK: String(config.inputCentsPerMTok), ZAOS_PRICE_OUTPUT_CENTS_PER_MTOK: String(config.outputCentsPerMTok), ZAOS_MAX_OUTPUT_TOKENS: String(config.maxOutputTokens), ZAOS_MAX_RUN_CENTS: String(config.maxRunCents) };
    }
    getStatus() {
        return { ...(this.status() as object), paidExecution: this.paid };
    }
    private company() {
        if (!this.state.companyId)
            throw new Error('Create a company first');
        return this.state.companyId;
    }
    private agent() {
        if (!this.state.agentId)
            throw new Error('Create an agent first');
        return this.state.agentId;
    }
    private guard() {
        return new SpendGuard(this.api, this.company());
    }
    async startupAudit() {
        this.paid = false;
        const paused = await this.guard().startupAudit(this.state.managedAgentIds);
        for (const id of this.state.managedAgentIds)
            if (!paused.includes(id))
                await this.guard().disable(id);
        return paused;
    }
    async createCompany(name: string) {
        validatePayload('createCompany', { name });
        if (this.state.companyId)
            throw new Error('Company already configured');
        const company = await this.api.request<{
            id: string;
        }>('POST', '/api/companies', { name, description: 'Human-governed local workspace' });
        this.state.companyId = company.id;
        await this.save(this.state);
        return company;
    }
    async setProviderKey(key: string) {
        validatePayload('setProviderKey', { key });
        await this.setPaidExecution(false, false);
        const secret = await this.api.request<{
            id: string;
        }>('POST', `/api/companies/${this.company()}/secrets`, { name: `ZAOS provider ${Date.now()}`, value: key, provider: 'local_encrypted' });
        if (this.state.agentId && this.state.connector?.mode !== 'cli-subscription') {
            const current = await this.api.request<{
                adapterConfig: Record<string, unknown> & {
                    env?: Record<string, unknown>;
                };
            }>('GET', `/api/agents/${this.state.agentId}`);
            validateAdapter('process', current.adapterConfig, this.runtime.runnerPath);
            await this.api.request('PATCH', `/api/agents/${this.state.agentId}`, { adapterConfig: { ...current.adapterConfig, env: { ...current.adapterConfig.env, ZAOS_PROVIDER_API_KEY: { type: 'secret_ref', secretId: secret.id, version: 'latest' } } } });
        }
        this.state.secretId = secret.id;
        await this.save(this.state);
    }
    async createAgentFromTemplate(templateId: string, provider?: ProviderConfig) {
        validatePayload('createAgentFromTemplate', { templateId, provider });
        if (this.state.agentId)
            throw new Error('An agent is already configured');
        const template = templates.find(t => t.id === templateId);
        if (!template)
            throw new Error('Unknown template');
        if (!this.state.secretId && !this.state.connector)
            throw new Error('Set provider key first');
        const session = await this.api.request<{ userId: string }>('GET', '/api/cli-auth/me');
        if (typeof session.userId !== 'string' || !session.userId.trim())
            throw new Error('Human reviewer user ID is required');
        if (!this.state.connector && !provider) throw new Error('Provider or configured connector required');
        const connector = this.state.connector ?? { ...provider!, connectorId: 'custom' as const, mode: 'api' as const, priceKnown: true as const };
        const env = { ZAOS_REVIEWER_USER_ID: session.userId, ZAOS_AGENT_INSTRUCTIONS: template.instructions, ...await this.connectorEnv(connector) };
        const adapterConfig = { command: this.runtime.node, args: [this.runtime.runnerPath], cwd: this.runtime.cwd, timeoutSec: connector.mode === 'cli-subscription' ? connector.cliTimeoutSec + 30 : 120, env };
        validateAdapter('process', adapterConfig, this.runtime.runnerPath);
        const agent = await this.api.request<Agent>('POST', `/api/companies/${this.company()}/agents`, { name: template.name, role: template.role, title: template.name, capabilities: template.instructions, adapterType: 'process', adapterConfig });
        this.state.agentId = agent.id;
        this.state.managedAgentIds.push(agent.id);
        this.state.connector = connector;
        this.state.provider = connector.mode === 'api' ? connector : undefined;
        await this.save(this.state);
        await this.guard().disable(agent.id);
        return agent;
    }
    async setSpendCap(value: unknown) {
        const cap = parseCap(value);
        await this.setPaidExecution(false, false);
        await this.guard().applyAgentCap(this.agent(), cap, this.state.provider?.maxRunCents ?? 1);
        this.state.cap = cap;
        await this.save(this.state);
    }
    async setPaidExecution(enabled: boolean, consent: boolean) {
        if (!enabled) {
            this.paid = false;
            if (this.state.agentId)
                await this.guard().disable(this.state.agentId);
            return;
        }
        const config = this.state.connector ?? this.state.provider;
        const detected = config && 'mode' in config && config.mode === 'cli-subscription' ? await this.detector(config.connectorId) : undefined;
        if (config && 'mode' in config && config.mode === 'cli-subscription') assertSubscription(config.connectorId);
        assertPaidRequirements(config, !!this.state.secretId, this.state.cap, consent, detected);
        await this.guard().applyAgentCap(this.agent(), this.state.cap, this.state.provider?.maxRunCents ?? 1);
        await this.api.request('POST', `/api/agents/${this.agent()}/resume`, {});
        this.paid = true;
    }
    async listRuns() {
        return this.api.request<Run[]>('GET', `/api/companies/${this.company()}/heartbeat-runs`);
    }
    async runTask(title: string, description: string): Promise<TaskResult> {
        validatePayload('runTask', { title, description });
        if (!this.paid)
            throw new Error('Paid execution is disabled');
        if (this.busy)
            throw new Error('A task is already running');
        this.busy = true;
        try {
            if (this.keepmind) {
                try {
                    if (this.keepmind.companyId !== this.company() || !await this.keepmind.health()) throw new Error('KeepMind unavailable');
                } catch {
                    return { result: 'KeepMind unavailable', status: 'blocked', costCents: 0, spent: 0, cap: this.state.cap ?? 0 };
                }
            }
            const config = this.state.connector;
            if (config?.mode === 'cli-subscription') {
                const month = new Date().toISOString().slice(0, 7);
                const counts = this.state.monthlyRuns ??= {};
                if ((counts[month] ?? 0) >= config.monthlyRunCap) throw new Error('Monthly run cap reached');
                counts[month] = (counts[month] ?? 0) + 1;
                await this.save(this.state);
            }
            const before = new Set((await this.listRuns()).map(r => r.id));
            const issue = await this.api.request<Issue>('POST', `/api/companies/${this.company()}/issues`, { title, description, assigneeAgentId: this.agent(), status: 'todo' });
            let completed: Run | undefined;
            let currentIssue = issue;
            let terminalPolls = 0;
            for (let i = 0; i < (config?.mode === 'cli-subscription' ? config.cliTimeoutSec + 90 : 240); i++) {
                const [runs, latestIssue] = await Promise.all([
                    this.listRuns(), this.api.request<Issue>('GET', `/api/issues/${issue.id}`)
                ]);
                currentIssue = latestIssue;
                const run = runs.find(r => !before.has(r.id) && r.issueId === issue.id);
                if (run && ['succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted'].includes(run.status)) {
                    completed = run;
                    if (!['succeeded', 'cancelled'].includes(run.status) ||
                        ((currentIssue.status === 'in_review' || await this.pendingReview(issue.id, run.id)) && await this.guard().pricedReceipt(run.id)) || terminalPolls++ >= 30)
                        break;
                }
                await this.sleep(1000);
            }
            if (!completed)
                throw new Error('Task timed out; review the board before retrying');
            const guard = this.guard();
            const reconciliation = await guard.reconcileRun(completed.id, this.sleep, this.agent());
            const [comments, agent, receipt, finalIssue] = await Promise.all([
                this.api.request<{ body: string; createdByRunId?: string; createdByAgentId?: string; createdAt?: string }[]>('GET', `/api/issues/${issue.id}/comments`),
                this.api.request<Agent>('GET', `/api/agents/${this.agent()}`),
                guard.pricedReceipt(completed.id),
                this.api.request<Issue>('GET', `/api/issues/${issue.id}`)
            ]);
            const runComments = comments.filter(c => c.createdByRunId === completed.id && (!c.createdByAgentId || c.createdByAgentId === this.agent()))
                .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
            const refusal = runComments.filter(c => c.body.startsWith('ZAOS refused:')).at(-1);
            const succeeded = ['succeeded', 'cancelled'].includes(completed.status) && (finalIssue.status === 'in_review' || !!await this.pendingReview(issue.id, completed.id)) && !!receipt;
            if (reconciliation !== 'reconciled')
                await this.setPaidExecution(false, false);
            return { issueId: issue.id, result: (succeeded ? runComments.at(-1) : refusal ?? runComments.at(-1))?.body ?? '', costCents: receipt?.costCents ?? 0, spent: agent.spentMonthlyCents, cap: this.state.cap!, status: succeeded ? 'succeeded' : refusal ? 'refused' : 'failed' };
        }
        catch (error) {
            await this.setPaidExecution(false, false);
            throw error;
        }
        finally {
            this.busy = false;
        }
    }
    private async pendingReview(issueId: string, runId?: string) {
        const interactions = await this.api.request<ReviewInteraction[]>('GET', `/api/issues/${encodeURIComponent(issueId)}/interactions`);
        return interactions.find(i => i.kind === 'request_confirmation' && i.status === 'pending' &&
            !!i.sourceRunId && (runId ? i.sourceRunId === runId : i.idempotencyKey === `zaos-review:${i.sourceRunId}`));
    }
    async acceptReview(issueId: string): Promise<ReviewInteraction> {
        if (typeof issueId !== 'string' || !issueId.trim()) throw new Error('Issue ID is required');
        const interaction = await this.pendingReview(issueId);
        if (!interaction) throw new Error('No pending ZAOS review for this issue');
        const accepted = await this.api.request<ReviewInteraction>('POST', `/api/issues/${encodeURIComponent(issueId)}/interactions/${encodeURIComponent(interaction.id)}/accept`, {});
        const issue = await this.api.request<Issue>('GET', `/api/issues/${encodeURIComponent(issueId)}`);
        if (issue.status === 'todo')
            await this.api.request('PATCH', `/api/issues/${encodeURIComponent(issueId)}`, { status: 'done' });
        return accepted;
    }
    getTelemetry() {
        return this.state.telemetry;
    }
    async setTelemetry(enabled: boolean) {
        if (typeof enabled !== 'boolean')
            throw new Error('Expected boolean');
        this.state.telemetry = enabled;
        await this.save(this.state);
    }
}
