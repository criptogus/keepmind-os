import { expect,it,vi } from 'vitest';
import { GranolaManager } from '../src/main/integrations/GranolaManager';
vi.mock('electron',()=>({shell:{openExternal:vi.fn()}}));
function fixture(open=vi.fn(async(_url:string)=>{})){
 const values=new Map<string,string>();const manager=new GranolaManager({getSetting:(k:string)=>values.get(k),setSetting:(k:string,v:string)=>values.set(k,v)} as any,{} as any,{} as any,open);
 return {manager,open};
}
async function waitUrl(manager:GranolaManager){for(let i=0;i<50;i++){const url=manager.getLoginUrl();if(url)return new URL(url);await new Promise(r=>setTimeout(r,10));}throw new Error('No login URL');}
it('keeps browser recovery available, rejects mismatched callbacks, and cancels cleanly',async()=>{
 const {manager}=fixture(vi.fn(async()=>{throw new Error('Browser unavailable');}));
 const pending=(manager as any).runAuthCodeFlow({authorization_endpoint:'https://example.test/authorize'},'client');
 const rejection=expect(pending).rejects.toThrow('cancelled');
 const url=await waitUrl(manager);expect(url.searchParams.get('code_challenge_method')).toBe('S256');
 const bad=await fetch('http://127.0.0.1:17877/callback?code=bad&state=wrong');expect(bad.status).toBe(400);expect(manager.getLoginUrl()).toBeTruthy();
 manager.cancelConnect();await rejection;expect(manager.getLoginUrl()).toBeNull();
});
it('reports success only after verified callback and token exchange; replay does not exchange twice',async()=>{
 const {manager}=fixture();const exchange=vi.spyOn(manager as any,'exchangeCode').mockResolvedValue({accessToken:'fixture',clientId:'client'});
 const pending=(manager as any).runAuthCodeFlow({authorization_endpoint:'https://example.test/authorize',token_endpoint:'https://example.test/token'},'client');
 const url=await waitUrl(manager);const response=await fetch(`http://127.0.0.1:17877/callback?code=test&state=${url.searchParams.get('state')}`);expect(response.status).toBe(200);
 expect(await response.text()).not.toContain('Granola connected');expect((await pending).accessToken).toBe('fixture');expect(exchange).toHaveBeenCalledTimes(1);expect(manager.getLoginUrl()).toBeNull();
});
