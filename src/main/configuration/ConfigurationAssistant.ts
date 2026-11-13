import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { configurationSchemas, type ConfigurationAction, type ConfigurationState, type ConfigurationTurn } from '../../shared/configuration.js';
import type { WorkStorage } from '../work/WorkManager.js';
const replySchema=z.object({reply:z.string().min(1).max(4000),action:z.string().nullable(),args:z.record(z.unknown())}).strict();
export class ConfigurationAssistant {
 private busy=new Set<string>();
 constructor(private storage:WorkStorage) {}
 private key(actor:string){return `configuration.chat.${actor}`;}
 state(actor:string):ConfigurationState { const state=JSON.parse(this.storage.getSetting(this.key(actor))||'{"turns":[]}') as ConfigurationState; if(!this.busy.has(actor)){let changed=false;for(const t of state.turns)if(t.plan?.status==='running'){t.plan.status='failed';changed=true;}if(changed)this.save(actor,state.turns);} return {...state,pending:this.busy.has(actor)}; }
 private save(actor:string,turns:ConfigurationTurn[]){this.storage.setSetting(this.key(actor),JSON.stringify({turns:turns.slice(-60)}));}
 async message(actor:string,text:string,language:'pt'|'en',respond:(text:string,history:ConfigurationTurn[])=>Promise<string>) {
  text=z.string().trim().min(1).max(4000).parse(text);
  if(this.busy.has(actor))throw new Error('Configuration already in progress');
  const state=this.state(actor);
  if(state.turns.some(t=>t.plan?.status==='running'))throw new Error('Review the interrupted action before continuing');
  if(/https?:\/\/[^/\s]+:[^@\s]+@/i.test(text))throw new Error('Do not send credentials in chat');
  if(/\b(sk-[A-Za-z0-9_-]{15,}|Bearer\s+\S+|(?:api[_ -]?key|password|senha|token)\s*[:=]\s*\S+)/i.test(text))throw new Error('Do not send credentials in chat');
  const turns=state.turns; for(const t of turns)if(t.plan?.status==='ready')t.plan.status='dismissed';
  turns.push({id:randomUUID(),role:'user',text}); this.save(actor,turns);this.busy.add(actor);
  try {
   const direct=/^(?:por favor[,\s]+|please\s+)?(?:quero\s+|pode\s+|can you\s+)?(?:conectar|conecte|connect)\s+(?:o\s+|ao\s+|the\s+)?granola[.!?\s]*$/i.test(text);
   const reply=direct?{reply:language==='pt'?'Vou abrir o login do Granola. Conclua a autorização no navegador; acompanharei a conexão aqui.':'I will open Granola sign-in. Complete authorization in your browser; I will track the connection here.',action:'granola.connect',args:{}}:replySchema.parse(JSON.parse((await respond(text,turns.slice(-12))).trim().replace(/^```(?:json)?\s*|\s*```$/g,'')));
   let plan:ConfigurationTurn['plan'];
   if(reply.action){if(!(reply.action in configurationSchemas))throw new Error('Unsupported configuration action');const action=reply.action as ConfigurationAction;const args=configurationSchemas[action].parse(reply.args);plan={id:randomUUID(),action,args,status:'ready'};}
   turns.push({id:randomUUID(),role:'assistant',text:reply.reply,plan});this.save(actor,turns);
   return {state:{...this.state(actor),pending:false},autoStart:direct?plan?.id:undefined};
  } catch(e){turns.push({id:randomUUID(),role:'assistant',text:language==='pt'?'Não consegui preparar essa configuração. Nenhuma ação foi iniciada. Reformule o pedido ou conecte um serviço de IA.':'I could not prepare this configuration. No action was started. Rephrase the request or connect an AI service.'});this.save(actor,turns);throw e;}
  finally {this.busy.delete(actor);}
 }
 async execute(actor:string,id:string,run:(action:ConfigurationAction,args:Record<string,unknown>)=>Promise<unknown>,language:'pt'|'en') {
  if(this.busy.has(actor))throw new Error('Configuration already in progress');
  const turns=this.state(actor).turns; const turn=turns.find(t=>t.plan?.id===id); const plan=turn?.plan;
  if(!plan)throw new Error('Plan unavailable');
  if(plan.status==='done')return this.state(actor);
  if(plan.status!=='ready')throw new Error('Plan is no longer ready; check state before preparing a new one');
  configurationSchemas[plan.action].parse(plan.args);
  const completionLanguage=plan.action==='appearance'&&(plan.args.language==='pt'||plan.args.language==='en')?plan.args.language:language;
  plan.status='running';this.save(actor,turns);this.busy.add(actor);
  try {
   const result=await run(plan.action,plan.args) as {ok?:boolean;success?:boolean;error?:string}|undefined;
   if(result&&(result.ok===false||result.success===false||result.error))throw new Error('Action did not complete');
   plan.status='done';turns.push({id:randomUUID(),role:'assistant',text:plan.action==='project.connection'?(completionLanguage==='pt'?'Conexão preparada, ainda sem autenticação. Abra Acessos do projeto para conectar a conta e escolher onde ela será usada.':'Connection prepared, not authenticated yet. Open Project access to connect the account and choose where it will be used.'):plan.action==='provider.key'?(completionLanguage==='pt'?'Chave salva com segurança. A validade será verificada no primeiro uso.':'Key saved securely. Validity will be checked on first use.'):(completionLanguage==='pt'?'Configuração concluída. Você pode continuar por aqui.':'Configuration completed. You can continue here.')});
  } catch {plan.status='failed';turns.push({id:randomUUID(),role:'assistant',text:language==='pt'?'Não foi possível concluir. Confira a conexão antes de tentar novamente. Uma autenticação cancelada não significa conta conectada.':'Could not complete. Check the connection before trying again. Cancelled sign-in does not mean the account is connected.'});}
  finally {this.save(actor,turns);this.busy.delete(actor);}
  return this.state(actor);
 }
 dismiss(actor:string,id:string){const turns=this.state(actor).turns;const plan=turns.find(t=>t.plan?.id===id)?.plan;if(plan?.status==='ready'){plan.status='dismissed';this.save(actor,turns);}return this.state(actor);}
}
