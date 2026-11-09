import { createServer } from 'node:net';
export const excludedPorts = new Set([3000, 3100, 8642, 8787, 8794]);
export async function probePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const a = s.address();
            s.close(err => err ? reject(err) : resolve(typeof a === 'object' && a ? a.port : 0));
        });
    });
}
// A port is available at probe time only; server startup must handle a later bind race.
export async function pickPort(probe = probePort, exclude: ReadonlySet<number> = excludedPorts) {
    for (let i = 0; i < 100; i++) {
        const p = await probe();
        if (Number.isInteger(p) && p > 0 && p <= 65535 && !exclude.has(p))
            return p;
    }
    throw new Error('No free loopback port found');
}
export async function pickPorts(probe = probePort) {
    const server = await pickPort(probe);
    const postgres = await pickPort(probe, new Set([...excludedPorts, server]));
    return { server, postgres };
}
