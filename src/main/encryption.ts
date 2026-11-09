import type { Encryptor } from '../shared/types';
export function selectEncryptor(storage: { isEncryptionAvailable(): boolean; getSelectedStorageBackend(): string; encryptString(value: string): Buffer; decryptString(value: Buffer): string }, platform: string, smoke: boolean, log: (message: string) => void): Encryptor {
    if (storage.isEncryptionAvailable() && !(platform === 'linux' && storage.getSelectedStorageBackend() === 'basic_text')) return {
        encrypt: value => storage.encryptString(value).toString('base64'),
        decrypt: value => storage.decryptString(Buffer.from(value, 'base64')),
    };
    if (smoke && platform === 'linux') {
        log('ZAOS_SMOKE: TEST-ONLY encryptor enabled; never use real credentials.');
        return { encrypt: v => Buffer.from(v).toString('base64'), decrypt: v => Buffer.from(v, 'base64').toString() };
    }
    throw new Error('Secure credential encryption is unavailable. Enable the OS keychain or secret service and restart KeepMind OS.');
}
