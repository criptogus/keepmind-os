import { it, expect, vi } from 'vitest';
import { createOpenRouter } from '../../src/main/connectors/openrouter';
it('converts USD per token and preserves unknown prices', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'paid', pricing: { prompt: '0.000001', completion: '0.000002' } }, ...['-1','0','bad',undefined].map(prompt => ({ id: String(prompt), pricing: { prompt, completion: '1' } }))] })));
    const models = await createOpenRouter(fetcher).models();
    expect(models[0]).toMatchObject({ priceKnown: true, inputCentsPerMTok: 100, outputCentsPerMTok: 200 });
    expect(models.slice(1).every(m => !m.priceKnown && m.inputCentsPerMTok === undefined)).toBe(true);
    expect(fetcher.mock.calls[0]).toBeDefined();
});

it('blocks activation when live pricing is unknown even with operator overrides', async () => {
    const { buildConfig, createRegistry } = await import('../../src/main/connectors/registry');
    const connectors = createRegistry(async () => Response.json({ data: [{ id: 'router', pricing: { prompt: '-1', completion: '1' } }] }));
    await expect(buildConfig({ connectorId: 'openrouter', mode: 'api', model: 'router', prices: { inputCentsPerMTok: 10, outputCentsPerMTok: 20 }, limits: { maxOutputTokens: 100, maxRunCents: 1 } }, connectors)).rejects.toThrow('prices');
});
it('uses bounded diagnostics without raw provider bodies or transport errors', async () => {
    for (const fetcher of [async () => new Response('private raw body', { status: 500 }), async () => { throw new Error('private key'); }]) {
        await expect(createOpenRouter(fetcher).models()).rejects.toThrow('Connector model discovery failed');
    }
});
