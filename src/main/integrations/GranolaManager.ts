import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import { shell } from 'electron';
import type { StorageManager } from '../storage/StorageManager.js';
import type { CredentialStore } from '../auth/CredentialStore.js';
import type { PersonalBrainManager } from './PersonalBrainManager.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Granola meeting-notes connector.
 *
 * One-click OAuth 2.0 (PKCE + dynamic client registration) against Granola's
 * MCP authorization server, then a Streamable-HTTP MCP client that talks to
 * https://mcp.granola.ai/mcp. Meeting notes are synced into the personal
 * brain vault as dated Markdown files so agents and humans share the same
 * memory. Tokens live in the encrypted CredentialStore — never in settings.
 */

const MCP_URL = 'https://mcp.granola.ai/mcp';
const PROTECTED_RESOURCE = 'https://mcp.granola.ai/.well-known/oauth-protected-resource';
const FALLBACK_AUTH_SERVER = 'https://mcp-auth.granola.ai';
const REDIRECT_URI = 'http://127.0.0.1:17877/callback';
const REDIRECT_PORT = 17877;
const CALLBACK_PATH = '/callback';
const MCP_PROTOCOL_VERSION = '2025-03-26';
const SYNC_TICK_MS = 5 * 60_000;
const DEFAULT_SYNC_MINUTES = 60;
const MIN_SYNC_MINUTES = 15;

const KEY_ENABLED = 'granola.enabled';
const KEY_CLIENT_ID = 'granola.clientId';
const KEY_LAST_SYNC = 'granola.lastSync';
const KEY_SYNCED = 'granola.synced'; // JSON: { [noteId]: updatedAt }
const KEY_FILES = 'granola.files'; // JSON: { [noteId]: filename } — for stale-file cleanup
const KEY_SYNC_MINUTES = 'granola.syncMinutes';
const KEY_ACCOUNT = 'granola.account';
const KEY_LAST_ERROR = 'granola.lastError';
const SECRET_TOKENS = 'granola';
const SYNC_LIST_LIMIT = 50; // listMeetings cap — cleanup only safe below this

interface GranolaTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  clientId: string;
}

interface AuthServerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface MeetingSummary {
  id: string;
  title?: string;
  meeting_at?: string;
  created_at?: string;
  updated_at?: string;
  attendees?: unknown;
  owner?: { name?: string; email?: string };
  [k: string]: unknown;
}

export interface GranolaStatus {
  enabled: boolean;
  connected: boolean;
  account?: string;
  lastSync?: string;
  lastSyncError?: string;
  syncedCount: number;
  syncMinutes: number;
}

export class GranolaManager {
  private storage: StorageManager;
  private credentials: CredentialStore;
  private personalBrain: PersonalBrainManager;
  private openExternal: (url: string) => Promise<void>;
  private authMeta: AuthServerMetadata | null = null;
  private sessionId: string | null = null;
  private initialized = false;
  private syncing = false;
  private syncTimer: NodeJS.Timeout | null = null;
  private toolsCache: McpTool[] | null = null;

