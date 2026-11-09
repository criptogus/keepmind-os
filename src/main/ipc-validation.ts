import { isAllowedExternalUrl } from './external-url';
import { parseCap } from './spend-guard';
export function validateSender(sender: {
    url: string;
    isMainFrame: boolean;
}, ownedUrl: string) {
    return sender.isMainFrame === true && sender.url === ownedUrl;
}
function record(v: unknown): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v))
        throw new Error('Expected payload object');
    return v as Record<string, unknown>;
}
function text(v: unknown, max = 10000) {
    if (typeof v !== 'string' || !v.trim() || v.length > max)
        throw new Error('Invalid text');
    return v;
}
export function validatePayload(channel: string, value: unknown) {
    const p = record(value);
    const keys: Record<string, string[]> = { openExternal: ['url'], testConnector: ["connectorId", "mode", "baseUrl", "key"], listConnectors: [], detectConnector: ['id'], startConnectorLogin: ['id'], listConnectorModels: ['id'], configureConnector: ['pricingSource','connectorId','mode','baseUrl','model','prices','limits'], getStatus: [], retryStartup: [], openBoard: [], acceptReview: ['issueId'], createCompany: ['name'], createAgentFromTemplate: ['templateId', 'provider'], setProviderKey: ['key'], setSpendCap: ['cap'], setPaidExecution: ['enabled', 'consent'], runTask: ['title', 'description'], listRuns: [], getTelemetry: [], setTelemetry: ['enabled'] };
    if (!keys[channel] || Object.keys(p).some(k => !keys[channel].includes(k)))
        throw new Error('Unknown channel or payload field');
    switch (channel) {
        case 'openExternal':
            if (!isAllowedExternalUrl(p.url)) throw new Error('External URL is not allowed');
            return { url: p.url };
        case 'detectConnector': case 'startConnectorLogin': case 'listConnectorModels':
            if (!['custom','openrouter','deepseek','hermes','codex','claude'].includes(String(p.id))) throw new Error('Unknown connector');
            return p;
        case 'testConnector': {
            validatePayload('detectConnector', { id: p.connectorId });
            if (!['api','api-key','cli-subscription'].includes(String(p.mode))) throw new Error('Invalid mode');
            if (p.key !== undefined) text(p.key, 8192);
            if (p.baseUrl !== undefined) { const u = new URL(text(p.baseUrl)); if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1'))) throw new Error('Unsafe URL'); }
            return p;
        }
        case 'configureConnector': {
            if (p.pricingSource !== undefined && !['catalog','user'].includes(String(p.pricingSource))) throw new Error('Invalid pricing source');
            validatePayload('detectConnector', { id: p.connectorId });
            if (!['api','api-key','cli-subscription'].includes(String(p.mode))) throw new Error('Invalid mode');
            if (typeof p.model !== 'string' || p.model.length > 200 || (p.mode !== 'cli-subscription' && !p.model.trim())) throw new Error('Invalid model');
            if (p.baseUrl !== undefined) { const u = new URL(text(p.baseUrl)); if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1'))) throw new Error('Unsafe URL'); }
            for (const [name, allowed] of [['prices',['inputCentsPerMTok','outputCentsPerMTok']], ['limits',['maxOutputTokens','maxRunCents','monthlyRunCap','cliTimeoutSec']]] as const) {
                if (name === 'prices' && p[name] === undefined) continue;
                const values = record(p[name]);
                if (Object.keys(values).some(k => !(allowed as readonly string[]).includes(k)) || Object.values(values).some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) throw new Error('Invalid connector limits');
            }
            return p;
        }
        case 'acceptReview': return { issueId: text(p.issueId, 200) };
        case 'createCompany': return { name: text(p.name, 200) };
        case 'setProviderKey': return { key: text(p.key, 8192) };
        case 'setSpendCap': return { cap: parseCap(p.cap) };
        case 'runTask': return { title: text(p.title, 300), description: text(p.description, 50000) };
        case 'setPaidExecution':
            if (typeof p.enabled !== 'boolean' || typeof p.consent !== 'boolean')
                throw new Error('Expected boolean');
            return p;
        case 'setTelemetry':
            if (typeof p.enabled !== 'boolean')
                throw new Error('Expected boolean');
            return p;
        case 'createAgentFromTemplate': {
            text(p.templateId, 100);
            if (p.provider === undefined) return p;
            const c = record(p.provider);
            if (Object.keys(c).some(k => !['baseUrl','model','inputCentsPerMTok','outputCentsPerMTok','maxOutputTokens','maxRunCents'].includes(k))) throw new Error('Unknown provider field');
            const u = new URL(text(c.baseUrl));
            if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1'))
                throw new Error('Provider URL must use HTTPS or loopback HTTP');
            if (u.username || u.password || u.search || u.hash)
                throw new Error('Invalid provider URL');
            text(c.model, 200);
            for (const key of ['inputCentsPerMTok', 'outputCentsPerMTok', 'maxOutputTokens', 'maxRunCents'])
                if (typeof c[key] !== 'number' || !Number.isFinite(c[key]) || Number(c[key]) <= 0)
                    throw new Error('Invalid provider limits');
            if (!Number.isSafeInteger(c.maxOutputTokens))
                throw new Error('Invalid output limit');
            return p;
        }
        default: return {};
    }
}
