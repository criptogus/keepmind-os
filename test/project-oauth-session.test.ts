import {it,expect,vi} from 'vitest';
const sdk=vi.hoisted(()=>({create:vi.fn(async()=>({execute:async()=>({data:'fixture'}),search:async()=>({tools:[]})})),get:vi.fn(async()=>({status:'ACTIVE'}))}));
vi.mock('@composio/core',()=>({Composio:class{sessions={create:sdk.create};connectedAccounts={get:sdk.get};}}));
import {ComposioManager} from '../src/main/integrations/ComposioManager';
it('refreshes completed OAuth independently of UI and pins the exact connected account',async()=>{
 const settings=new Map([['composio.connections',JSON.stringify([{toolkit:'gmail',connectedAccountId:'account-A',status:'INITIATED'}])]]);
 const manager=new ComposioManager({getSecret:()=> 'fixture-key',setSecret:()=>{},clearSecret:()=>{}},{getSetting:k=>settings.get(k),setSetting:(k,v)=>{settings.set(k,v);}},async()=>{},'project-identity-A');
 await manager.execute('GMAIL_FETCH_EMAILS',{});
 expect(sdk.get).toHaveBeenCalledWith('account-A');expect(sdk.create).toHaveBeenCalledWith('project-identity-A',{toolkits:['gmail'],connectedAccounts:{gmail:'account-A'},manageConnections:false,instant:false});
});
it('retains pending account identity and returns a recovery link when browser opening fails',async()=>{
 const settings=new Map<string,string>();sdk.create.mockResolvedValueOnce({authorize:async()=>({toJSON:()=>({id:'pending-account',status:'INITIATED',redirectUrl:'https://auth.example/login'})})} as any);
 const manager=new ComposioManager({getSecret:()=> 'fixture-key',setSecret:()=>{},clearSecret:()=>{}},{getSetting:k=>settings.get(k),setSetting:(k,v)=>{settings.set(k,v);}},async()=>{throw new Error('Browser unavailable');},'project-recovery');
 const result=await manager.connect('gmail');expect(result.redirectUrl).toBe('https://auth.example/login');expect(manager.listConnections()[0].connectedAccountId).toBe('pending-account');
});
