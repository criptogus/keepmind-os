import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SuperAgentSkill, SAK_ORIGIN, SAK_ENDPOINT, sakPackagePreview, sakSearchResults, type SakOptions } from '../src/main/integrations/SuperAgentSkill';
import { installSakSkill } from '../src/main/integrations/installSakSkill';
import { StorageManager } from '../src/main/storage/StorageManager';
import { openLoginInSafari } from '../src/main/auth/openLoginBrowser';
const connections: SuperAgentSkill[] = [];
afterEach(() => { for (const c of connections) c.cancel(); connections.length = 0; vi.restoreAllMocks(); });
const hit = { slug:'business-plan', name:'Business Plan', description:'Plan a business', latest_version:'1.0', type:'skill' };
const result = (data: unknown) => ({content:[{type:'text',text:JSON.stringify(data)}]});
const manifest = () => result({package:hit,version:{version:'1.0',system_prompt:'Ask for missing facts. Do not invent results.',rules:{must:['Cite sources']}}});
function setup(extra: Partial<SakOptions> = {}) {
  const db = new Map<string,string>(); let opened = ''; let refreshCalls = 0;
  const requests: {url:string;body:URLSearchParams}[] = [];
  const network = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const body = new URLSearchParams(String(init?.body || '')); requests.push({url,body});
    if (url.includes('.well-known/oauth-protected-resource')) return Response.json({resource:SAK_ENDPOINT,authorization_servers:[SAK_ORIGIN],scopes_supported:['mcp:read','mcp:write']});
    if (url.includes('.well-known/')) return Response.json({issuer:SAK_ORIGIN,authorization_endpoint:SAK_ORIGIN+'/oauth/authorize',token_endpoint:SAK_ORIGIN+'/api/public/oauth/token',registration_endpoint:SAK_ORIGIN+'/api/public/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:['mcp:read','mcp:write']});
    if (url.endsWith('/register')) return Response.json({...JSON.parse(String(init?.body)),client_id:'test-client'});
    if (url.endsWith('/token')) { if(body.get('grant_type')==='refresh_token') refreshCalls++; return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600,scope:'mcp:read'}); }
    if (url.endsWith('/revoke')) return new Response(null,{status:200});
    throw new Error('Unexpected fixture URL: '+url);
  });
  const c = new SuperAgentSkill({key:'account',secrets:{getSecret:k=>db.get(k)||null,setSecret:(k,v)=>{db.set(k,v);},clearSecret:k=>{db.delete(k);}},canEncrypt:async()=>true,openBrowser:async url=>{opened=url;},fetch:network as typeof fetch,readTool:async name=>name==='search_registry'?result({items:[hit]}):manifest(),...extra});
  connections.push(c);
  async function login() {
    await c.connect(); const url = new URL(opened);
    const callback = new URL(url.searchParams.get('redirect_uri')!); callback.searchParams.set('state',url.searchParams.get('state')!); callback.searchParams.set('code','fixture-code');
    return {url,callback,finish:()=>fetch(callback)};
  }
  return {c,db,network,requests,login,opened:()=>opened,refreshCalls:()=>refreshCalls};
}
it('runs actual SDK discovery, registration, PKCE and callback, then searches/previews and revokes', async () => {
  const h = setup(); const {url,finish} = await h.login();
  expect(url.origin).toBe(SAK_ORIGIN); expect(url.searchParams.get('scope')).toBe('mcp:read'); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(h.c.status()).toMatchObject({pending:true,connected:false});
  expect((await finish()).status).toBe(200); expect(h.c.status()).toMatchObject({pending:false,connected:true});
  const exchange=h.requests.find(r=>r.body.get('grant_type')==='authorization_code')!;
  expect(createHash('sha256').update(exchange.body.get('code_verifier')!).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
  expect(exchange.body.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'));
  expect(JSON.stringify(h.c.status())).not.toContain('fixture-access');
  expect(await h.c.search('business')).toHaveLength(1);
  const p=await h.c.preview(hit.slug); expect(h.c.reviewed(p.digest)).toEqual(p); expect(p.prompt).toContain('Cite sources');
  await h.c.disconnect(); expect(h.c.status().connected).toBe(false); expect(h.requests.filter(r=>r.url.endsWith('/revoke'))).toHaveLength(2); expect(()=>h.c.reviewed(p.digest)).toThrow();
});
it('rejects missing, wrong and multibyte state without consuming the valid callback', async () => {
  const h=setup(); const {callback,finish}=await h.login();
  for(const state of ['', 'bad', 'é'.repeat(64)]) { const u=new URL(callback);u.searchParams.set('state',state);expect((await fetch(u)).status).toBe(400); }
  expect(h.c.status().connected).toBe(false);expect((await finish()).status).toBe(200);
});
it('rejects callback replay while token exchange is in progress',async()=>{
  let release!:()=>void; const gate=new Promise<void>(r=>{release=r;});
  const h=setup(); const base=h.network.getMockImplementation()!;
  h.network.mockImplementation(async (input,init)=>{if(String(input).endsWith('/token'))await gate;return base(input,init);});
  const {finish}=await h.login();const first=finish(); await vi.waitFor(()=>expect(h.network.mock.calls.some(([u])=>String(u).endsWith('/token'))).toBe(true));
  expect((await finish()).status).toBe(400);release();expect((await first).status).toBe(200);
});
it('denial, cancellation and timeout never save credentials and allow a fresh attempt',async()=>{
  const h=setup({timeoutMs:1000});const {callback}=await h.login();callback.searchParams.set('error','access_denied');await fetch(callback);
  expect(h.c.status()).toMatchObject({connected:false,pending:false});expect(h.db.size).toBe(0);
  await h.login();h.c.cancel();expect(h.c.status().pending).toBe(false);
  const exp=setup({timeoutMs:15});await exp.c.connect();await vi.waitFor(()=>expect(exp.c.status().pending).toBe(false));expect(exp.c.status().error).toContain('expirou');
});
it('does not resurrect credentials when cancelled during token exchange',async()=>{
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const h=setup();const base=h.network.getMockImplementation()!;
  h.network.mockImplementation(async(input,init)=>{if(String(input).endsWith('/token'))await gate;return base(input,init);});
  const {finish}=await h.login();const pending=finish();await vi.waitFor(()=>expect(h.network.mock.calls.some(([u])=>String(u).endsWith('/token'))).toBe(true));h.c.cancel();release();await pending;
  expect(h.c.status().connected).toBe(false);expect(h.db.size).toBe(0);
});
it('refreshes once for concurrent searches and clears a rejected refresh session',async()=>{
  const h=setup();await (await h.login()).finish();const saved=JSON.parse(h.db.get('account')!);saved.expiresAt=0;h.db.set('account',JSON.stringify(saved));
  await Promise.all([h.c.search('one'),h.c.search('two')]);expect(h.refreshCalls()).toBe(1);
  saved.expiresAt=0;h.db.set('account',JSON.stringify(saved));const base=h.network.getMockImplementation()!;
  h.network.mockImplementation(async(input,init)=>String(input).endsWith('/token')?Response.json({error:'invalid_grant'},{status:400}):base(input,init));
  await expect(h.c.search('again')).rejects.toThrow('Reconecte');expect(h.c.status().connected).toBe(false);
});
it('keeps a manual link when OS browser launch fails and refuses insecure token storage',async()=>{
  const h=setup({openBrowser:async()=>{throw new Error('OS failure');}});await h.c.connect();expect(h.c.status().authUrl).toContain('/oauth/authorize');expect(h.c.status().notice).toContain('não abriu');
  const insecure=setup({canEncrypt:async()=>false});await expect(insecure.c.connect()).rejects.toThrow('armazenamento seguro');expect(insecure.network).not.toHaveBeenCalled();
});
it('pins discovery requests to the catalogue origin and never follows a foreign authorization server',async()=>{
  const h=setup({fetch:vi.fn(async()=>Response.json({resource:SAK_ENDPOINT,authorization_servers:['https://attacker.invalid']})) as typeof fetch});
  await h.c.connect();expect(h.c.status().connected).toBe(false);expect(h.c.status().authUrl).toBeUndefined();expect(h.c.status().error).toBeTruthy();expect(h.db.size).toBe(0);
});
it('removes local access even if remote revocation fails',async()=>{
  const h=setup();await (await h.login()).finish();h.network.mockRejectedValue(new Error('offline'));
  await h.c.disconnect();expect(h.db.size).toBe(0);expect(h.c.status().notice).toContain('Não foi possível confirmar');
});
it('validates catalogue type, requested slug, bounds and preview digest identity',()=>{
  expect(()=>sakSearchResults(result({items:[{...hit,type:'guardrail'}]}))).toThrow();
  expect(()=>sakPackagePreview(manifest(),'different')).toThrow();
  expect(()=>sakSearchResults({structuredContent:{items:[],junk:'x'.repeat(200001)}})).toThrow();
  const a=sakPackagePreview(manifest(),hit.slug);const b=sakPackagePreview(result({package:{...hit,slug:'other'},version:{version:'1.0',system_prompt:'Ask for missing facts. Do not invent results.',rules:{must:['Cite sources']}}}),'other');expect(a.digest).not.toBe(b.digest);
});
it('imports reviewed instructions idempotently without granting tools and rolls back assignment failure',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sak-install-'));const storage=new StorageManager(dir);
  try {
    const now=new Date().toISOString();storage.saveAgent({id:'agent',name:'Assistant',description:'',config:{model:'gpt-4o-mini',temperature:0,maxTokens:100,systemPrompt:'Be helpful',tools:[{name:'existing_tool',type:'custom',config:{}}],skillIds:['existing_skill']},capabilities:[],permissions:{canAccessNetwork:false,canAccessFileSystem:false,canExecuteCode:false,maxExecutionTime:60},createdAt:now,updatedAt:now});
    const p=sakPackagePreview(manifest(),hit.slug);const installed=installSakSkill(storage,p,'agent');expect(installSakSkill(storage,p,'agent')).toEqual(installed);
    expect(storage.getSkill(installed.skillId)?.toolNames).toEqual([]);expect(storage.getAgent('agent')?.config.tools).toEqual([{name:'existing_tool',type:'custom',config:{}}]);expect(storage.getAgent('agent')?.config.skillIds).toEqual(['existing_skill',installed.skillId]);
    const count=storage.getAllSkills().length;vi.spyOn(storage,'saveAgent').mockImplementation(()=>{throw new Error('disk');});
    expect(()=>installSakSkill(storage,{...p,version:'2.0',digest:'new'},'agent')).toThrow('disk');expect(storage.getAllSkills()).toHaveLength(count);
  } finally { storage.close();rmSync(dir,{recursive:true,force:true}); }
});
it('opens only a pending HTTPS login in Safari without a shell or changing defaults',async()=>{
  const run=vi.fn(async()=>({stdout:'',stderr:''}));await openLoginInSafari(SAK_ORIGIN+'/oauth/authorize?state=fixture','darwin',run as never);
  expect(run).toHaveBeenCalledWith('/usr/bin/open',['-a','Safari',SAK_ORIGIN+'/oauth/authorize?state=fixture'],{timeout:10000});
  await expect(openLoginInSafari(null,'darwin',run as never)).rejects.toThrow('expirou');await expect(openLoginInSafari('file:///etc/passwd','darwin',run as never)).rejects.toThrow('inválido');await expect(openLoginInSafari(SAK_ORIGIN,'win32',run as never)).rejects.toThrow('macOS');expect(run).toHaveBeenCalledTimes(1);
});
