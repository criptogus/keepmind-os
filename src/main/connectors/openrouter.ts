import type { ProviderConnector } from './port';
// https://openrouter.ai/docs/api-reference/models/get-models
export function createOpenRouter(fetcher: typeof fetch = fetch): ProviderConnector {
    return { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', detect: async () => ({ installed: true, loggedIn: false }), models: async () => {
        try {
            const r = await fetcher('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10000), redirect: 'error' });
            if (!r.ok) throw new Error();
            const body = await r.json();
            if (!Array.isArray(body.data)) throw new Error();
            return body.data.filter((m: any) => typeof m.id === 'string').map((m: any) => {
                const input = typeof m.pricing?.prompt === 'string' ? Number(m.pricing.prompt) * 1e8 : NaN;
                const output = typeof m.pricing?.completion === 'string' ? Number(m.pricing.completion) * 1e8 : NaN;
                const priceKnown = [input, output].every(n => Number.isFinite(n) && n > 0);
                return { id: m.id, name: typeof m.name === 'string' ? m.name : m.id, priceKnown, ...(priceKnown ? { inputCentsPerMTok: input, outputCentsPerMTok: output } : {}), contextLength: m.context_length, maxOutputTokens: m.top_provider?.max_completion_tokens };
            });
        } catch { throw new Error('Connector model discovery failed'); }
    } };
}
