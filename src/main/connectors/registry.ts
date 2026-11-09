import type { ConfigureConnector, ConnectorConfig, ConnectorId } from '../../shared/types';
import { custom } from './custom';
import { hermes } from './hermes';
import { deepseek } from './deepseek';
import { createOpenRouter } from './openrouter';
import { codex } from './codex';
import { claude } from './claude';
import { validateBaseUrl } from './port';
export function createRegistry(fetcher: typeof fetch = fetch) {
    return { custom, hermes, deepseek, openrouter: createOpenRouter(fetcher), codex, claude };
}
export const registry = createRegistry();
export function assertSubscription(id: ConnectorId) {
    if (!['codex','claude'].includes(id) || id === 'claude' && process.env.ZAOS_ENABLE_CLAUDE_SUBSCRIPTION !== '1') throw new Error('Subscription mode unavailable');
}
export function listConnectors() {
    return (Object.keys(registry) as ConnectorId[]).map(id => ({ id, modes: [id === 'codex' || id === 'claude' ? 'api-key' : 'api', ...((id === 'codex' || id === 'claude' && process.env.ZAOS_ENABLE_CLAUDE_SUBSCRIPTION === '1') ? ['cli-subscription'] : [])] }));
}
export async function buildConfig(p: ConfigureConnector, connectors = registry): Promise<ConnectorConfig> {
    if (p.mode === 'cli-subscription') {
        assertSubscription(p.connectorId);
        const { monthlyRunCap, cliTimeoutSec } = p.limits;
        if (!Number.isInteger(monthlyRunCap) || monthlyRunCap! < 1 || monthlyRunCap! > 1000 || !Number.isInteger(cliTimeoutSec) || cliTimeoutSec! < 30 || cliTimeoutSec! > 1800) throw new Error('Invalid CLI limits');
        return { connectorId: p.connectorId as 'codex' | 'claude', mode: p.mode, model: p.model, monthlyRunCap: monthlyRunCap!, cliTimeoutSec: cliTimeoutSec! };
    }
    const adapter = connectors[p.connectorId];
    const model = ['openrouter','deepseek'].includes(p.connectorId) ? (await adapter.models()).find(m => m.id === p.model) : undefined;
    const prices = ['openrouter','deepseek'].includes(p.connectorId) ? model?.priceKnown ? model : undefined : p.prices;
    if (!prices || ![prices.inputCentsPerMTok, prices.outputCentsPerMTok, p.limits.maxOutputTokens, p.limits.maxRunCents].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) || !Number.isSafeInteger(p.limits.maxOutputTokens)) throw new Error('Known positive prices and run limits required');
    const baseUrl = ['custom','hermes'].includes(p.connectorId) ? p.baseUrl ?? adapter.baseUrl : adapter.baseUrl;
    if (!baseUrl) throw new Error('Provider URL required');
    return { connectorId: p.connectorId, mode: 'api', priceKnown: true, ...(model?.pricingSource ? { pricingSource: model.pricingSource, pricesRetrievedAt: model.pricesRetrievedAt } : {}), baseUrl: validateBaseUrl(baseUrl), model: p.model, inputCentsPerMTok: prices.inputCentsPerMTok!, outputCentsPerMTok: prices.outputCentsPerMTok!, maxOutputTokens: p.limits.maxOutputTokens!, maxRunCents: p.limits.maxRunCents! };
}
