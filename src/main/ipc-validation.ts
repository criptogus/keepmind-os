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
    const keys: Record<string, string[]> = { getStatus: [], retryStartup: [], openBoard: [], acceptReview: ['issueId'], createCompany: ['name'], createAgentFromTemplate: ['templateId', 'provider'], setProviderKey: ['key'], setSpendCap: ['cap'], setPaidExecution: ['enabled', 'consent'], runTask: ['title', 'description'], listRuns: [], getTelemetry: [], setTelemetry: ['enabled'] };
    if (!keys[channel] || Object.keys(p).some(k => !keys[channel].includes(k)))
        throw new Error('Unknown channel or payload field');
    switch (channel) {
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
            const c = record(p.provider);
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
