import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
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
    return { binary, version, ...(binary === bundled ? { nodeDir: paths.dirname(binary) } : {}) };
}

// Preserve all existing environment entries; Windows PATH keys are case insensitive.
export function withNodePath(env: NodeJS.ProcessEnv, nodeDir?: string, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
    if (!nodeDir) return env;
    const key = platform === 'win32' ? Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH' : 'PATH';
    return { ...env, [key]: nodeDir + (env[key] ? (platform === 'win32' ? ';' : ':') + env[key] : '') };
}
