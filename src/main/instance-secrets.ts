import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Encryptor } from '../shared/types';
export const secretNames = ['BETTER_AUTH_SECRET', 'PAPERCLIP_AGENT_JWT_SECRET', 'PAPERCLIP_TOOL_ACTION_SIGNING_SECRET'] as const;
export async function readEncrypted<T>(path: string, e: Encryptor): Promise<T | undefined> {
    try {
        return JSON.parse(e.decrypt(await readFile(path, 'utf8'))) as T;
    }
    catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT')
            return undefined;
        throw new Error('Cannot decrypt local credentials');
    }
}
export async function writeEncrypted(path: string, value: unknown, e: Encryptor) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, e.encrypt(JSON.stringify(value)), { mode: 0o600 });
    await chmod(path, 0o600);
}
export async function instanceSecrets(userData: string, e: Encryptor) {
    const path = join(userData, 'zaos/instance-secrets.json');
    let secrets = await readEncrypted<Record<typeof secretNames[number], string>>(path, e);
    if (!secrets) {
        secrets = Object.fromEntries(secretNames.map(n => [n, randomBytes(32).toString('hex')])) as Record<typeof secretNames[number], string>;
        await writeEncrypted(path, secrets, e);
    }
    for (const n of secretNames)
        if (!/^[a-f0-9]{64}$/.test(secrets![n]))
            throw new Error('Invalid instance secret');
    return secrets!;
}
