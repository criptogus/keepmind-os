import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import type { SakStatus, SakHit, SakPreview } from '../../shared/superAgentSkill.js';

export const SAK_ORIGIN = 'https://superagentskill.com';
export const SAK_ENDPOINT = `${SAK_ORIGIN}/api/public/mcp`;
interface Secrets { getSecret(key: string): string | null; setSecret(key: string, value: string): void; clearSecret(key: string): void; }
interface SavedSession { client: OAuthClientInformationMixed; tokens: OAuthTokens; redirectUrl: string; expiresAt: number; }
interface Flow { generation: number; state: string; verifier: string; redirectUrl: string; client?: OAuthClientInformationMixed; tokens?: OAuthTokens; server: Server; controller: AbortController; timer?: ReturnType<typeof setTimeout>; used: boolean; }
export interface SakOptions {
  secrets: Secrets; key: string; openBrowser: (url: string) => Promise<void>; canEncrypt: () => Promise<boolean>;
  fetch?: typeof fetch;
  // Dependency injection is used by protocol regression tests; never exposed over IPC.
  authorize?: typeof auth;
  readTool?: (name: 'search_registry' | 'get_package', args: Record<string, unknown>, token: string) => Promise<unknown>;
  timeoutMs?: number;
}
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/);
const hitSchema = z.object({ slug: slugSchema, name: z.string().min(1).max(200), description: z.string().max(5000).nullish(), latest_version: z.string().max(100).nullish(), type: z.literal('skill') });
export function parseSakResult(raw: unknown): unknown {
  const result = raw as { isError?: boolean; content?: Array<{ type: string; text?: string }>; structuredContent?: unknown };
  if (result?.isError) throw new Error('O catálogo não conseguiu atender à busca. Tente novamente.');
  if (result?.structuredContent) { if (JSON.stringify(result.structuredContent).length > 200000) throw new Error('Resposta inválida do catálogo.'); return result.structuredContent; }
  const text = result?.content?.filter(c => c.type === 'text').map(c => c.text || '').join('\n');
  if (!text || text.length > 200000) throw new Error('Resposta inválida do catálogo.');
  try { return JSON.parse(text); } catch { throw new Error('Resposta inválida do catálogo.'); }
}
export function sakSearchResults(raw: unknown): SakHit[] {
  const data = z.object({ items: z.array(hitSchema).max(50) }).parse(parseSakResult(raw));
  return data.items.map(p => ({ slug: p.slug, name: p.name, description: p.description || '', version: p.latest_version || '' }));
}
export function sakPackagePreview(raw: unknown, slug: string): SakPreview {
  const data = z.object({ package: hitSchema, version: z.object({ version: z.string().min(1).max(100), system_prompt: z.string().min(1).max(50000), rules: z.unknown().optional(), examples: z.unknown().optional() }) }).parse(parseSakResult(raw));
  if (data.package.slug !== slug) throw new Error('O catálogo retornou outra habilidade.');
  const prompt = [data.version.system_prompt, data.version.rules ? `Regras da habilidade:\n${JSON.stringify(data.version.rules,null,2)}` : '', data.version.examples ? `Exemplos da habilidade:\n${JSON.stringify(data.version.examples,null,2)}` : ''].filter(Boolean).join('\n\n');
  if (prompt.length > 60000) throw new Error('Habilidade muito longa para importar.');
  return { slug, name: data.package.name, description: data.package.description || '', version: data.version.version, prompt, source: `${SAK_ORIGIN}/marketplace/${slug}`, digest: createHash('sha256').update(JSON.stringify([slug,data.version.version,prompt])).digest('hex') };
}

