import { execFile } from 'node:child_process';
export function verifyNodeVersion(version: string) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    if (!m || Number(m[1]) < 24 || (Number(m[1]) === 24 && Number(m[2]) < 11))
        throw new Error('KeepMind OS requires Node >= 24.11.0; set ZAOS_NODE_BINARY to a compatible Node binary');
    return version.trim();
}
export async function resolveNode(env: NodeJS.ProcessEnv = process.env, verify = (binary: string) => new Promise<string>((resolve, reject) => execFile(binary, ['--version'], { timeout: 10000 }, (e, out) => e ? reject(new Error('Unable to run Node; set ZAOS_NODE_BINARY')) : resolve(out.trim())))) {
    const binary = env.ZAOS_NODE_BINARY || 'node';
    const version = verifyNodeVersion(await verify(binary));
    return { binary, version };
}
