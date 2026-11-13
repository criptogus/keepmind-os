import { ArtifactStore } from '../artifacts/ArtifactStore.js';
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { fingerprint } from '../execution/CheckpointStore.js';
import type { WorkspaceRuntime, Principal } from './WorkspaceRuntime.js';
import type { WorkAction } from '../../shared/work.js';

export class ApiError extends Error { constructor(readonly status:number,message:string){super(message);} }
const rank={reader:0,contributor:1,reviewer:2,admin:3};
const has=(list:string[],value:string)=>list.includes('*')||list.includes(value);
const createSchema=z.object({reviewRequired:z.boolean().optional(),goal:z.string().trim().min(1).max(12000),agentId:z.string().min(1),project:z.string().trim().min(1).max(100).default('Workspace'),criteria:z.string().max(4000).optional(),dependencies:z.array(z.string()).max(100).optional()}).strict();
export class WorkspaceApi {
  constructor(readonly runtime:WorkspaceRuntime){}
  private role(actor:Principal,level:keyof typeof rank){if(rank[actor.role]<rank[level])throw new ApiError(403,`Requires ${level} access`);}
  private task(actor:Principal,id:string){
    const task=this.runtime.work.snapshot().tasks.find(t=>t.id===id);
    if(!task||!has(actor.projects,task.project)||!has(actor.agents,task.agentId))throw new ApiError(404,'Task unavailable');
    return task;
  }
  private revision(actual:number,expected:unknown){if(!Number.isInteger(expected)||expected!==actual)throw new ApiError(409,'Work changed on another device. Refresh and review the current version.');}
  snapshot(actor:Principal){
    const all=this.runtime.work.snapshot();const tasks=all.tasks.filter(t=>has(actor.projects,t.project)&&has(actor.agents,t.agentId));
    const ids=new Set(tasks.map(t=>t.id));
    return {tasks,rules:all.rules.filter(r=>ids.has(r.sourceTaskId))};
  }
  agents(actor:Principal){return this.runtime.config.agents.filter(a=>has(actor.agents,a.id)).map(a=>({id:a.id,name:a.name,description:'Server agent',config:this.runtime.agentConfig(a.id),capabilities:[],permissions:{canAccessNetwork:true,canAccessFileSystem:true,canExecuteCode:false,maxExecutionTime:300000},createdAt:'',updatedAt:''}));}
  approvals(actor:Principal){const ids=new Set(this.snapshot(actor).tasks.map(t=>t.id));return this.runtime.storage.getPendingApprovals().filter(a=>typeof a.context.workTaskId==='string'&&ids.has(a.context.workTaskId));}
  context(actor:Principal){return {snapshot:this.snapshot(actor),agents:this.agents(actor),approvals:this.approvals(actor),connection:{mode:'remote',actor:actor.id,role:actor.role,projects:actor.projects,serverTime:new Date().toISOString()}};}
  call(actor:Principal,method:string,args:unknown[],requestId?:string):unknown{
    const rt=this.runtime;
    switch(method){
      case 'work:context':return this.context(actor);
      case 'work:list':return this.snapshot(actor);
      case 'work:export':return JSON.stringify({format:'keepmind-work',version:1,...this.snapshot(actor)},null,2);
      case 'governance:getState':return {pendingApprovals:this.approvals(actor),rules:[]};
      case 'governance:getPendingApprovals':return this.approvals(actor);
      case 'work:create':{
        this.role(actor,'contributor');const input=createSchema.parse(args[0]);
        if(!has(actor.projects,input.project)||!has(actor.agents,input.agentId))throw new ApiError(403,'Project or agent access denied');
        rt.agent(input.agentId);for(const dep of input.dependencies??[])this.task(actor,dep);
        if(!requestId||!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))throw new ApiError(400,'A unique request ID is required');
        return rt.work.create(input,actor.id,{id:`request-${fingerprint([actor.id,requestId])}`,hash:fingerprint(input)});
      }
      case 'work:preview':{
        const task=this.task(actor,String(args[0]));const a=rt.agent(task.agentId);
        return {agentName:a.name,model:a.model,monthlyBudgetUsd:a.monthlyBudgetUsd,tools:rt.manager.previewTools(a.id,rt.agentConfig(a.id),(task.status==='blocked'&&task.executionId?rt.storage.getAgentExecution(task.executionId)?.input:undefined)??rt.work.executionInput(task.id)),dependencies:task.dependencies.map(id=>{const dep=this.task(actor,id);return {id,title:dep.title,accepted:dep.status==='done'};})};
      }
      case 'work:artifacts':{const task=this.task(actor,String(args[0]));return task.executionId?new ArtifactStore(rt.storage).list(task.executionId):[];}
      case 'work:checkpoint':{
        const t=this.task(actor,String(args[0]));return {available:!!t.executionId&&!!rt.checkpoints.read(t.executionId),steps:t.executionId?rt.checkpoints.steps(t.executionId):[]};
      }
      case 'work:action':{
        const [id,action,note,expected]=args;const t=this.task(actor,String(id));
        this.role(actor,action==='accept'||action==='propose-rule'?'reviewer':'contributor');
        this.revision(t.revision,expected);
        if(typeof note!=='undefined'&&(typeof note!=='string'||note.length>4000))throw new ApiError(400,'Invalid note');
        if(!['run','resume','accept','revise','cancel','comment','propose-rule'].includes(String(action)))throw new ApiError(400,'Unknown action');
        if(action==='run'||action==='resume'){void rt.start(t.id,actor.id,action==='resume').catch(()=>{});return rt.work.get(t.id);}
        const changed=rt.work.change(t.id,action as Exclude<WorkAction,'run'|'resume'>,String(note??''),actor.id);
        if(action==='cancel')rt.cancel(t.id);return changed;
      }
      case 'work:reviewRule':{
        this.role(actor,'reviewer');const rule=this.snapshot(actor).rules.find(r=>r.id===args[0]);if(!rule)throw new ApiError(404,'Rule unavailable');
        this.revision(rule.version,args[2]);if(typeof args[1]!=='boolean')throw new ApiError(400,'Invalid decision');
        rt.work.reviewRule(rule.id,args[1],actor.id);return {ok:true};
      }
      case 'work:reconcile':{
        this.role(actor,'reviewer');const t=this.task(actor,String(args[0]));this.revision(t.revision,args[3]);
        if(t.status!=='blocked'||!t.executionId||typeof args[2]!=='string')throw new ApiError(400,'No interrupted work');
        rt.checkpoints.reconcile(t.executionId,String(args[1]),args[2],actor.id);rt.work.change(t.id,'comment',`External result verified for ${args[1]}`,actor.id);return {ok:true};
      }
      case 'governance:approve':case 'governance:reject':{
        this.role(actor,'reviewer');const a=rt.storage.getApproval(String(args[0]));
        if(!a||typeof a.context.workTaskId!=='string')throw new ApiError(404,'Approval unavailable');this.task(actor,a.context.workTaskId);
        if(a.status!=='pending'||Date.now()-Date.parse(a.createdAt)>=86400000)throw new ApiError(409,'Approval already decided or expired');
        rt.storage.updateApprovalStatus(a.id,method==='governance:approve'?'approved':'rejected',String(args[1]??'').slice(0,4000),actor.id);return {ok:true};
      }
      default:throw new ApiError(404,'Method unavailable');
    }
  }
}
export function authenticate(principals:Principal[],authorization:string|undefined,env:NodeJS.ProcessEnv=process.env){
  if(!authorization?.startsWith('Bearer '))throw new ApiError(401,'Authentication required');
  const received=createHash('sha256').update(authorization.slice(7)).digest();
  const actor=principals.find(p=>{const token=env[p.tokenEnv];return token&&token.length>=32&&timingSafeEqual(received,createHash('sha256').update(token).digest());});
  if(!actor)throw new ApiError(401,'Invalid token');return actor;
}
export function createWorkspaceServer(api:WorkspaceApi,principals:Principal[]){
  if(new Set(principals.map(p=>p.id)).size!==principals.length)throw new Error('Principal IDs must be unique');
  const tokens=principals.map(p=>process.env[p.tokenEnv]);
  if(tokens.some(t=>!t||t.length<32)||new Set(tokens).size!==tokens.length)throw new Error('Each principal requires a unique token of at least 32 characters');
  return createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      if(req.headers.origin)throw new ApiError(403,'Browser origins are not supported');
      const actor=authenticate(principals,req.headers.authorization);
      if(req.method==='GET'&&req.url==='/v1/context'){res.end(JSON.stringify(api.context(actor)));return;}
      if(req.method!=='POST'||req.url!=='/v1/call')throw new ApiError(404,'Route unavailable');
      if(!req.headers['content-type']?.startsWith('application/json'))throw new ApiError(415,'JSON required');
      let bytes=0;const chunks:Buffer[]=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024)throw new ApiError(413,'Request too large');chunks.push(chunk);}
      let payload;try{payload=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ApiError(400,'Invalid JSON');}
      const input=z.object({method:z.string(),args:z.array(z.unknown()).max(8)}).strict().parse(payload);
      const value=api.call(actor,input.method,input.args,typeof req.headers['idempotency-key']==='string'?req.headers['idempotency-key']:undefined);
      res.end(JSON.stringify({value:value??null}));
    }catch(error){res.statusCode=error instanceof ApiError?error.status:error instanceof z.ZodError?400:400;res.end(JSON.stringify({error:error instanceof z.ZodError?'Invalid request':error instanceof Error?error.message:'Request failed'}));}
  });
}
