import type { BoardApi, ProviderConfig } from '../shared/types';
export function parseCap(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 100000) {
        throw new Error('Cap must be integer cents from 1 to 100000. A cap of 0 would disable Paperclip\'s budget policy; to block spend, keep paid execution off');
    }
    return value;
}
export function assertPaidRequirements(provider: ProviderConfig | undefined, keyPresent: boolean, cap: unknown, consent: boolean) {
    parseCap(cap);
    if (!provider || !keyPresent || consent !== true) {
        throw new Error('Provider, BYOK key and explicit consent are required');
    }
    for (const n of [provider.inputCentsPerMTok, provider.outputCentsPerMTok, provider.maxRunCents, provider.maxOutputTokens]) {
        if (!Number.isFinite(n) || n <= 0)
            throw new Error('Provider prices and run limits must be positive');
    }
}
interface Policy {
    scopeId: string;
    amount: number;
    isActive: boolean;
}
interface CostEvent {
    id: string;
    runId?: string;
    heartbeatRunId?: string;
    agentId?: string;
    reason?: string;
    provider?: string;
    idempotencyKey?: string;
    costStatus?: string;
    costCents?: string | number;
}
interface Receipt {
    eventId: string;
    runId: string;
    idempotencyKey: string;
    costCents: number;
    costStatus: 'reported' | 'estimated';
}
export function readZaosReceipt(content: string, runId: string): Receipt | undefined {
    // A child stdout write can be split across multiple Paperclip NDJSON chunks.
    let stdout = '';
    for (const line of content.split('\n')) {
        try {
            const entry = JSON.parse(line);
            if (entry.stream === 'stdout' && typeof entry.chunk === 'string')
                stdout += entry.chunk;
        }
        catch { /* Ignore incomplete outer log records. */
        }
    }
    for (const line of stdout.split('\n')) {
        try {
            const r = JSON.parse(line).zaosReceipt;
            if (r && typeof r.eventId === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(r.eventId) && r.runId === runId && r.idempotencyKey === `zaos:${runId}` && ['reported', 'estimated'].includes(r.costStatus) && typeof r.costCents === 'number' && Number.isFinite(r.costCents) && r.costCents >= 0)
                return r as Receipt;
        }
        catch { /* Provider content is never accepted as accounting evidence. */
        }
    }
}
export class SpendGuard {
    constructor(private api: BoardApi, readonly companyId: string) {
    }
    async applyAgentCap(agentId: string, cap: unknown, reservationCents: number) {
        const amount = parseCap(cap);
        if (!Number.isFinite(reservationCents) || reservationCents <= 0 || reservationCents > amount)
            throw new Error('Reservation must be positive and within cap');
        await this.api.request('PATCH', `/api/companies/${this.companyId}/budgets`, { budgetMonthlyCents: amount });
        await this.api.request('PATCH', `/api/agents/${agentId}/budgets`, { budgetMonthlyCents: amount });
        await this.api.request('POST', `/api/companies/${this.companyId}/budgets/policies`, { scopeType: 'agent', scopeId: agentId, amount, reservationCents, hardStopEnabled: true, unpricedUsagePolicy: 'block', warnPercent: 80, isActive: true });
    }
    async disable(agentId: string) {
        await this.api.request('POST', `/api/agents/${agentId}/pause`, {});
    }
    async startupAudit(agentIds: string[]) {
        const { policies } = await this.api.request<{
            policies: Policy[];
        }>('GET', `/api/companies/${this.companyId}/budgets/overview`);
        const paused = [];
        for (const id of agentIds) {
            if (!policies.some(p => p.scopeId === id && p.isActive && Number.isFinite(Number(p.amount)) && Number(p.amount) > 0)) {
                await this.disable(id);
                paused.push(id);
            }
        }
        return paused;
    }
    async pricedReceipt(runId: string) {
        const log = await this.api.request<{ content: string }>('GET', `/api/heartbeat-runs/${runId}/log`);
        const receipt = readZaosReceipt(log.content ?? '', runId);
        if (receipt) return receipt;
        const quality = await this.api.request<{ events: CostEvent[] }>('GET', `/api/companies/${this.companyId}/costs/data-quality`);
        const event = quality.events.find(e => (e.runId ?? e.heartbeatRunId) === runId && e.idempotencyKey === `zaos:${runId}` && ['reported', 'estimated'].includes(e.costStatus ?? '') && e.costCents != null && Number.isFinite(Number(e.costCents)) && Number(e.costCents) >= 0);
        return event ? { costCents: Number(event.costCents) } : undefined;
    }
    async reconcileRun(runId: string, sleep?: (ms: number) => Promise<void>, agentId?: string) {
        if (!await this.pricedReceipt(runId))
            return 'unknown cost';
        let receipts: CostEvent[] = [];
        for (let i = 0; i <= (sleep ? 30 : 0); i++) {
            const quality = await this.api.request<{ events: CostEvent[] }>('GET', `/api/companies/${this.companyId}/costs/data-quality`);
            const runEvents = quality.events.filter(e => (e.runId ?? e.heartbeatRunId) === runId);
            agentId ??= runEvents.find(e => e.agentId)?.agentId;
            receipts = runEvents.filter(e => ['unknown_billing', 'missing_price', 'missing_model'].includes(e.reason ?? '') || e.provider === 'unknown');
            if (runEvents.length || i === (sleep ? 30 : 0)) break;
            await sleep!(1000);
        }
        for (const e of receipts) {
            try {
                await this.api.request('POST', `/api/companies/${this.companyId}/accounting/events/${e.id}/adjustments`, { idempotencyKey: `zaos:reconcile:${runId}:${e.id}`, expectedCents: 0, correctedCents: 0, reason: 'ZAOS runner posted a priced event for this run', pricing: { source: 'operator' } });
            } catch (error) {
                // A retry can encounter the adjustment already recorded for this event.
                if (!((error as { status?: number }).status === 409 || error instanceof Error && /\(409\)|duplicate/i.test(error.message))) throw error;
            }
        }
        const overview = await this.api.request<{ policies: { scopeType: string; scopeId: string; unpricedEventCount: number }[] }>('GET', `/api/companies/${this.companyId}/budgets/overview`);
        const policy = overview.policies.find(p => p.scopeType === 'agent' && p.scopeId === agentId);
        return policy?.unpricedEventCount === 0 ? 'reconciled' : 'unknown cost';
    }
}
