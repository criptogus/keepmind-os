import { describe, expect, it, vi } from 'vitest';
import { loadOptionalAdapter, optionalAdapterStatus, optionalPackages } from '../src/main/optional-adapters';

describe('optional adapters', () => {
    it.each(Object.keys(optionalPackages) as (keyof typeof optionalPackages)[])('loads %s only on demand', async feature => {
        const module = { sdk: true };
        const load = vi.fn().mockResolvedValue(module);
        expect(await loadOptionalAdapter(feature, load)).toEqual({ available: true, module });
        expect(load).toHaveBeenCalledWith(optionalPackages[feature]);
    });
    it('reports missing packages without throwing during status discovery', async () => {
        const load = vi.fn().mockRejectedValue(Object.assign(new Error('Missing'), { code: 'MODULE_NOT_FOUND' }));
        const status = await optionalAdapterStatus(load);
        for (const feature of Object.keys(optionalPackages)) {
            expect(status[feature]).toMatchObject({ available: false, message: expect.stringContaining('install') });
        }
    });
    it('handles a package whose transitive SDK cannot load', async () => {
        expect(await loadOptionalAdapter('cursorCloud', async () => { throw new Error('Missing @cursor/sdk'); }))
            .toMatchObject({ available: false, message: expect.stringContaining('@paperclipai/adapter-cursor-cloud') });
    });
});