  constructor(
    storage: StorageManager,
    credentials: CredentialStore,
    personalBrain: PersonalBrainManager,
    openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url)
  ) {
    this.storage = storage;
    this.credentials = credentials;
    this.personalBrain = personalBrain;
    this.openExternal = openExternal;
  }

  // ---------- config / status ----------

  isEnabled(): boolean {
    return this.storage.getSetting(KEY_ENABLED) === 'true';
  }

  getSyncMinutes(): number {
    const m = Number(this.storage.getSetting(KEY_SYNC_MINUTES));
    return Number.isFinite(m) && m >= MIN_SYNC_MINUTES ? Math.floor(m) : DEFAULT_SYNC_MINUTES;
  }

  setSyncMinutes(minutes: number): void {
    this.storage.setSetting(KEY_SYNC_MINUTES, String(Math.max(MIN_SYNC_MINUTES, Math.floor(minutes))));
  }

  getStatus(): GranolaStatus {
    return {
      enabled: this.isEnabled(),
      connected: this.isConnected(),
      account: this.storage.getSetting(KEY_ACCOUNT) || undefined,
      lastSync: this.storage.getSetting(KEY_LAST_SYNC) || undefined,
      lastSyncError: this.storage.getSetting(KEY_LAST_ERROR) || undefined,
      syncedCount: Object.keys(this.loadSynced()).length,
      syncMinutes: this.getSyncMinutes(),
    };
  }

  isConnected(): boolean {
    return !!this.credentials.getSecret(SECRET_TOKENS);
  }

  private loadTokens(): GranolaTokens | null {
    const raw = this.credentials.getSecret(SECRET_TOKENS);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GranolaTokens;
    } catch {
      return null;
    }
  }

  private saveTokens(t: GranolaTokens): void {
    this.credentials.setSecret(SECRET_TOKENS, JSON.stringify(t));
  }

  private loadSynced(): Record<string, string> {
    try {
      return JSON.parse(this.storage.getSetting(KEY_SYNCED) || '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }

  private saveSynced(map: Record<string, string>): void {
    // Bound the map — Granola notes are small; keep the newest 2000.
    const entries = Object.entries(map).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 2000);
    this.storage.setSetting(KEY_SYNCED, JSON.stringify(Object.fromEntries(entries)));
  }

  private loadFiles(): Record<string, string> {
    try {
      return JSON.parse(this.storage.getSetting(KEY_FILES) || '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }

  private saveFiles(map: Record<string, string>): void {
    const entries = Object.entries(map).slice(-2000);
    this.storage.setSetting(KEY_FILES, JSON.stringify(Object.fromEntries(entries)));
  }

  // ---------- OAuth 2.0 (PKCE + dynamic registration) ----------

  private async discoverAuthServer(): Promise<AuthServerMetadata> {
    if (this.authMeta) return this.authMeta;
    // RFC 9728 protected-resource metadata → authorization server.
    const pr = await fetch(PROTECTED_RESOURCE).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const issuer = (pr?.authorization_servers?.[0] as string | undefined) || FALLBACK_AUTH_SERVER;
    const meta = await fetch(`${issuer}/.well-known/oauth-authorization-server`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!meta?.authorization_endpoint || !meta?.token_endpoint) {
      throw new Error('Granola OAuth discovery failed — authorization server metadata unavailable');
    }
    this.authMeta = meta as AuthServerMetadata;
    return this.authMeta;
  }

  private async ensureClientId(meta: AuthServerMetadata): Promise<string> {
    const existing = this.storage.getSetting(KEY_CLIENT_ID);
    if (existing) return existing;
    if (!meta.registration_endpoint) {
      throw new Error('Granola does not offer dynamic client registration');
    }
    const res = await fetch(meta.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'KeepMind OS',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'openid email profile offline_access',
      }),
    });
    if (!res.ok) throw new Error(`Granola client registration failed (${res.status})`);
    const data = (await res.json()) as { client_id?: string };
    if (!data.client_id) throw new Error('Granola client registration returned no client_id');
    this.storage.setSetting(KEY_CLIENT_ID, data.client_id);
    return data.client_id;
  }

  /**
   * Full connect flow: discovery → dynamic registration → browser OAuth →
   * loopback callback → token exchange. Returns account email when the
   * id_token carries one.
   */
  async connect(): Promise<{ ok: boolean; account?: string; error?: string }> {
    try {
      const meta = await this.discoverAuthServer();
      const clientId = await this.ensureClientId(meta);
      const tokens = await this.runAuthCodeFlow(meta, clientId);
      this.saveTokens(tokens);
      this.storage.setSetting(KEY_ENABLED, 'true');
      this.initialized = false;
      this.sessionId = null;
      this.toolsCache = null;
      // Best-effort account lookup for the UI badge.
      const account = await this.fetchAccountEmail(tokens.accessToken).catch(() => undefined);
      this.storage.setSetting(KEY_ACCOUNT, account || '');
      void this.syncNow().catch((e) => console.error('[granola] initial sync failed:', e));
      this.ensureScheduler();
      return { ok: true, account };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private runAuthCodeFlow(meta: AuthServerMetadata, clientId: string): Promise<GranolaTokens> {
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          const u = new URL(req.url || '/', `http://127.0.0.1:${REDIRECT_PORT}`);
          if (u.pathname !== CALLBACK_PATH) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<!doctype html><html><body style="font-family:system-ui;text-align:center;padding-top:4rem">' +
            '<h2>Granola connected</h2><p>You can close this tab and return to KeepMind OS.</p></body></html>'
          );
          const code = u.searchParams.get('code');
          const gotState = u.searchParams.get('state');
          const oauthError = u.searchParams.get('error');
          server.close();
          if (oauthError) {
            reject(new Error(`Granola authorization failed: ${oauthError}`));
            return;
          }
          if (!code || gotState !== state) {
            reject(new Error('Granola callback missing code or state mismatch'));
            return;
          }
          this.exchangeCode(meta.token_endpoint, {
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: clientId,
            code_verifier: codeVerifier,
            resource: MCP_URL,
          }).then(resolve, reject);
        } catch (e) {
          server.close();
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });

      server.on('error', (err) => {
        reject(new Error(`Could not start OAuth callback server on port ${REDIRECT_PORT}: ${err.message}`));
      });
      server.listen(REDIRECT_PORT, '127.0.0.1');

      const authUrl = new URL(meta.authorization_endpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('scope', 'openid email profile offline_access');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('resource', MCP_URL);

      this.openExternal(authUrl.toString()).catch((e) => {
        server.close();
        reject(new Error(`Could not open browser: ${e instanceof Error ? e.message : e}`));
      });

      // Timeout so a never-completed flow doesn't leak the server.
      setTimeout(() => {
        server.close();
        reject(new Error('Granola sign-in timed out — try connecting again'));
      }, 5 * 60_000).unref();
    });
  }

  private async exchangeCode(tokenEndpoint: string, params: Record<string, string>): Promise<GranolaTokens> {
    const clientId = this.storage.getSetting(KEY_CLIENT_ID) || params.client_id;
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Granola token exchange failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
    };
    if (!data.access_token) throw new Error('Granola token response missing access_token');
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      clientId,
    };
  }

  private async refreshTokens(tokens: GranolaTokens): Promise<GranolaTokens | null> {
    if (!tokens.refreshToken) return null;
    const meta = await this.discoverAuthServer().catch(() => null);
    if (!meta?.token_endpoint) return null;
    try {
      const fresh = await this.exchangeCode(meta.token_endpoint, {
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: tokens.clientId,
        resource: MCP_URL,
      });
      // Refresh responses may omit refresh_token — keep the old one.
      fresh.refreshToken = fresh.refreshToken ?? tokens.refreshToken;
      this.saveTokens(fresh);
      return fresh;
    } catch {
      return null;
    }
  }

  private async accessToken(): Promise<string> {
    let tokens = this.loadTokens();
    if (!tokens?.accessToken) throw new Error('Granola is not connected — connect it in Settings → Advanced');
    if (tokens.expiresAt && tokens.expiresAt < Date.now() + 30_000) {
      const fresh = await this.refreshTokens(tokens);
      if (!fresh) {
        this.credentials.clearSecret(SECRET_TOKENS);
        this.storage.setSetting(KEY_ACCOUNT, '');
        throw new Error('Granola session expired — please reconnect');
      }
      tokens = fresh;
    }
    return tokens.accessToken;
  }

  private async fetchAccountEmail(accessToken: string): Promise<string | undefined> {
    const res = await fetch('https://mcp-auth.granola.ai/oauth2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => null);
    if (!res?.ok) return undefined;
    const data = (await res.json().catch(() => ({}))) as { email?: string };
    return data.email;
  }

  disconnect(): void {
    this.credentials.clearSecret(SECRET_TOKENS);
    this.storage.setSetting(KEY_ACCOUNT, '');
    this.storage.setSetting(KEY_SYNCED, '{}');
    this.storage.setSetting(KEY_FILES, '{}');
    this.storage.setSetting(KEY_LAST_SYNC, '');
    this.storage.setSetting(KEY_LAST_ERROR, '');
    this.initialized = false;
    this.sessionId = null;
    this.toolsCache = null;
  }

  // ---------- MCP Streamable HTTP client ----------

  private async mcpRequest(method: string, params?: unknown, isNotification = false): Promise<unknown> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${token}`,
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    const body: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (!isNotification) body.id = Date.now();
    if (params !== undefined) body.params = params;

    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (res.status === 404 || res.status === 400) {
      // Session expired or not initialized — reset and let caller retry once.
      this.initialized = false;
      this.sessionId = null;
      throw new Error(`Granola MCP session reset (${res.status})`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Granola MCP request failed (${res.status}): ${text.slice(0, 200)}`);
    }
    if (isNotification || res.status === 202 || res.status === 204) return null;

    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('text/event-stream')) {
      return this.parseSse(await res.text());
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (data.error) {
      const err = data.error as { message?: string };
      throw new Error(err.message || 'Granola MCP error');
    }
    return data.result;
  }

  /** Extracts the JSON-RPC response object from an SSE stream body. */
  private parseSse(text: string): unknown {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const msg = JSON.parse(payload) as Record<string, unknown>;
        if (msg.error) {
          const err = msg.error as { message?: string };
          throw new Error(err.message || 'Granola MCP error');
        }
        if (msg.id !== undefined && msg.result !== undefined) return msg.result;
      } catch (e) {
        if (e instanceof Error && e.message.includes('Granola MCP')) throw e;
      }
    }
    return null;
  }

  private async ensureSession(): Promise<void> {
    if (this.initialized) return;
    await this.mcpRequest('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'keepmind-os', version: '1.0.0' },
    });
    await this.mcpRequest('notifications/initialized', {}, true);
    this.initialized = true;
    this.toolsCache = null;
  }

  async listTools(): Promise<McpTool[]> {
    await this.ensureSession();
    if (this.toolsCache) return this.toolsCache;
    const result = (await this.mcpRequest('tools/list')) as { tools?: McpTool[] } | null;
    this.toolsCache = result?.tools ?? [];
    return this.toolsCache;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureSession();
    let result: {
      content?: Array<{ type: string; text?: string }>;
      structuredContent?: unknown;
      isError?: boolean;
    } | null;
    try {
      result = (await this.mcpRequest('tools/call', { name, arguments: args })) as typeof result;
    } catch (e) {
      // MCP session reset (400/404) already cleared state — re-init and retry once.
      if (e instanceof Error && e.message.includes('session reset')) {
        await this.ensureSession();
        result = (await this.mcpRequest('tools/call', { name, arguments: args })) as typeof result;
      } else {
        throw e;
      }
    }
    if (result?.isError) {
      const msg = result.content?.map((c) => c.text).filter(Boolean).join(' ') || 'tool error';
      throw new Error(msg);
    }
    if (result?.structuredContent !== undefined) return result.structuredContent;
    const text = result?.content?.map((c) => c.text).filter(Boolean).join('\n');
    if (!text) return result ?? null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ---------- meetings ----------

  private extractItems(result: unknown): MeetingSummary[] {
    if (!result) return [];
    const obj = result as Record<string, unknown>;
    const arr = (obj.notes ?? obj.meetings ?? obj.items ?? (Array.isArray(result) ? result : null)) as unknown[] | null;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((n) => n as MeetingSummary)
      .filter((n) => typeof n?.id === 'string' && n.id.length > 0);
  }

  async listMeetings(limit = 30): Promise<MeetingSummary[]> {
    const result = await this.callTool('list_meetings', {});
    return this.extractItems(result).slice(0, limit);
  }

  async searchMeetings(query: string): Promise<unknown> {
    return this.callTool('search_meetings', { query });
  }

  /** Reads one meeting's full note; tries transcript tool on paid plans. */
  async getMeeting(id: string, includeTranscript = true): Promise<Record<string, unknown>> {
    // Argument name differs across MCP versions — probe the schema once.
    const args = await this.argsForTool('get_meetings', id);
    const note = (await this.callTool('get_meetings', args)) as unknown;
    let transcript: unknown;
    if (includeTranscript) {
      try {
        transcript = await this.callTool('get_meeting_transcript', await this.argsForTool('get_meeting_transcript', id));
      } catch {
        transcript = undefined; // plan without transcripts or tool missing
      }
    }
    return { note, transcript };
  }

  /** Picks the right argument shape for a tool based on its inputSchema. */
  private async argsForTool(toolName: string, id: string): Promise<Record<string, unknown>> {
    const tools = await this.listTools().catch(() => [] as McpTool[]);
    const schema = tools.find((t) => t.name === toolName)?.inputSchema as
      | { properties?: Record<string, { type?: string; items?: unknown }> }
      | undefined;
    const props = schema?.properties ?? {};
    if ('ids' in props) return { ids: [id] };
    if ('meeting_ids' in props) return { meeting_ids: [id] };
    if ('note_ids' in props) return { note_ids: [id] };
    if ('id' in props) return { id };
    if ('note_id' in props) return { note_id: id };
    if ('meeting_id' in props) return { meeting_id: id };
    // Fallback: most Granola tools accept ids arrays.
    return { ids: [id] };
  }

  // ---------- sync into personal brain ----------

  private slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9áàâãéêíóôõúç]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meeting';
  }

  private formatMeeting(note: unknown, transcript: unknown, meta: MeetingSummary): string {
    const n = (note && typeof note === 'object' ? note : {}) as Record<string, unknown>;
    const lines: string[] = [];
    const date = meta.meeting_at || meta.created_at || '';
    lines.push('---');
    lines.push(`source: granola`);
    lines.push(`granola_id: ${meta.id}`);
    if (date) lines.push(`date: ${date}`);
    if (meta.owner?.email) lines.push(`owner: ${meta.owner.email}`);
    const attendees = Array.isArray(meta.attendees) ? meta.attendees : n.attendees;
    if (Array.isArray(attendees) && attendees.length) {
      lines.push(`attendees: ${attendees.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(', ')}`);
    }
    lines.push('---');
    lines.push('');
    lines.push(`# ${meta.title || n.title || 'Untitled meeting'}`);
    lines.push('');
    const summary = (n.summary_text ?? n.summary ?? n.notes_text ?? '') as string;
    if (summary) {
      lines.push('## Summary');
      lines.push('');
      lines.push(summary);
      lines.push('');
    }
    const privateNotes = (n.private_notes ?? n.privateNotes ?? '') as string;
    if (privateNotes) {
      lines.push('## Private notes');
      lines.push('');
      lines.push(privateNotes);
      lines.push('');
    }
    if (transcript) {
      lines.push('## Transcript');
      lines.push('');
      const items = Array.isArray(transcript) ? transcript : (transcript as Record<string, unknown>)?.items;
      if (Array.isArray(items)) {
        for (const item of items as Array<Record<string, unknown>>) {
          const speaker = (item.speaker as Record<string, unknown> | undefined)?.source || item.speaker || 'speaker';
          const text = String(item.text ?? '');
          if (text) lines.push(`**${speaker}**: ${text}`);
        }
      } else {
        lines.push('```json');
        lines.push(JSON.stringify(transcript, null, 2).slice(0, 30000));
        lines.push('```');
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /** One meeting fetch+write with exponential backoff for transient MCP errors. */
  private async syncMeetingWithRetry(meta: MeetingSummary, dir: string): Promise<{ filename: string }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { note, transcript } = await this.getMeeting(meta.id, true);
        const body = this.formatMeeting(note, transcript, meta);
        const day = (meta.meeting_at || meta.created_at || new Date().toISOString()).slice(0, 10);
        const filename = `granola-${day}-${this.slugify(String(meta.title || meta.id))}.md`;
        await fs.writeFile(path.join(dir, filename), body, 'utf8');
        return { filename };
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1) * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  /** Pulls new/updated meetings into the personal brain vault. */
  async syncNow(): Promise<{ synced: number; skipped: number; removed?: number; error?: string }> {
    if (this.syncing) return { synced: 0, skipped: 0, error: 'sync already running' };
    if (!this.isConnected()) return { synced: 0, skipped: 0, error: 'not connected' };
    this.syncing = true;
    const audit = (output: Record<string, unknown>, error?: string) => {
      try {
        this.storage.saveAuditLog({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          agentId: 'system',
          agentName: 'Granola',
          action: error ? 'granola_sync_error' : 'granola_sync',
          input: {},
          output,
          metadata: {},
          userId: 'system',
        });
      } catch { /* audit is best-effort */ }
    };
    try {
      const meetings = await this.listMeetings(SYNC_LIST_LIMIT);
      const syncedMap = this.loadSynced();
      const fileMap = this.loadFiles();
      const dir = this.personalBrain.getDir();
      await this.personalBrain.ensureDir();
      let synced = 0;
      let skipped = 0;
      let removed = 0;
      let failures = 0;
      const seenIds = new Set<string>();

      for (const meta of meetings) {
        seenIds.add(meta.id);
        const stamp = meta.updated_at || meta.meeting_at || meta.created_at || '';
        if (syncedMap[meta.id] === stamp) {
          skipped++;
          continue;
        }
        try {
          const { filename } = await this.syncMeetingWithRetry(meta, dir);
          // If the meeting moved/renamed, drop the previous file for this note.
          const prevFile = fileMap[meta.id];
          if (prevFile && prevFile !== filename) {
            await fs.unlink(path.join(dir, prevFile)).catch(() => {});
          }
          fileMap[meta.id] = filename;
          syncedMap[meta.id] = stamp || new Date().toISOString();
          synced++;
        } catch (e) {
          failures++;
          console.error(`[granola] failed to sync meeting ${meta.id}:`, e);
        }
        // Be polite to the MCP endpoint — ~8 req/s ceiling across calls.
        await new Promise((r) => setTimeout(r, 120));
      }

      // Cleanup: only safe when the list is complete (fewer than the cap).
      // A note deleted in Granola gets its vault file removed and mappings dropped.
      if (meetings.length < SYNC_LIST_LIMIT) {
        for (const id of Object.keys(fileMap)) {
          if (seenIds.has(id)) continue;
          const fp = path.join(dir, fileMap[id]);
          // Only delete files we can prove are Granola-synced (frontmatter check).
          try {
            const head = await fs.readFile(fp, 'utf8');
            if (head.includes(`granola_id: ${id}`)) {
              await fs.unlink(fp);
              removed++;
            }
          } catch { /* file already gone */ }
          delete fileMap[id];
          delete syncedMap[id];
        }
      }

      this.saveSynced(syncedMap);
      this.saveFiles(fileMap);
      this.storage.setSetting(KEY_LAST_SYNC, new Date().toISOString());
      const lastError = failures > 0 ? `${failures} meeting(s) failed to sync` : '';
      this.storage.setSetting(KEY_LAST_ERROR, lastError);
      audit({ synced, skipped, removed, total: meetings.length, failures }, failures > 0 ? lastError : undefined);
      return { synced, skipped, removed, error: lastError || undefined };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.storage.setSetting(KEY_LAST_ERROR, msg);
      audit({ synced: 0, skipped: 0 }, msg);
      return { synced: 0, skipped: 0, error: msg };
    } finally {
      this.syncing = false;
    }
  }

  /** Periodic sync while connected — respects the configured interval. */
  ensureScheduler(): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      if (this.isConnected() && this.isEnabled()) {
        void this.syncNow().catch((e) => console.error('[granola] scheduled sync failed:', e));
      }
    }, SYNC_TICK_MS);
    this.syncTimer.unref?.();
  }

  stop(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }
}
