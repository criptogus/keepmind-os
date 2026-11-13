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
const SYNC_LIST_LIMIT = 50; // bounded fetch; never used to infer completeness

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
  private pendingLoginUrl: string | null = null;
  private cancelLogin: (() => void) | null = null;
  private connecting = false;
  private loginEpoch = 0;
  getLoginUrl(): string | null { return this.pendingLoginUrl; }
  cancelConnect(): void { this.loginEpoch++; this.cancelLogin?.(); }
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
    if(this.connecting) return {ok:false,error:'Sign-in already in progress'};
    this.connecting=true; const epoch=++this.loginEpoch;
    try {
      const meta = await this.discoverAuthServer();
      const clientId = await this.ensureClientId(meta);
      if(epoch!==this.loginEpoch)throw new Error('Sign-in cancelled');
      const tokens = await this.runAuthCodeFlow(meta, clientId);
      if(epoch!==this.loginEpoch)throw new Error('Sign-in cancelled');
      this.saveTokens(tokens);
      await this.credentials.flush();
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
    } finally { this.connecting=false; }
  }

  private runAuthCodeFlow(meta: AuthServerMetadata, clientId: string): Promise<GranolaTokens> {
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    return new Promise((resolve, reject) => {
      let settled=false; let exchanging=false;
      const finish=(error?:Error,tokens?:GranolaTokens)=>{
        if(settled)return; settled=true; clearTimeout(timer); server.close();
        this.pendingLoginUrl=null;this.cancelLogin=null;
        if(error)reject(error);else resolve(tokens!);
      };
      const server=http.createServer((req,res)=>{
        const url=new URL(req.url||'/',`http://127.0.0.1:${REDIRECT_PORT}`);
        if(url.pathname!==CALLBACK_PATH){res.writeHead(404);res.end('Not found');return;}
        if(url.searchParams.get('state')!==state){res.writeHead(400);res.end('Invalid authorization state');return;}
        if(exchanging){res.writeHead(409);res.end('Authorization already being verified');return;}
        const code=url.searchParams.get('code'); const error=url.searchParams.get('error');
        if(error||!code){res.writeHead(400);res.end('Authorization not completed');finish(new Error('Granola authorization not completed'));return;}
        exchanging=true;
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        res.end('<!doctype html><html><body><p>Return to KeepMind OS to check the connection. / Volte ao KeepMind OS para verificar a conexão.</p></body></html>');
        server.close();
        this.exchangeCode(meta.token_endpoint,{grant_type:'authorization_code',code,redirect_uri:REDIRECT_URI,client_id:clientId,code_verifier:codeVerifier,resource:MCP_URL})
          .then(tokens=>finish(undefined,tokens),error=>finish(error instanceof Error?error:new Error(String(error))));
      });
      const timer=setTimeout(()=>finish(new Error('Granola sign-in timed out')),5*60_000);timer.unref();
      this.cancelLogin=()=>finish(new Error('Granola sign-in cancelled'));
      server.on('error',()=>finish(new Error('Could not start Granola sign-in callback')));
      server.listen(REDIRECT_PORT,'127.0.0.1',()=>{
        const url=new URL(meta.authorization_endpoint);
        for(const [key,value] of Object.entries({response_type:'code',client_id:clientId,redirect_uri:REDIRECT_URI,scope:'openid email profile offline_access',state,code_challenge:codeChallenge,code_challenge_method:'S256',resource:MCP_URL}))url.searchParams.set(key,value);
        this.pendingLoginUrl=url.toString();
        // Keep the pending URL available for explicit browser recovery if automatic opening fails.
        void this.openExternal(this.pendingLoginUrl).catch(()=>{});
      });
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
    if (!result) throw new Error('Invalid meeting list response');
    const obj = result as Record<string, unknown>;
    const arr = (obj.notes ?? obj.meetings ?? obj.items ?? (Array.isArray(result) ? result : null)) as unknown[] | null;
    if (!Array.isArray(arr)) throw new Error('Invalid meeting list response');
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
        const filename = `granola-${crypto.createHash('sha256').update(meta.id).digest('hex')}.md`;
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
      const removed = 0;
      let failures = 0;

      for (const meta of meetings) {
        const stamp = meta.updated_at || meta.meeting_at || meta.created_at || '';
        if (syncedMap[meta.id] === stamp && fileMap[meta.id] === `granola-${crypto.createHash('sha256').update(meta.id).digest('hex')}.md`) {
          skipped++;
          continue;
        }
        try {
          const { filename } = await this.syncMeetingWithRetry(meta, dir);
          // Preserve old files during migration: they may contain user edits or
          // have been shared by colliding legacy meeting titles.
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

      // A short page does not prove an authoritative complete listing.
      // Keep local notes until an explicit deletion policy is available.

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
      const lastSync = Date.parse(this.storage.getSetting(KEY_LAST_SYNC) || '');
      const due = !Number.isFinite(lastSync) || Date.now() - lastSync >= this.getSyncMinutes() * 60_000;
      if (this.isConnected() && this.isEnabled() && due) {
        void this.syncNow().catch((e) => console.error('[granola] scheduled sync failed:', e));
      }
    }, SYNC_TICK_MS);
    this.syncTimer.unref?.();
  }

  stop(): void {
    this.cancelConnect();
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }
}
