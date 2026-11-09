import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { BoardApi, Encryptor } from '../shared/types';
import { readEncrypted, writeEncrypted } from './instance-secrets';
export async function authenticateOperator(api: BoardApi, userData: string, encryptor: Encryptor, disableSignUp: () => Promise<void>) {
    const path = join(userData, 'zaos/operator.json');
    let credentials = await readEncrypted<{
        email: string;
        password: string;
        claimed?: boolean;
    }>(path, encryptor);
    if (!credentials) {
        credentials = { email: `operator-${randomBytes(8).toString('hex')}@zaos.local`, password: randomBytes(32).toString('hex') };
        await api.request('POST', '/api/auth/sign-up/email', { ...credentials, name: 'Zero Agency Operator' });
        await writeEncrypted(path, credentials, encryptor);
    }
    else
        await api.request('POST', '/api/auth/sign-in/email', { email: credentials.email, password: credentials.password });
    if (!credentials.claimed) {
        await api.request('POST', '/api/bootstrap/claim', {});
        credentials.claimed = true;
        await writeEncrypted(path, credentials, encryptor);
    }
    await disableSignUp();
}
