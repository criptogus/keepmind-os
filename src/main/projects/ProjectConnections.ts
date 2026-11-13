import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ComposioManager} from '../integrations/ComposioManager.js';
import {WhatsAppManager,type WhatsAppEvent} from '../integrations/WhatsAppManager.js';
import {SecondBrainManager} from '../integrations/SecondBrainManager.js';
import type {CredentialStore} from '../auth/CredentialStore.js';
import type {ConnectionInstance} from '../../shared/projects.js';
interface Store {getSetting(k:string):string|null|undefined;setSetting(k:string,v:string):void;getAllSettings():Record<string,string>}
/** One authenticated identity per instance. Sharing requires an explicit project/standard binding. */
export class ProjectConnections {
  private wa=new Map<string,WhatsAppManager>();private events=new Map<string,WhatsAppEvent>();private apps=new Map<string,ComposioManager>();
  constructor(private store:Store,private secrets:CredentialStore,private root:string,private open:(url:string)=>Promise<void>){}
  list():ConnectionInstance[]{return JSON.parse(this.store.getSetting('projects.connections')||'[]');}
  get(id:string){const c=this.list().find(c=>c.id===id);if(!c)throw new Error('Connection unavailable');return c;}
  create(name:string,kind:ConnectionInstance['kind']){const c={id:randomUUID(),name,kind};this.store.setSetting('projects.connections',JSON.stringify([...this.list(),c]));return c;}
  private settings(id:string){this.get(id);const prefix=`project.connection.${id}.`;return {
    getSetting:(k:string)=>this.store.getSetting(prefix+k),setSetting:(k:string,v:string)=>this.store.setSetting(prefix+k,v),
    getAllSettings:()=>Object.fromEntries(Object.entries(this.store.getAllSettings()).filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k.slice(prefix.length),v]))};}
  app(id:string){const c=this.get(id);if(!['gmail','outlook'].includes(c.kind))throw new Error('Wrong connection type');let manager=this.apps.get(id);if(!manager){manager=new ComposioManager(this.secrets,this.settings(id),this.open,`keepmind-connection-${id}`);this.apps.set(id,manager);}return manager;}
  whatsapp(id:string){if(this.get(id).kind!=='whatsapp')throw new Error('Wrong connection type');let manager=this.wa.get(id);if(!manager){manager=new WhatsAppManager(path.join(this.root,'connections',id));manager.setEventHandler(event=>{
    this.events.set(id,event);
    if(event.type==='status'&&event.status==='connected')this.settings(id).setSetting('restore','true');
    if(event.type==='status'&&event.status==='disconnected')this.settings(id).setSetting('restore','false');
    if(event.type==='message'&&event.message){const settings=this.settings(id);const messages=JSON.parse(settings.getSetting('messages')||'[]');settings.setSetting('messages',JSON.stringify([...messages,event.message].slice(-500)));}
  });this.wa.set(id,manager);}return manager;}
  messages(id:string,limit=20){this.get(id);return JSON.parse(this.settings(id).getSetting('messages')||'[]').slice(-Math.max(1,Math.min(100,limit)));}
  brain(id:string){if(this.get(id).kind!=='secondbrain')throw new Error('Wrong connection type');const prefix=`project.connection.${id}.`;return new SecondBrainManager(this.settings(id),{
    getSecret:k=>this.secrets.getSecret(prefix+k),setSecret:(k,v)=>this.secrets.setSecret(prefix+k,v),hasSecret:k=>this.secrets.hasSecret(prefix+k)});}
  async connect(id:string){const c=this.get(id);if(c.kind==='whatsapp'){await this.whatsapp(id).start();return this.status(id);}if(c.kind==='secondbrain')return this.brain(id).testConnection();return this.app(id).connect(c.kind);}
  async status(id:string){const c=this.get(id);if(c.kind==='whatsapp')return {...this.whatsapp(id).getStatus(),qrDataUrl:this.events.get(id)?.qrDataUrl};if(c.kind==='secondbrain')return {status:this.brain(id).isConfigured()?'configured':'disconnected'};return {accounts:await this.app(id).refreshConnections()};}
  async restore(){for(const c of this.list())if(c.kind==='whatsapp'&&this.settings(c.id).getSetting('restore')==='true')await this.whatsapp(c.id).start();}
  async stop(){const restore=this.list().filter(c=>c.kind==='whatsapp'&&this.settings(c.id).getSetting('restore')==='true').map(c=>c.id);await Promise.allSettled([...this.wa.values()].map(w=>w.stop()));for(const id of restore)this.settings(id).setSetting('restore','true');}
}
