import {it,expect,vi} from 'vitest';
const seen=vi.hoisted(()=>({users:[] as string[],paths:[] as string[],started:[] as string[]}));
vi.mock('../src/main/integrations/ComposioManager',()=>({ComposioManager:class{constructor(_s:unknown,_db:unknown,_open:unknown,user:string){seen.users.push(user);}}}));
vi.mock('../src/main/integrations/WhatsAppManager',()=>({WhatsAppManager:class{constructor(private path:string){seen.paths.push(path);}private handler?:(event:unknown)=>void;setEventHandler(handler:(event:unknown)=>void){this.handler=handler;}async start(){seen.started.push(this.path);}getStatus(){return {status:'connecting'};}async stop(){this.handler?.({type:'status',status:'disconnected'});} }}));
import {ProjectConnections} from '../src/main/projects/ProjectConnections';
it('uses different service identities and WhatsApp auth roots for independent connections',()=>{
 const db=new Map<string,string>();const c=new ProjectConnections({getSetting:k=>db.get(k),setSetting:(k,v)=>{db.set(k,v);},getAllSettings:()=>Object.fromEntries(db)},{} as any,'/fixture',async()=>{});
 const a=c.create('Company sales','gmail'),b=c.create('External client','gmail');c.app(a.id);c.app(b.id);c.app(a.id);expect(seen.users).toEqual([`keepmind-connection-${a.id}`,`keepmind-connection-${b.id}`]);
 const x=c.create('Phone A','whatsapp'),y=c.create('Phone B','whatsapp');c.whatsapp(x.id);c.whatsapp(y.id);expect(seen.paths).toEqual([`/fixture/connections/${x.id}`,`/fixture/connections/${y.id}`]);expect(()=>c.app(x.id)).toThrow('Wrong connection type');
});
it('namespaces Second Brain secrets and settings without falling back to another connection',()=>{
 const db=new Map<string,string>(),secrets=new Map<string,string>();const c=new ProjectConnections({getSetting:k=>db.get(k),setSetting:(k,v)=>{db.set(k,v);},getAllSettings:()=>Object.fromEntries(db)},{getSecret:(k:string)=>secrets.get(k)||null,setSecret:(k:string,v:string)=>secrets.set(k,v),hasSecret:(k:string)=>secrets.has(k)} as any,'/fixture',async()=>{});
 const a=c.create('Context A','secondbrain'),b=c.create('Context B','secondbrain');c.brain(a.id).setConfig({url:'https://brain.example/a',token:'fixture-A',enabled:true,access:'read'});
 expect(c.brain(a.id).isConfigured()).toBe(true);expect(c.brain(b.id).isConfigured()).toBe(false);expect(c.brain(b.id).getConfig().token).toBe('');expect(secrets.get(`project.connection.${a.id}.secondbrain`)).toBe('fixture-A');expect(()=>c.brain('missing')).toThrow('unavailable');
});

it('restores only previously authenticated WhatsApp instances',async()=>{
 const db=new Map<string,string>();const store={getSetting:(k:string)=>db.get(k),setSetting:(k:string,v:string)=>{db.set(k,v);},getAllSettings:()=>Object.fromEntries(db)};
 const first=new ProjectConnections(store,{} as any,'/restore',async()=>{});const saved=first.create('Saved','whatsapp');const fresh=first.create('Unpaired','whatsapp');
 db.set(`project.connection.${saved.id}.restore`,'true');const restarted=new ProjectConnections(store,{} as any,'/restore',async()=>{});await restarted.restore();
 expect(seen.started).toContain(`/restore/connections/${saved.id}`);expect(seen.started).not.toContain(`/restore/connections/${fresh.id}`);await restarted.stop();expect(db.get(`project.connection.${saved.id}.restore`)).toBe('true');
});
