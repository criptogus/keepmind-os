import { it, expect } from 'vitest';
import { deepseek } from '../../src/main/connectors/deepseek';
import { estimateRunCents } from '../../src/main/connectors/port';
it('uses dated peak rates and conservative estimates', async () => {
    const models = await deepseek.models();
    expect(models.map(m => [m.inputCentsPerMTok,m.outputCentsPerMTok])).toEqual([[30,120],[132,396]]);
    expect(models[0].pricesRetrievedAt).toBe('2026-11-09');
    expect(estimateRunCents({ connectorId: 'deepseek', mode: 'api', priceKnown: true, baseUrl: deepseek.baseUrl!, model: models[0].id, inputCentsPerMTok: 30, outputCentsPerMTok: 120, maxOutputTokens: 100, maxRunCents: 1 }, 300)).toBe(0.015);
});
