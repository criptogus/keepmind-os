import { describe, it, expect, vi } from 'vitest';
import { isAllowedExternalUrl, openAllowedExternal } from '../src/main/external-url';
import { validatePayload } from '../src/main/ipc-validation';

describe('Powered by external URL allowlist', () => {
    it.each(['https://zeroagency.ai', 'https://zeroagency.ai/'])('opens %s', async url => {
        const open = vi.fn().mockResolvedValue(undefined);
        expect(isAllowedExternalUrl(url)).toBe(true);
        expect(validatePayload('openExternal', { url })).toEqual({ url });
        await openAllowedExternal(url, open);
        expect(open).toHaveBeenCalledExactlyOnceWith(url);
    });
    it.each(['http://zeroagency.ai', 'https://example.com', 'https://zeroagency.ai.evil.com',
        'https://zeroagency.ai/path', 'https://zeroagency.ai//', 'https://zeroagency.ai/?a=1',
        'https://zeroagency.ai/#section', 'https://zeroagency.ai:443', 'https://user@zeroagency.ai',
        'javascript:alert(1)', 'file:///tmp/test', '', null, undefined])('rejects %s without opening', async url => {
        const open = vi.fn();
        expect(isAllowedExternalUrl(url)).toBe(false);
        expect(() => validatePayload('openExternal', { url })).toThrow();
        await expect(openAllowedExternal(url, open)).rejects.toThrow('not allowed');
        expect(open).not.toHaveBeenCalled();
    });
});
