import { assertPaidRequirements } from '../../src/main/spend-guard';
import { buildConfig } from '../../src/main/connectors/registry';
import { it, expect } from 'vitest';
import { validateBaseUrl } from '../../src/main/connectors/port';
import { validatePayload } from '../../src/main/ipc-validation';
it('accepts only safe provider URLs and rejects nested process injection', () => {
    for (const url of ['https://example.com/v1','http://127.0.0.1:42000/v1']) expect(validateBaseUrl(url)).toBe(url);
    for (const url of ['http://localhost/v1','http://example.com','https://u:p@example.com','https://example.com?q=1','https://example.com#x']) expect(() => validateBaseUrl(url)).toThrow();
    for (const field of ['command','env','path','args','binary']) expect(() => validatePayload('configureConnector', { connectorId: 'custom', mode: 'api', model: 'm', prices: { inputCentsPerMTok: 1, outputCentsPerMTok: 1, [field]: 'bad' }, limits: {} })).toThrow();
});

it.each(['custom','openrouter','deepseek','hermes','codex','claude'] as const)('rejects budget zero for %s', id => {
    expect(() => assertPaidRequirements({ connectorId: id, mode: 'api', priceKnown: true, baseUrl: 'https://example.com', model: 'm', inputCentsPerMTok: 1, outputCentsPerMTok: 1, maxOutputTokens: 1, maxRunCents: 1 }, true, 0, true)).toThrow();
});
it('never invents custom prices', async () => {
    await expect(buildConfig({ connectorId: 'custom', mode: 'api', baseUrl: 'https://example.com', model: 'm', limits: { maxOutputTokens: 100, maxRunCents: 1 } })).rejects.toThrow('prices');
});
