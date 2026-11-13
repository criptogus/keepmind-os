import { Composio } from '@composio/core';

/**
 * Composio integration — one project API key per company install.
 * Each employee connects THEIR OWN SaaS accounts (Gmail, Calendar, etc.)
 * through Composio's hosted auth; connections are stored server-side by
 * Composio keyed under a single local user id.
 */

interface SecretStore {
  getSecret(name: string): string | null;
  setSecret(name: string, value: string): void;
  clearSecret(name: string): void;
}

interface SettingsStore {
  getSetting(key: string): string | null | undefined;
  setSetting(key: string, value: string): void;
}

export interface ComposioConnection {
  toolkit: string;
  connectedAccountId: string;
  status: string;
  alias?: string;
}

const API_KEY_SECRET = 'composio.apiKey';
const CONNECTIONS_KEY = 'composio.connections';
/** Single Composio user id for this install (per-machine identity). */
const USER_ID = 'keepmind-local';

export class ComposioManager {
  private client: Composio | null = null;
  private clientKey: string | null = null;

  constructor(
    private secrets: SecretStore,
    private settings: SettingsStore,
    private openExternal: (url: string) => Promise<void>,
    private userId = USER_ID,
  ) {}

  isConfigured(): boolean {
    return !!this.secrets.getSecret(API_KEY_SECRET);
  }

  /** Masked hint for the UI — never returns the full key. */
  keyHint(): string | null {
    const key = this.secrets.getSecret(API_KEY_SECRET);
    if (!key) return null;
    return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••';
  }

  setApiKey(key: string): void {
    this.secrets.setSecret(API_KEY_SECRET, key.trim());
    this.client = null;
    this.clientKey = null;
  }

  clearApiKey(): void {
    this.secrets.clearSecret(API_KEY_SECRET);
    this.client = null;
    this.clientKey = null;
    this.saveConnections([]);
  }

  private get composio(): Composio {
    const key = this.secrets.getSecret(API_KEY_SECRET);
    if (!key) throw new Error('Composio API key not configured');
    if (!this.client || this.clientKey !== key) {
      this.client = new Composio({ apiKey: key });
      this.clientKey = key;
    }
    return this.client;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.composio.toolkits.get({ limit: 1 } as never);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async listToolkits(): Promise<Array<{ slug: string; name: string }>> {
    const res = await this.composio.toolkits.get({ limit: 200 } as never) as {
      items?: Array<{ slug?: string; name?: string }>;
    };
    return (res.items || [])
      .filter((t) => t.slug)
      .map((t) => ({ slug: t.slug as string, name: t.name || (t.slug as string) }));
  }

  private loadConnections(): ComposioConnection[] {
    try {
      const raw = this.settings.getSetting(CONNECTIONS_KEY);
      return raw ? (JSON.parse(raw) as ComposioConnection[]) : [];
    } catch {
      return [];
    }
  }

  private saveConnections(conns: ComposioConnection[]): void {
    this.settings.setSetting(CONNECTIONS_KEY, JSON.stringify(conns));
  }

  listConnections(): ComposioConnection[] {
    return this.loadConnections();
  }

  /**
   * Starts a hosted auth flow for a toolkit. Returns the redirect URL the
   * renderer should open; the connection id is tracked so status can be
   * polled. Does NOT block waiting for the user to finish auth.
   */
  async connect(toolkit: string): Promise<{ id: string; redirectUrl: string | null }> {
    const session = await this.composio.sessions.create(this.userId, { toolkits: [toolkit] } as never);
    const req = await session.authorize(toolkit);
    const state = req.toJSON();
    const redirectUrl = state.redirectUrl ?? null;
    const conns = this.loadConnections().filter((c) => c.toolkit !== toolkit);
    conns.push({ toolkit, connectedAccountId: state.id, status: state.status || 'INITIATED' });
    this.saveConnections(conns);
    // Persist pending identity before opening the browser; the returned URL is the recovery path.
    if (redirectUrl) await this.openExternal(redirectUrl).catch(()=>{});
    return { id: state.id, redirectUrl };
  }

  /** Refreshes status of all tracked connections from Composio. */
  async refreshConnections(): Promise<ComposioConnection[]> {
    const conns = this.loadConnections();
    if (!conns.length) return conns;
    for (const c of conns) {
      try {
        const acct = await this.composio.connectedAccounts.get(c.connectedAccountId);
        c.status = String((acct as { status?: string }).status || c.status);
      } catch {
        // Keep last known status if lookup fails
      }
    }
    this.saveConnections(conns);
    return conns;
  }

  async disconnect(connectedAccountId: string): Promise<void> {
    const conns = this.loadConnections();
    const target = conns.find((c) => c.connectedAccountId === connectedAccountId);
    try {
      await this.composio.connectedAccounts.delete(connectedAccountId);
    } finally {
      this.saveConnections(conns.filter((c) => c.connectedAccountId !== connectedAccountId));
      void target;
    }
  }

  private async session() {
    const active = (await this.refreshConnections()).filter((c) => c.status === 'ACTIVE');
    if(!active.length)throw new Error('No connected account available');
    return this.composio.sessions.create(this.userId, { toolkits: active.map(c=>c.toolkit), connectedAccounts:Object.fromEntries(active.map(c=>[c.toolkit,c.connectedAccountId])), manageConnections:false, instant:false });
  }

  /** Semantic search over available Composio tools/actions. */
  async searchTools(query: string): Promise<Array<{ slug: string; name: string; description: string }>> {
    const session = await this.session();
    const res = await session.search({ queries: [query] } as never) as {
      results?: Array<{ tools?: Array<{ slug?: string; name?: string; description?: string }> }>;
      tools?: Array<{ slug?: string; name?: string; description?: string }>;
    };
    const tools = res.results?.flatMap((r) => r.tools || []) ?? res.tools ?? [];
    return tools
      .filter((t) => t.slug)
      .slice(0, 10)
      .map((t) => ({ slug: t.slug as string, name: t.name || (t.slug as string), description: (t.description || '').slice(0, 300) }));
  }

  /** Executes a Composio tool/action slug with JSON arguments. */
  async execute(slug: string, args: Record<string, unknown>): Promise<string> {
    const session = await this.session();
    const res = await session.execute(slug, args as never) as {
      data?: unknown;
      error?: string;
      successful?: boolean;
    };
    const payload = res.data ?? res;
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    return text.slice(0, 20000);
  }
}
