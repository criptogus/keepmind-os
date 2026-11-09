import { it, expect } from 'vitest';
import { HERMES_DEFAULT_BASE_URL } from '../../src/main/connectors/hermes';
import { buildConfig } from '../../src/main/connectors/registry';
import { assertPaidRequirements } from '../../src/main/spend-guard';
it('allows a keyless gateway with explicit prices without probing the default', async () => {
    expect(HERMES_DEFAULT_BASE_URL).toBe('http://127.0.0.1:8642/v1');
    const config = await buildConfig({ connectorId: 'hermes', mode: 'api', model: 'm', prices: { inputCentsPerMTok: 1, outputCentsPerMTok: 1 }, limits: { maxOutputTokens: 100, maxRunCents: 1 } });
    expect(() => assertPaidRequirements(config, false, 100, true)).not.toThrow();
    expect(() => assertPaidRequirements(config, false, 0, true)).toThrow();
});
