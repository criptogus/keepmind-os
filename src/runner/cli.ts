#!/usr/bin/env node
import { readFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { WorkspaceRuntime, workspaceConfigSchema } from '../main/server/WorkspaceRuntime.js';
import { WorkspaceApi, createWorkspaceServer } from '../main/server/WorkspaceApi.js';
import { TriggerManager } from '../main/agent/TriggerManager.js';

const args=process.argv.slice(2);
const value=(flag:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
if(args.includes('--help')||!value('--config')){
  console.log('KeepMind OS — free MIT workspace\nUsage: npm run runner -- --config examples/workspace.json --task "Review README"\nOptions: --serve, --watch, --list-tools, --data-dir DIR, --agent ID, --accept TASK_ID, --resume TASK_ID, --inspect TASK_ID, --reconcile TASK_ID --step KEY --result-file FILE\nMCP servers and scoped workspace tokens are configured in JSON; secrets come from environment variables.');
  process.exit(args.includes('--help')?0:1);
}
const configFile=path.resolve(value('--config')!);const config=workspaceConfigSchema.parse(JSON.parse(readFileSync(configFile,'utf8')));
const dataDir=path.resolve(value('--data-dir')||path.join(homedir(),'.keepmind','runner'));
mkdirSync(dataDir,{recursive:true,mode:0o700});const lock=path.join(dataDir,'runner.lock');
let lockFd:number;try{lockFd=openSync(lock,'wx',0o600);}catch{throw new Error(`Runner data is locked. Verify no runner owns ${lock} before removing a stale lock.`);}
process.on('exit',()=>{closeSync(lockFd);unlinkSync(lock);});
const runtime=new WorkspaceRuntime(config,dataDir,path.dirname(configFile));await runtime.initialize();
const {work,storage,checkpoints}=runtime;
if(args.includes('--list-tools')){console.log(JSON.stringify(runtime.mcp.list(),null,2));await runtime.close();process.exit(0);}
async function run(agentId:string,goal:string,project='Workspace',draft=false){
  runtime.agent(agentId);const task=work.create({goal,agentId,project},'runner');
  const result=draft?task:await runtime.start(task.id,'runner');console.log(JSON.stringify(result));return result;
}
if(value('--inspect')){const task=work.get(value('--inspect')!);console.log(JSON.stringify({task,steps:task.executionId?checkpoints.steps(task.executionId):[]},null,2));await runtime.close();process.exit(0);}
if(value('--reconcile')){const task=work.get(value('--reconcile')!);if(task.status!=='blocked'||!task.executionId||!value('--step')||!value('--result-file'))throw new Error('Use a blocked task with --step and --result-file');checkpoints.reconcile(task.executionId,value('--step')!,readFileSync(value('--result-file')!,'utf8'),'runner');work.change(task.id,'comment',`Verified result for ${value('--step')}`);await runtime.close();process.exit(0);}
if(value('--accept')){console.log(JSON.stringify(work.change(value('--accept')!,'accept')));await runtime.close();process.exit(0);}
if(value('--resume')){const result=await runtime.start(value('--resume')!,'runner',true);console.log(JSON.stringify(result));await runtime.close();process.exit(result.status==='review'?0:1);}
if(value('--task')){const result=await run(value('--agent')||config.agents[0].id,value('--task')!);if(!args.includes('--watch')&&!args.includes('--serve')){await runtime.close();process.exit(result.status==='review'?0:1);}}
let server:ReturnType<typeof createWorkspaceServer>|undefined;let triggers:TriggerManager|undefined;
if(args.includes('--serve')){
  if(!config.server)throw new Error('Configure server principals before using --serve');
  server=createWorkspaceServer(new WorkspaceApi(runtime),config.server.principals);
  server.requestTimeout=20000;
  await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(config.server!.port,config.server!.host,resolve);});
  const addr=server.address();console.log(`Workspace server listening on ${typeof addr==='object'&&addr?addr.port:config.server.port}; ${config.server.principals.length} scoped identities.`);
}
if(args.includes('--watch')){
  triggers=new TriggerManager(k=>storage.getSetting(k),(k,v)=>storage.setSetting(k,v));
  triggers.attach({getAgentName:id=>config.agents.find(a=>a.id===id)?.name,runAgent:async(id,input)=>{
    const trigger=triggers!.list().find(t=>t.id===input.triggerId);
    const routine=config.routines.find(r=>r.agentId===id&&r.name===trigger?.name);
    if(!routine)throw new Error('Routine is not in the current configuration');
    return run(id,routine.prompt,routine.project,routine.autonomy==='draft');
  }});
  for(const old of triggers.list()) if(!config.routines.some(r=>r.agentId===old.agentId&&r.name===old.name)) triggers.update(old.id,{enabled:false});
  for(const routine of config.routines){ const old=triggers.list().find(t=>t.name===routine.name&&t.agentId===routine.agentId); if(old)triggers.update(old.id,{...routine,kind:'interval',enabled:true});else triggers.create({...routine,kind:'interval',enabled:true}); }
}
if(server||triggers){
  const keepAlive=setInterval(()=>{},60000);let stopping=false;
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(stopping)return;stopping=true;triggers?.stop();server?.close();clearInterval(keepAlive);void runtime.close().then(()=>process.exit(0));});
}else await runtime.close();
