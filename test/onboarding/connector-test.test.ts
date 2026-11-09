import { describe, it, expect, vi } from 'vitest';
import { testConnector } from '../../src/main/connectors/test';
import { validatePayload } from '../../src/main/ipc-validation';
describe('transient, unpaid connector tests', () => {
 it('only GETs models with injected fetch and optional transient Bearer', async () => {
  const fetcher = vi.fn(async (url, init) => { expect(String(url)).not.toMatch(/:(8642|3000)\b/); expect(url).toBe('https://example.test/v1/models'); expect(init.method).toBe('GET'); expect(init.redirect).toBe('error'); expect(init.headers.Authorization).toBe('Bearer secret'); expect(init.signal).toBeInstanceOf(AbortSignal); return new Response(JSON.stringify({ data: [{ id: 'one' }] })); });
  expect(await testConnector({ connectorId: 'custom', mode: 'api', baseUrl: 'https://example.test/v1', key: 'secret' }, fetcher as typeof fetch)).toEqual({ ok: true, models: 1 });
 });
 it('Hermes never contacts its real port: all fetches injected', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
  expect(await testConnector({ connectorId: 'hermes', mode: 'api', baseUrl: 'http://127.0.0.1:49152/v1' }, fetcher as typeof fetch)).toEqual({ ok: true, models: 0 });
  expect(fetcher.mock.calls).toHaveLength(1);
 });
 it('returns bounded codes without provider bodies or credentials', async () => {
  for (const [fetcher, error] of [[async () => new Response('secret raw body', { status: 401 }), 'http'], [async () => new Response('{}'), 'invalid-response'], [async () => { throw new Error('secret'); }, 'unavailable']] as const) expect(await testConnector({ connectorId: 'custom', mode: 'api', baseUrl: 'https://example.test' }, fetcher as typeof fetch)).toEqual({ ok: false, error });
 });
 it('CLI detection does not call fetch', async () => {
  const fetcher = vi.fn(); expect((await testConnector({ connectorId: 'codex', mode: 'cli-subscription' }, fetcher, async () => ({ installed: true, loggedIn: true }))).ok).toBe(true); expect(fetcher).not.toHaveBeenCalled();
 });
 it('validates URL, mode, extra fields and key length at the IPC boundary', () => {
  for (const patch of [{ baseUrl: 'http://evil.test' }, { baseUrl: 'https://user:pass@example.test' }, { mode: 'bad' }, { key: 'x'.repeat(8193) }, { token: 'bad' }]) expect(() => validatePayload('testConnector', { connectorId: 'custom', mode: 'api', ...patch })).toThrow();
  expect(() => validatePayload('createAgentFromTemplate', { templateId: 'researcher' })).not.toThrow();
 });
});
