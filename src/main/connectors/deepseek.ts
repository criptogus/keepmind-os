import type { ProviderConnector } from './port';
// Retrieved 2026-11-09: https://api-docs.deepseek.com/quick_start/pricing
// PEAK cache-miss prices; off-peak is half. Flash served by DeepSeek-V4.1-Flash-1017.
export const deepseek: ProviderConnector = { id: 'deepseek', baseUrl: 'https://api.deepseek.com', detect: async () => ({ installed: true, loggedIn: false }), models: async () => [
    { id: 'deepseek-flash', name: 'DeepSeek Flash', priceKnown: true, inputCentsPerMTok: 30, outputCentsPerMTok: 120 },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', priceKnown: true, inputCentsPerMTok: 132, outputCentsPerMTok: 396 }
].map(m => ({ ...m, pricesRetrievedAt: '2026-11-09', pricingSource: 'https://api-docs.deepseek.com/quick_start/pricing' })) };
