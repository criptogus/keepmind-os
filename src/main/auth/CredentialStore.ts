import { safeStorage } from 'electron';
import type { OAuthTokens } from './OAuthManager.js';

/**
 * Persists API keys and OAuth tokens encrypted via Electron safeStorage
 * (macOS Keychain / Windows DPAPI / Linux libsecret). Values live in the
 * SQLite settings table as base64 ciphertext — never plaintext when OS
 * encryption is available. Falls back to a 'plain:' prefix only when the OS
 * offers no encryption (rare dev environments).
 *
 * Reads go through an in-memory cache warmed once at startup with the
 * async safeStorage API — the sync decryptString/encryptString are
 * deprecated in Electron 45 and log a warning on every call.
 */

interface SettingsStore {
  getSetting(key: string): string | null | undefined;
  setSetting(key: string, value: string): void;
  deleteSetting?(key: string): void;
  getAllSettings?(): Record<string, string>;
}

type Provider = 'openai' | 'anthropic';

const keyFor = (kind: 'apikey' | 'oauth' | 'secret', name: string) => `cred.${kind}.${name}`;
const CRED_PREFIX = 'cred.';

function encode(plain: string): string {
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64');
}

/** Sync fallback for values written after warm() — deprecated API, warns once. */
function decryptSync(stored: string): string | null {
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
  /** setting key → decrypted plaintext (null = undecryptable). */
  private cache = new Map<string, string | null>();
  private warmed = false;
  private encAvailable: boolean | null = null;
  /** Serializes async encrypt+persist per key so writes can't land out of order. */
  private persistChain = new Map<string, Promise<void>>();
  /** Bumped on every write/clear so a stale persist can't resurrect a cleared key. */
  private writeGen = new Map<string, number>();
  private persistenceErrors = new Map<string, Error>();

  constructor(private storage: SettingsStore) {}

  private async encryptionAvailable(): Promise<boolean> {
    if (this.encAvailable === null) {
      this.encAvailable = await safeStorage.isAsyncEncryptionAvailable();
    }
    return this.encAvailable;
  }

  /**
   * Decrypt every stored credential once via the async API so the sync
   * getters never touch the deprecated decryptString. Call once at boot,
   * before the window loads.
   */
  async warm(): Promise<void> {
    await this.encryptionAvailable();
    const all = this.storage.getAllSettings?.() ?? {};
    await Promise.all(
      Object.entries(all)
        .filter(([k, v]) => k.startsWith(CRED_PREFIX) && v)
        .map(async ([k, v]) => {
          try {
            if (v.startsWith('enc:') && this.encAvailable) {
              const { result } = await safeStorage.decryptStringAsync(Buffer.from(v.slice(4), 'base64'));
              this.cache.set(k, result);
            } else {
              this.cache.set(k, decryptSync(v));
            }
          } catch {
            this.cache.set(k, null);
          }
        })
    );
    this.warmed = true;
  }

  private read(key: string): string | null {
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const stored = this.storage.getSetting(key);
    if (!stored) return null;
    if (this.warmed && this.cache.has(key)) return this.cache.get(key) ?? null;
    const plain = decryptSync(stored);
    if (this.warmed) this.cache.set(key, plain);
    return plain;
  }

  /**
   * Cache the plaintext synchronously (reads stay sync) and persist the
   * ciphertext asynchronously via the non-deprecated encryptStringAsync.
   * Writes to the same key are chained so ciphertext always matches the
   * newest value.
   */
  private write(key: string, plain: string): void {
    this.cache.set(key, plain);
    const gen = (this.writeGen.get(key) ?? 0) + 1;
    this.writeGen.set(key, gen);
    this.persistenceErrors.delete(key);
    const prev = this.persistChain.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      if (this.writeGen.get(key) !== gen) return;
      try {
        const stored = (await this.encryptionAvailable())
          ? 'enc:' + (await safeStorage.encryptStringAsync(plain)).toString('base64')
          : encode(plain);
        if (this.writeGen.get(key) === gen) { this.storage.setSetting(key, stored); this.persistenceErrors.delete(key); }
      } catch {
        // Retain the session credential, but never claim it survived a restart.
        if(this.writeGen.get(key)===gen)this.persistenceErrors.set(key,new Error('Could not persist credentials securely'));
      }
    });
    this.persistChain.set(key, next);
  }

  /** Await durable writes before reporting successful sign-in or quitting. */
  async flush(): Promise<void> {
    let writes: Promise<void>[];
    do { writes=[...this.persistChain.values()]; await Promise.all(writes); }
    while(writes.some((write,index)=>write!==[...this.persistChain.values()][index]) || writes.length!==this.persistChain.size);
    if(this.persistenceErrors.size)throw new Error('Could not persist credentials securely. This session may not survive restarting the app.');
  }

  // ---- API keys ----

  getApiKey(provider: Provider): string | null {
    return this.read(keyFor('apikey', provider));
  }

  setApiKey(provider: Provider, key: string): void {
    this.write(keyFor('apikey', provider), key);
  }

  private clear(key: string): void {
    this.writeGen.set(key, (this.writeGen.get(key) ?? 0) + 1);
    this.cache.delete(key);
    this.persistenceErrors.delete(key);
    this.storage.setSetting(key, '');
  }

  clearApiKey(provider: Provider): void {
    this.clear(keyFor('apikey', provider));
  }

  hasApiKey(provider: Provider): boolean {
    return !!this.getApiKey(provider);
  }

  // ---- OAuth tokens ----

  getOAuth(provider: Provider): OAuthTokens | null {
    const plain = this.read(keyFor('oauth', provider));
    if (!plain) return null;
    try {
      return JSON.parse(plain) as OAuthTokens;
    } catch {
      return null;
    }
  }

  setOAuth(provider: Provider, tokens: OAuthTokens): void {
    this.write(keyFor('oauth', provider), JSON.stringify(tokens));
  }

  clearOAuth(provider: Provider): void {
    this.clear(keyFor('oauth', provider));
  }

  hasOAuth(provider: Provider): boolean {
    const t = this.getOAuth(provider);
    return !!t?.accessToken;
  }

  // ---- Generic secrets (e.g. second-brain token) ----

  getSecret(name: string): string | null {
    return this.read(keyFor('secret', name));
  }

  setSecret(name: string, value: string): void {
    this.write(keyFor('secret', name), value);
  }

  clearSecret(name: string): void {
    this.clear(keyFor('secret', name));
  }

  hasSecret(name: string): boolean {
    return !!this.getSecret(name);
  }
}
