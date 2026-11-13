import type { StorageManager } from '../storage/StorageManager.js';
import type { CredentialStore } from '../auth/CredentialStore.js';

export interface SecondBrainConfig {
  enabled: boolean;
  url: string; // e.g. http://127.0.0.1:8787
  token: string;
  /** 'read' blocks all writes (sb_append) even if the token allows them. */
  access: 'read' | 'write';
  /** When true, remember() rejects obvious personal identifiers (PII guard). */
  blockPii: boolean;
}

interface McpCallResponse {
  ok?: boolean;
  result?: unknown;
  error?: string;
  content?: Array<{ type: string; text?: string }>;
}

/** Obvious personal identifiers — CPF, BR mobile/landline, card numbers. Emails allowed (corporate addresses are legitimate). */
export function containsPii(text: string): boolean {
  return /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(text)          // CPF
    || /\b\d{2}\.\d{3}\.\d{3}-[\dXx]\b/.test(text)     // RG
    || /\(\d{2}\)\s?9?\d{4,5}-\d{4}/.test(text)          // (11) 99999-9999
    || /(?:\+?55\s?)?9?\d{2}\s?9?\d{4}-\d{4}/.test(text) // 11999999999 / +55 11 99999-9999
    || /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/.test(text) // card-like
    || /\b(?:ag(?:ência)?|cc|c\/c)\s*:?\s*\d{3,5}\b.{0,20}\b(?:c?c?\.?\s*)?\d{4,10}\b/i.test(text); // bank agency+account labeled
}

/**
 * Optional integration with KeepMind Corp (https://github.com/criptogus/keepmind-corp).
 * The corp server exposes POST /api/mcp/call for MCP tools such as
 * sb_search / sb_read / sb_append / sb_list. There is no sb_remember —
 * remember() maps to sb_append on the inbox capture file.
 */
export class SecondBrainManager {
  private storage: Pick<StorageManager,'getAllSettings'|'setSetting'>;
  private credentials?: Pick<CredentialStore,'getSecret'|'setSecret'|'hasSecret'>;
  private migrated = false;
  /** Optional LLM second-layer PII check (regex runs first regardless). */
  private piiJudge?: (text: string) => Promise<boolean>;

  constructor(storage: Pick<StorageManager,'getAllSettings'|'setSetting'>, credentials?: Pick<CredentialStore,'getSecret'|'setSecret'|'hasSecret'>) {
    this.storage = storage;
    this.credentials = credentials;
  }

  setPiiJudge(judge: (text: string) => Promise<boolean>): void {
    this.piiJudge = judge;
  }

  getConfig(): SecondBrainConfig {
    const s = this.storage.getAllSettings();
    // Migrate a legacy plaintext token into the encrypted credential store once.
    if (!this.migrated) {
      this.migrated = true;
      const legacy = s['secondbrain.token'] || '';
      if (legacy && this.credentials && !this.credentials.hasSecret('secondbrain')) {
        this.credentials.setSecret('secondbrain', legacy);
        this.storage.setSetting('secondbrain.token', '');
      }
    }
    const token = this.credentials?.getSecret('secondbrain')
      ?? (s['secondbrain.token'] || '');
    return {
      enabled: s['secondbrain.enabled'] === 'true',
      url: (s['secondbrain.url'] || '').replace(/\/$/, ''),
      token,
      access: s['secondbrain.access'] === 'read' ? 'read' : 'write',
      blockPii: s['secondbrain.blockPii'] !== 'false',
    };
  }

  setConfig(config: Partial<SecondBrainConfig>): void {
    if (config.enabled !== undefined) this.storage.setSetting('secondbrain.enabled', String(config.enabled));
    if (config.url !== undefined) this.storage.setSetting('secondbrain.url', config.url.replace(/\/$/, ''));
    if (config.token !== undefined) {
      if (this.credentials) {
        this.credentials.setSecret('secondbrain', config.token);
        this.storage.setSetting('secondbrain.token', '');
      } else {
        this.storage.setSetting('secondbrain.token', config.token);
      }
    }
    if (config.access !== undefined) this.storage.setSetting('secondbrain.access', config.access === 'read' ? 'read' : 'write');
    if (config.blockPii !== undefined) this.storage.setSetting('secondbrain.blockPii', config.blockPii ? 'true' : 'false');
  }

  isConfigured(): boolean {
    const c = this.getConfig();
    return c.enabled && c.url.length > 0 && c.token.length > 0;
  }

  private async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const { url, token } = this.getConfig();
    if (!url || !token) throw new Error('Second brain not configured');

    const res = await fetch(`${url}/api/mcp/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tool, arguments: args }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Second brain request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as McpCallResponse;
    if (data.error) throw new Error(String(data.error));
    return data.result ?? data.content ?? data;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string; tools?: unknown }> {
    try {
      const result = await this.call('sb_search', { query: 'ping', limit: 1 });
      return { ok: true, tools: result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async search(query: string, limit = 5): Promise<string> {
    try {
      const result = await this.call('sb_search', { query, limit });
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch {
      return '';
    }
  }

  /**
   * Writes to the CORPORATE brain. Blocked entirely in read mode; in write
   * mode a PII guard rejects obvious personal identifiers so personal data
   * never lands in the corporate vault (use the personal brain instead).
   */
  async remember(content: string): Promise<unknown> {
    const cfg = this.getConfig();
    if (cfg.access === 'read') {
      throw new Error('Second brain is configured read-only — writes are not allowed');
    }
    if (cfg.blockPii) {
      if (containsPii(content)) {
        throw new Error('Blocked: content looks like personal data (CPF/phone/card). Store it in the personal brain instead.');
      }
      if (this.piiJudge && await this.piiJudge(content)) {
        throw new Error('Blocked: content looks like personal data about an identifiable person. Store it in the personal brain instead.');
      }
    }
    return this.call('sb_append', {
      path: 'inbox/keepmind-os-captures.md',
      text: `\n\n---\n\n${content}`,
    });
  }
}
