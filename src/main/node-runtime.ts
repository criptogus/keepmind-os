import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
export { withNodePath } from '../runner/node-path.mjs';
import { withNodePath } from '../runner/node-path.mjs';
export function verifyNodeVersion(version: string) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    if (!m || Number(m[1]) < 24 || (Number(m[1]) === 24 && Number(m[2]) < 11))
        throw new Error('KeepMind OS requires Node >= 24.11.0; check the bundled runtime or set ZAOS_NODE_BINARY to a compatible Node binary');
    return version.trim();
}
export async function resolveNode(env: NodeJS.ProcessEnv = process.env, verify = (binary: string) => new Promise<string>((resolve, reject) => execFile(binary, ['--version'], { timeout: 10000 }, (e, out) => e ? reject(new Error('Unable to run Node; check the bundled runtime or set ZAOS_NODE_BINARY')) : resolve(out.trim()))), options: { packaged?: boolean; resourcesPath?: string; platform?: NodeJS.Platform; exists?: (path: string) => boolean } = {}) {
    const platform = options.platform ?? process.platform;
    const paths = platform === 'win32' ? win32 : posix;
    const bundled = options.packaged && options.resourcesPath
        ? paths.join(options.resourcesPath, 'node', ...(platform === 'win32' ? ['node.exe'] : ['bin', 'node'])) : undefined;
    const binary = env.ZAOS_NODE_BINARY || (bundled && (options.exists ?? existsSync)(bundled) ? bundled : 'node');
    const version = verifyNodeVersion(await verify(binary));
    return { binary, version, ...((env.ZAOS_NODE_BINARY || binary === bundled) ? { nodeDir: paths.dirname(paths.resolve(binary)) } : {}) };
}

// Share one startup resolution with connector probes and the supervisor.
let startupNode: ReturnType<typeof resolveNode> | undefined;
export function initializeNodeRuntime(options: Parameters<typeof resolveNode>[2]) {
    startupNode ??= resolveNode(process.env, undefined, options);
    // Connector detection remains available even when runtime verification fails.
    void startupNode.catch(() => {});
    return startupNode;
}
export async function cliEnvironment(env: NodeJS.ProcessEnv = process.env) {
    const node = await startupNode?.catch(() => undefined);
    return withNodePath(env, node?.nodeDir);
}
