import { it, expect, vi } from 'vitest';
import { resolveNode, withNodePath } from '../src/main/node-runtime';

it.each([
    ['linux', '/resources', '/resources/node/bin/node'],
    ['darwin', '/resources', '/resources/node/bin/node'],
    ['win32', 'C:\\resources', 'C:\\resources\\node\\node.exe'],
] as const)('selects and verifies packaged %s Node', async (platform, resourcesPath, binary) => {
    const verify = vi.fn().mockResolvedValue('v24.22.2');
    const exists = vi.fn().mockReturnValue(true);
    expect(await resolveNode({}, verify, { packaged: true, resourcesPath, platform, exists })).toMatchObject({ binary, version: 'v24.22.2' });
    expect(exists).toHaveBeenCalledWith(binary);
    expect(verify).toHaveBeenCalledWith(binary);
});
it('prefers the override over an existing bundle', async () => {
    const exists = vi.fn().mockReturnValue(true);
    expect(await resolveNode({ ZAOS_NODE_BINARY: '/override' }, async () => 'v24.11.0', { packaged: true, resourcesPath: '/r', exists })).toEqual({ binary: '/override', version: 'v24.11.0', nodeDir: '/' });
    expect(exists).not.toHaveBeenCalled();
});
it.each([false, true])('uses PATH in development or with a missing bundle (packaged=%s)', async packaged => {
    expect(await resolveNode({}, async () => 'v24.11.0', { packaged, resourcesPath: '/r', exists: () => false })).toEqual({ binary: 'node', version: 'v24.11.0' });
});
it.each(['v24.10.9', 'v22.22.0', 'invalid'])('rejects incompatible bundled Node %s', async version => {
    await expect(resolveNode({}, async () => version, { packaged: true, resourcesPath: '/r', exists: () => true })).rejects.toThrow('bundled runtime');
});
it('preserves verification failures', async () => {
    await expect(resolveNode({}, async () => { throw new Error('cannot execute'); })).rejects.toThrow('cannot execute');
});
it('prepends child PATH without changing other environment entries', () => {
    const env = { PATH: '/usr/bin', SECRET: 'unchanged' };
    expect(withNodePath(env, '/r/node/bin', 'linux')).toEqual({ PATH: '/r/node/bin:/usr/bin', SECRET: 'unchanged' });
    expect(env.PATH).toBe('/usr/bin');
    expect(withNodePath(env)).toBe(env);
    expect(withNodePath({ Path: 'C:\\Windows', OTHER: 'yes' }, 'C:\\r\\node', 'win32')).toEqual({ Path: 'C:\\r\\node;C:\\Windows', OTHER: 'yes' });
    expect(withNodePath({}, '/r/node/bin', 'linux')).toEqual({ PATH: '/r/node/bin' });
});
