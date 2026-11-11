import { safeStorage } from 'electron';
import type { OAuthTokens } from './OAuthManager.js';

/**
 * Persists API keys and OAuth tokens encrypted via Electron safeStorage
 * (macOS Keychain / Windows DPAPI / Linux libsecret). Values live in the
 * SQLite settings table as base64 ciphertext — never plaintext when OS
 * encryption is available. Falls back to a 'plain:' prefix only when the OS
 * offers no encryption (rare dev environments).
 */

interface SettingsStore {
  getSetting(key: string): string | null | undefined;
  setSetting(key: string, value: string): void;
  deleteSetting?(key: string): void;
}

type Provider = 'openai' | 'anthropic';

const keyFor = (kind: 'apikey' | 'oauth' | 'secret', name: string) => `cred.${kind}.${name}`;

function encrypt(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  }
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64');
}

function decrypt(stored: string): string | null {
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

export class CredentialStore {
  constructor(private storage: SettingsStore) {}

  // ---- API keys ----

  getApiKey(provider: Provider): string | null {
    const stored = this.storage.getSetting(keyFor('apikey', provider));
    if (!stored) return null;
    return decrypt(stored);
  }

  setApiKey(provider: Provider, key: string): void {
    this.storage.setSetting(keyFor('apikey', provider), encrypt(key));
  }

  clearApiKey(provider: Provider): void {
    this.storage.setSetting(keyFor('apikey', provider), '');
  }

  hasApiKey(provider: Provider): boolean {
    return !!this.getApiKey(provider);
  }

  // ---- OAuth tokens ----

  getOAuth(provider: Provider): OAuthTokens | null {
    const stored = this.storage.getSetting(keyFor('oauth', provider));
    if (!stored) return null;
    const plain = decrypt(stored);
    if (!plain) return null;
    try {
      return JSON.parse(plain) as OAuthTokens;
    } catch {
      return null;
    }
  }

  setOAuth(provider: Provider, tokens: OAuthTokens): void {
    this.storage.setSetting(keyFor('oauth', provider), encrypt(JSON.stringify(tokens)));
  }

  clearOAuth(provider: Provider): void {
    this.storage.setSetting(keyFor('oauth', provider), '');
  }

  hasOAuth(provider: Provider): boolean {
    const t = this.getOAuth(provider);
    return !!t?.accessToken;
  }

  // ---- Generic secrets (e.g. second-brain token) ----

  getSecret(name: string): string | null {
    const stored = this.storage.getSetting(keyFor('secret', name));
    if (!stored) return null;
    return decrypt(stored);
  }

  setSecret(name: string, value: string): void {
    this.storage.setSetting(keyFor('secret', name), encrypt(value));
  }

  clearSecret(name: string): void {
    this.storage.setSetting(keyFor('secret', name), '');
  }

  hasSecret(name: string): boolean {
    return !!this.getSecret(name);
  }
}
