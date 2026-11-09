import type { ConnectorId, ConnectorModel, ConnectorConfig, ConnectorDetection } from '../../shared/types';
export interface ProviderConnector {
    id: ConnectorId;
    baseUrl?: string;
    models(): Promise<ConnectorModel[]>;
    detect(): Promise<ConnectorDetection>;
}
export function validateBaseUrl(value: string) {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1'))) throw new Error('Unsafe provider URL');
    return value;
}
export function estimateRunCents(config: ConnectorConfig, promptChars: number) {
    if (!Number.isSafeInteger(promptChars) || promptChars < 0) throw new Error('Invalid prompt size');
    if (config.mode === 'cli-subscription') return 0;
    if (!Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens <= 0 || !config.priceKnown || ![config.inputCentsPerMTok, config.outputCentsPerMTok].every(n => Number.isFinite(n) && n > 0)) throw new Error('Known positive prices required');
    return (Math.ceil(promptChars / 3) * config.inputCentsPerMTok + config.maxOutputTokens * config.outputCentsPerMTok) / 1e6;
}
