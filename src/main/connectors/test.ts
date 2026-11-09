import type { TestConnector, ConnectorTestResult, ConnectorId, ConnectorDetection } from '../../shared/types';
import { validatePayload } from '../ipc-validation';
import { registry, assertSubscription } from './registry';
export async function testConnector(payload: TestConnector, fetcher: typeof fetch = fetch, detect: (id: ConnectorId) => Promise<ConnectorDetection> = id => registry[id].detect()): Promise<ConnectorTestResult> {
    validatePayload('testConnector', payload);
    if (payload.mode === 'cli-subscription') {
        assertSubscription(payload.connectorId);
        try { const detection = await detect(payload.connectorId); return { ...detection, ok: detection.installed && detection.loggedIn }; } catch { return { ok: false, error: 'unavailable' }; }
    }
    const base = payload.baseUrl ?? registry[payload.connectorId].baseUrl;
    if (!base) return { ok: false, error: 'unavailable' };
    try {
        const response = await fetcher(`${base.replace(/\/$/, '')}/models`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: payload.key ? { Authorization: `Bearer ${payload.key}` } : {} });
        if (!response.ok) return { ok: false, error: 'http' };
        const body = await response.json();
        if (!Array.isArray(body.data)) return { ok: false, error: 'invalid-response' };
        return { ok: true, models: body.data.length };
    } catch { return { ok: false, error: 'unavailable' }; }
}