/** Dedicated read-only catalogue connection; no arbitrary MCP tool can be called. */
export class SuperAgentSkill {
  private flow?: Flow;
  private generation = 0;
  private error?: string;
  private notice?: string;
  private authUrl?: string;
  private refresh?: Promise<SavedSession>;
  private previews = new Map<string, SakPreview>();
  constructor(private options: SakOptions) {}
  private saved(): SavedSession | undefined {
    try { const raw = this.options.secrets.getSecret(this.options.key); const s = raw ? JSON.parse(raw) : undefined; return s?.tokens?.access_token && s?.client?.client_id ? s : undefined; } catch { return undefined; }
  }
  status(): SakStatus { return { connected: !!this.saved(), pending: !!this.flow, authUrl: this.authUrl, error: this.error, notice: this.notice }; }
  private async trustedFetch(input: string | URL | Request, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== SAK_ORIGIN || url.username || url.password) throw new Error('Destino OAuth não autorizado.');
    const signals = [AbortSignal.timeout(15000), ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])];
    return (this.options.fetch || fetch)(input, { ...init, redirect: 'error', signal: AbortSignal.any(signals) });
  }
  private provider(flow: Flow, saved?: SavedSession): OAuthClientProvider {
    let clientInvalidated = false; let tokensInvalidated = false;
    return {
      redirectUrl: flow.redirectUrl,
      clientMetadata: { client_name: 'KeepMind OS', redirect_uris: [flow.redirectUrl], grant_types: ['authorization_code','refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'mcp:read' },
      state: () => flow.state,
      clientInformation: () => flow.client || (clientInvalidated ? undefined : saved?.client),
      saveClientInformation: client => { flow.client = client; },
      tokens: () => flow.tokens || (tokensInvalidated ? undefined : saved?.tokens),
      saveTokens: tokens => { if (flow.generation !== this.generation || flow.controller.signal.aborted) throw new Error('Login cancelado.'); flow.tokens = tokens; },
      saveCodeVerifier: verifier => { flow.verifier = verifier; },
      codeVerifier: () => { if (!flow.verifier) throw new Error('Verificação de login ausente.'); return flow.verifier; },
      redirectToAuthorization: async url => {
        if (saved) throw new Error('Reconecte sua conta.');
        if (url.origin !== SAK_ORIGIN || flow.generation !== this.generation || flow.controller.signal.aborted) throw new Error('Login cancelado.');
        this.authUrl = url.href;
        await this.options.openBrowser(url.href).catch(() => { this.notice = 'O navegador não abriu. Use o link de login abaixo.'; });
      },
      validateResourceURL: async (_server, resource) => { if (resource && resource !== SAK_ENDPOINT) throw new Error('Recurso OAuth não autorizado.'); return new URL(SAK_ENDPOINT); },
      invalidateCredentials: scope => { if (scope === 'tokens' || scope === 'all') { flow.tokens = undefined; tokensInvalidated = true; } if (scope === 'client' || scope === 'all') { flow.client = undefined; clientInvalidated = true; } },
    };
  }
  private commit(flow: Flow): SavedSession {
    if (flow.generation !== this.generation || flow.controller.signal.aborted || !flow.tokens?.access_token || !flow.client) throw new Error('Login não concluído.');
    const saved = { client: flow.client, tokens: flow.tokens, redirectUrl: flow.redirectUrl, expiresAt: Date.now() + (flow.tokens.expires_in ?? 3600) * 1000 };
    this.options.secrets.setSecret(this.options.key, JSON.stringify(saved)); return saved;
  }
  private cleanup(flow: Flow) { clearTimeout(flow.timer); flow.server.close(); if (this.flow === flow) { this.flow = undefined; this.authUrl = undefined; } }
  async connect(): Promise<SakStatus> {
    if (this.flow) return this.status();
    if (!(await this.options.canEncrypt())) throw new Error('Ative o armazenamento seguro do sistema antes de conectar a conta.');
    if (this.flow) return this.status();
    const generation = ++this.generation; this.error = undefined; this.notice = undefined;
    const flow: Flow = { generation, state: randomBytes(32).toString('hex'), verifier: '', redirectUrl: '', server: createServer(), controller: new AbortController(), used: false };
    this.flow = flow;
    flow.server.on('request', (req, res) => { void this.callback(flow, req.url || '/', req.method || '', res); });
    try {
      await new Promise<void>((resolve,reject) => { flow.server.once('error',reject); flow.server.listen(0,'127.0.0.1',resolve); });
      flow.redirectUrl = `http://127.0.0.1:${(flow.server.address() as {port:number}).port}/oauth/callback`;
      flow.timer = setTimeout(() => { if (this.flow === flow) { this.cancel(); this.error = 'O login expirou. Tente novamente.'; } }, this.options.timeoutMs ?? 300000);
      const result = await (this.options.authorize || auth)(this.provider(flow), { serverUrl: SAK_ENDPOINT, scope: 'mcp:read', fetchFn: (input,init) => this.trustedFetch(input,init,flow.controller.signal) });
      if (result === 'AUTHORIZED') { this.commit(flow); this.cleanup(flow); }
    } catch { this.cleanup(flow); this.error = 'Não foi possível iniciar o login. Tente novamente.'; }
    return this.status();
  }
  private async callback(flow: Flow, raw: string, method: string, res: import('node:http').ServerResponse) {
    const url = new URL(raw,flow.redirectUrl); const state = url.searchParams.get('state') || '';
    if (method !== 'GET' || url.pathname !== '/oauth/callback' || this.flow !== flow || flow.used || Buffer.byteLength(state) !== Buffer.byteLength(flow.state) || !timingSafeEqual(Buffer.from(state),Buffer.from(flow.state))) { res.writeHead(400); res.end('Resposta de login invalida.'); return; }
    if (url.searchParams.has('error')) { res.writeHead(200); res.end('Login nao autorizado. Volte ao KeepMind OS.'); this.cancel(); this.error = 'Você não autorizou a conexão. Pode tentar novamente.'; return; }
    const code = url.searchParams.get('code'); if (!code) { res.writeHead(400); res.end('Codigo ausente.'); return; }
    flow.used = true;
    try {
      const result = await (this.options.authorize || auth)(this.provider(flow), { serverUrl: SAK_ENDPOINT, scope: 'mcp:read', authorizationCode: code, fetchFn: (input,init) => this.trustedFetch(input,init,flow.controller.signal) });
      if (result !== 'AUTHORIZED') throw new Error(); this.commit(flow); this.notice = 'Conta conectada. Busque uma habilidade para começar.';
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'}); res.end('Conta conectada. Volte ao KeepMind OS para buscar habilidades.');
    } catch { if (flow.generation === this.generation) this.error = 'Não foi possível concluir o login. Tente novamente.'; res.writeHead(400); res.end('Login nao concluido. Volte ao KeepMind OS.'); }
    finally { this.cleanup(flow); }
  }
  cancel(): SakStatus { ++this.generation; if (this.flow) { this.flow.controller.abort(); this.cleanup(this.flow); } this.notice = 'Login cancelado.'; return this.status(); }
  async disconnect(): Promise<SakStatus> {
    const saved = this.saved(); this.cancel(); this.options.secrets.clearSecret(this.options.key); this.previews.clear(); this.error = undefined; this.notice = 'Conta desconectada. As habilidades já adicionadas continuam locais.';
    if (saved) {
      try {
        for (const [token,hint] of [[saved.tokens.refresh_token,'refresh_token'],[saved.tokens.access_token,'access_token']]) {
          if (!token) continue;
          const r = await this.trustedFetch(`${SAK_ORIGIN}/api/public/oauth/revoke`, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({token,token_type_hint:hint!,client_id:saved.client.client_id}) });
          if (!r.ok) throw new Error();
        }
      } catch { this.notice = 'Conta removida deste app. Não foi possível confirmar a revogação no serviço.'; }
    }
    return this.status();
  }
  private async session(force = false): Promise<SavedSession> {
    const saved = this.saved(); if (!saved) throw new Error('Conecte sua conta para buscar habilidades.');
    if (!force && saved.expiresAt > Date.now() + 60000) return saved;
    if (this.refresh) return this.refresh;
    const generation = this.generation;
    this.refresh = (async () => {
      const flow: Flow = { generation, state: '', verifier: '', redirectUrl: saved.redirectUrl, client: saved.client, server: createServer(), controller: new AbortController(), used: true };
      try {
        if (!(await this.options.canEncrypt())) throw new Error();
        const result = await (this.options.authorize || auth)(this.provider(flow,saved), { serverUrl: SAK_ENDPOINT, scope: 'mcp:read', fetchFn: (input,init) => this.trustedFetch(input,init) });
        if (result !== 'AUTHORIZED') throw new Error(); return this.commit(flow);
      } catch { if (generation === this.generation) this.options.secrets.clearSecret(this.options.key); throw new Error('A sessão expirou. Reconecte sua conta.'); }
    })().finally(() => { this.refresh = undefined; });
    return this.refresh;
  }
  private async call(name: 'search_registry' | 'get_package', args: Record<string,unknown>, retried = false): Promise<unknown> {
    const generation = this.generation; const saved = await this.session();
    if (this.options.readTool) { const result = await this.options.readTool(name,args,saved.tokens.access_token); if (generation !== this.generation) throw new Error('Conexão encerrada.'); return result; }
    const client = new Client({name:'keepmind-os',version:'0.1.9'});
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(SAK_ENDPOINT), { requestInit: { headers: {Authorization:`Bearer ${saved.tokens.access_token}`},redirect:'error' }, fetch: (input,init) => this.trustedFetch(input,init) }), {timeout:15000});
      const result = await client.callTool({name,arguments:args},undefined,{timeout:20000});
      if (generation !== this.generation) throw new Error(); return result;
    } catch (error) {
      if (!retried && generation === this.generation && ((error as {code?:number}).code === 401 || (error as Error).name === 'UnauthorizedError')) { await this.session(true); return this.call(name,args,true); }
      throw new Error('Não foi possível consultar o catálogo. Confira a conexão e tente novamente.');
    }
    finally { await client.close().catch(()=>{}); }
  }
  async search(query: string): Promise<SakHit[]> {
    const q = z.string().trim().min(2).max(200).parse(query);
    return sakSearchResults(await this.call('search_registry',{query:q,type:'skill',limit:20}));
  }
  async preview(slug: string): Promise<SakPreview> {
    slugSchema.parse(slug); const preview = sakPackagePreview(await this.call('get_package',{slug}),slug);
    if (this.previews.size >= 30) this.previews.clear(); this.previews.set(preview.digest,preview); return preview;
  }
  reviewed(digest: string): SakPreview {
    const preview = this.previews.get(digest); if (!preview || !this.saved()) throw new Error('Abra a prévia novamente antes de adicionar a habilidade.'); return preview;
  }
}
