import { expect,it,vi } from 'vitest';
import { ConfigurationAssistant } from '../src/main/configuration/ConfigurationAssistant';
import { configurationSchemas, configurationLabels, CONFIGURATION_CATALOG, isConfigurationRequest } from '../src/shared/configuration';
function setup(){const store=new Map<string,string>();const storage={getSetting:(k:string)=>store.get(k),setSetting:(k:string,v:string)=>{store.set(k,v);}};return {storage,chat:new ConfigurationAssistant(storage)};}
const reply=(action:string|null,args:unknown={})=>async()=>JSON.stringify({reply:'Confira os valores.',action,args});
it('prepares explicit Granola connection without a model or credentials in chat',async()=>{
 const {chat}=setup();const model=vi.fn();const result=await chat.message('owner','conectar o Granola','pt',model);
 expect(model).not.toHaveBeenCalled();expect(result.autoStart).toBe(result.state.turns.at(-1)?.plan?.id);
 const run=vi.fn(async()=>({ok:true}));await chat.execute('owner',result.autoStart!,run,'pt');await chat.execute('owner',result.autoStart!,run,'pt');expect(run).toHaveBeenCalledTimes(1);
 expect(chat.state('owner').turns.at(-2)?.plan?.status).toBe('done');expect(chat.state('other').turns).toEqual([]);
});
it('asks missing details and rejects unknown actions, extra parameters and secrets',async()=>{
 const {chat}=setup();await chat.message('owner','ajustar o idioma','pt',reply(null));expect(chat.state('owner').turns.at(-1)?.plan).toBeUndefined();
 await expect(chat.message('owner','fazer algo','pt',reply('shell.exec',{cmd:'anything'}))).rejects.toThrow('Unsupported');
 await expect(chat.message('owner','tema','pt',reply('appearance',{theme:'dark',autoApprove:true}))).rejects.toThrow();
 await expect(chat.message('owner','token=private-secret','pt',reply(null))).rejects.toThrow('credentials');expect(JSON.stringify(chat.state('owner'))).not.toContain('private-secret');
});
it('applies only persisted reviewed parameters and invalidates old plans',async()=>{
 const {chat}=setup();const first=await chat.message('owner','dark','en',reply('appearance',{theme:'dark'}));const id=first.state.turns.at(-1)!.plan!.id;
 await chat.message('owner','light','en',reply('appearance',{theme:'light'}));await expect(chat.execute('owner',id,vi.fn(),'en')).rejects.toThrow('no longer ready');
 await expect(chat.execute('other',id,vi.fn(),'en')).rejects.toThrow('unavailable');
});
it('reports cancellation as failure, never connection success, and never replays after restart',async()=>{
 const {chat,storage}=setup();const result=await chat.message('owner','conectar Granola','pt',vi.fn());let finish!:(v:unknown)=>void;
 const pending=chat.execute('owner',result.autoStart!,()=>new Promise(resolve=>{finish=resolve;}),'pt');
 expect(chat.state('owner').turns.at(-1)?.plan?.status).toBe('running');
 const restored=new ConfigurationAssistant(storage);expect(restored.state('owner').turns.at(-1)?.plan?.status).toBe('failed');
 finish({ok:false,error:'cancelled'});await pending;expect(chat.state('owner').turns.at(-2)?.plan?.status).toBe('failed');
 await expect(chat.execute('owner',result.autoStart!,vi.fn(),'pt')).rejects.toThrow('no longer ready');
});
it('does not classify negations or explanatory text as explicit configuration commands',()=>{
 expect(isConfigurationRequest('conecte o Granola')).toBe(true);expect(isConfigurationRequest('Não conecte o Granola')).toBe(false);expect(isConfigurationRequest('Explique como conectar Granola')).toBe(false);
});

it('keeps every action labelled and documented, with strict privilege and endpoint parameters',()=>{
 for(const id of Object.keys(configurationSchemas)){expect(configurationLabels[id as keyof typeof configurationSchemas]).toHaveLength(2);expect(CONFIGURATION_CATALOG).toContain(id);}
 expect(()=>configurationSchemas['computer.access'].parse({level:'full',allowedRoots:[],shellAllow:[],shellDeny:[],autoApprove:true})).toThrow();
 expect(()=>configurationSchemas['provider.key'].parse({provider:'openai',key:'must-not-be-in-plan'})).toThrow();
 expect(()=>configurationSchemas['team.create'].parse({name:'A team'})).toThrow();
});

it('confirms language changes in the newly selected language',async()=>{
 const {chat}=setup();const result=await chat.message('owner','Portuguese','en',reply('appearance',{language:'pt'}));
 const after=await chat.execute('owner',result.state.turns.at(-1)!.plan!.id,async()=>({ok:true}),'en');expect(after.turns.at(-1)!.text).toContain('Configuração concluída');
});
