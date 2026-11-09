import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runtimePaths } from '../src/main/paths';
import { registerIpc, channels } from '../src/main/ipc';
import { selectEncryptor } from '../src/main/encryption';
import { monthlyUsdToCents } from '../src/renderer/amount';
import type { ZaosAPI } from '../src/shared/types';

it('resolves runner and Paperclip outside asar for external Node, retaining owned assets inside', () => {
    const dev = runtimePaths('/repo', false);
    expect(dev.entry).toBe('/repo/node_modules/paperclipai/dist/index.js');
    expect(dev.runner).toBe('/repo/src/runner/zaos-runner.mjs');
    const packaged = runtimePaths('/Applications/Zero.app/Contents/Resources/app.asar', true);
    expect(packaged.entry).toBe('/Applications/Zero.app/Contents/Resources/app.asar.unpacked/node_modules/paperclipai/dist/index.js');
    expect(packaged.runner).toContain('app.asar.unpacked/src/runner/');
    expect(packaged.preload).toContain('app.asar/dist/main/preload.cjs');
    expect(packaged.renderer).toContain('app.asar/dist/renderer/index.html');
});
it('keeps board identity neutral and independent of the owned design system', async () => {
    const css = await readFile('assets/paperclip-identity.css', 'utf8');
    expect(css).not.toMatch(/#c8ff00|astryx|xds-|zero-agency-os|\.za-/i);
    expect(css).toContain('Inter, Arial, sans-serif');
    expect(css).toContain('outline: 2px solid #0A0A0A');
    expect(css).toContain('outline-offset: 3px');
    expect(css).toContain('border-radius: 12px');
});
describe('IPC registration', () => {
    function setup() {
        const handlers = new Map<string, (event: any, value: unknown) => any>();
        const frame = { url: 'file:///app/dist/renderer/index.html' }, contents = {};
        const api = Object.fromEntries(channels.map(c => [c, vi.fn().mockResolvedValue({ ok: true })])) as unknown as ZaosAPI;
        registerIpc({ handle: (name, fn) => handlers.set(name, fn) }, api, { url: frame.url, contents, mainFrame: () => frame });
        return { handlers, frame, contents, api, invoke: (name: string, payload: unknown) => handlers.get(`zaos:${name}`)!({ sender: contents, senderFrame: frame }, payload) };
    }
    it('registers the narrow contract and dispatches validated arguments', async () => {
        const { handlers, invoke, api } = setup();
        expect(handlers.size).toBe(channels.length);
        await invoke('createCompany', { name: 'Fictional studio' });
        expect(api.createCompany).toHaveBeenCalledWith('Fictional studio');
        await invoke('runTask', { title: 'Research', description: 'Draft a brief' });
        expect(api.runTask).toHaveBeenCalledWith('Research', 'Draft a brief');
        await invoke('acceptReview', { issueId: 'issue' });
        expect(api.acceptReview).toHaveBeenCalledWith('issue');
        await invoke('openExternal', { url: 'https://zeroagency.ai' });
        expect(api.openExternal).toHaveBeenCalledWith('https://zeroagency.ai');
        await expect(invoke('openExternal', { url: 'https://zeroagency.ai.evil.com' })).rejects.toThrow();
        await invoke('openBoard', {});
        expect(api.openBoard).toHaveBeenCalledWith();
    });
    it('rejects other windows, subframes, remote URLs and malformed payloads before dispatch', async () => {
        const { handlers, frame, contents, invoke, api } = setup();
        const handle = handlers.get('zaos:setSpendCap')!;
        for (const event of [
            { sender: {}, senderFrame: frame },
            { sender: contents, senderFrame: { url: frame.url } },
            { sender: contents, senderFrame: null },
        ]) await expect(handle(event, { cap: 100 })).rejects.toThrow('Unauthorized');
        frame.url = 'http://127.0.0.1:50000/';
        await expect(handle({ sender: contents, senderFrame: frame }, { cap: 100 })).rejects.toThrow('Unauthorized');
        expect(api.setSpendCap).not.toHaveBeenCalled();
        const valid = setup();
        await expect(valid.invoke('setSpendCap', { cap: 0 })).rejects.toThrow();
        await expect(valid.invoke('openBoard', { url: 'https://invalid.example' })).rejects.toThrow();
        await expect(valid.invoke('acceptReview', {})).rejects.toThrow();
        await expect(valid.invoke('setPaidExecution', { enabled: true, consent: 'yes' })).rejects.toThrow();
        expect(valid.api.setPaidExecution).not.toHaveBeenCalled();
    });
});
it('fails closed without OS encryption, permitting only an explicitly logged Linux smoke fallback', () => {
    const storage = { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => v.toString() };
    const log = vi.fn();
    for (const [platform, smoke] of [['linux', false], ['darwin', true], ['win32', true]] as const)
        expect(() => selectEncryptor(storage, platform, smoke, log)).toThrow('encryption is unavailable');
    const test = selectEncryptor(storage, 'linux', true, log);
    expect(test.decrypt(test.encrypt('fictional'))).toBe('fictional');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('TEST-ONLY'));
    expect(() => selectEncryptor({ ...storage, isEncryptionAvailable: () => true }, 'linux', false, log)).toThrow();
    const secure = selectEncryptor({ ...storage, isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret' }, 'linux', false, log);
    expect(secure.decrypt(secure.encrypt('fictional'))).toBe('fictional');
});
it('converts decimal USD without floating point rounding errors and rejects invalid caps', () => {
    expect(monthlyUsdToCents('0.29')).toBe(29);
    expect(monthlyUsdToCents('1.2')).toBe(120);
    expect(monthlyUsdToCents('1000.00')).toBe(100000);
    for (const value of ['0', '-1', 'NaN', '1.001', '1000.01', 'Infinity', '']) expect(() => monthlyUsdToCents(value)).toThrow();
});
