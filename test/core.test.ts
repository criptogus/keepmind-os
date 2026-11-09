import { describe, it, expect, vi } from 'vitest';
import { parseCap, SpendGuard } from '../src/main/spend-guard';
import { createConfig } from '../src/main/paperclip-config';
import { hardenAdapterConfig, validateAdapter } from '../src/main/adapter-guard';
import { verifyNodeVersion } from '../src/main/node-runtime';
import { validateSender, validatePayload } from '../src/main/ipc-validation';
import { templates } from '../src/main/templates';
describe('spend policy', () => {
    it.each([0, -1, 1.5, NaN, 100001, Infinity])('rejects unsafe cap %s', v => expect(() => parseCap(v)).toThrow());
    it('accepts integer cents', () => expect(parseCap(100)).toBe(100));
    it('never sends zero; disabling pauses; audit fails closed', async () => {
        const api = { request: vi.fn().mockResolvedValue({ policies: [] }) };
        const g = new SpendGuard(api, 'c');
        await expect(g.applyAgentCap('a', 0, 1)).rejects.toThrow();
        expect(api.request).not.toHaveBeenCalled();
        await g.disable('a');
        expect(api.request).toHaveBeenCalledWith('POST', '/api/agents/a/pause', {});
        expect(await g.startupAudit(['a'])).toEqual(['a']);
    });
    it('requires priced ZAOS receipt before adjustment', async () => {
        const api = { request: vi.fn().mockResolvedValue({ events: [{ id: 'u', runId: 'r', agentId: 'a', costStatus: 'unpriced' }] }) };
        const g = new SpendGuard(api, 'c');
        expect(await g.reconcileRun('r')).toBe('unknown cost');
        expect(api.request.mock.calls.every(c => c[0] === 'GET')).toBe(true);
    });
});
it('config is private authenticated loopback with telemetry disabled', () => {
    const c = createConfig('/tmp/x', 42000, 42001);
    expect(c.server).toMatchObject({ deploymentMode: 'authenticated', exposure: 'private', bind: 'loopback', host: '127.0.0.1' });
    expect(c.telemetry.enabled).toBe(false);
    expect(c.updates.checkEnabled).toBe(false);
});
it('guards adapters', () => {
    expect(hardenAdapterConfig('codex_local', {})).toMatchObject({ dangerouslyBypassApprovalsAndSandbox: false });
    expect(() => hardenAdapterConfig('claude_local', { dangerouslySkipPermissions: true })).toThrow();
    expect(() => validateAdapter('codex_local', {})).toThrow();
});
it('requires modern node', () => {
    expect(() => verifyNodeVersion('v24.10.0')).toThrow();
    expect(verifyNodeVersion('v24.11.0')).toBe('v24.11.0');
    expect(verifyNodeVersion('v25.0.0')).toBe('v25.0.0');
});
it('validates sender and payload', () => {
    expect(validateSender({ url: 'file:///app/index.html', isMainFrame: true }, 'file:///app/index.html')).toBe(true);
    expect(validateSender({ url: 'file:///app/index.html#evil', isMainFrame: false }, 'file:///app/index.html')).toBe(false);
    expect(() => validatePayload('setSpendCap', { cap: 0 })).toThrow();
    expect(validatePayload('runTask', { title: 'Task', description: 'Text' })).toEqual({ title: 'Task', description: 'Text' });
});
it('provides three human governed templates', () => expect(templates.map(t => t.role)).toEqual(['researcher', 'general', 'cmo']));
it.each(['https://attacker.invalid', 'file:///app/other.html', 'file:///app/index.html?x=1'])('rejects foreign sender %s', url => expect(validateSender({ url, isMainFrame: true }, 'file:///app/index.html')).toBe(false));
it.each([['setPaidExecution', { enabled: true, consent: 'true' }], ['runTask', { title: '', description: 'task' }], ['setSpendCap', { cap: 1, command: 'evil' }], ['unknown', {}]])('rejects invalid IPC %s', (channel, payload) => expect(() => validatePayload(channel as string, payload)).toThrow());
