import { actionDecision } from '../governance/ActionPolicy.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { StorageManager } from '../storage/StorageManager.js';
import { WorkManager } from '../work/WorkManager.js';
import { AgentManager } from '../agent/AgentManager.js';
import { CheckpointStore, fingerprint } from '../execution/CheckpointStore.js';
import { McpManager, mcpConfigSchema } from '../mcp/McpManager.js';
import { MemoryManager } from '../integrations/MemoryManager.js';
import { costFromUsage } from '../../shared/models.js';
import type { AgentExecution, Approval } from '../../shared/types.js';

export const principalSchema = z.object({ id:z.string().min(1), tokenEnv:z.string().min(1), role:z.enum(['reader','contributor','reviewer','admin']), projects:z.array(z.string().min(1)).min(1), agents:z.array(z.string().min(1)).min(1) });
export type Principal = z.infer<typeof principalSchema>;
export const workspaceConfigSchema = z.object({
  version:z.literal(1), workspace:z.string(), maxConcurrent:z.number().int().min(1).max(32).default(4),
  agents:z.array(z.object({id:z.string().min(1),name:z.string().min(1),model:z.string().min(1),prompt:z.string().min(1),maxTokens:z.number().int().min(1).max(32768).default(4096),monthlyBudgetUsd:z.number().positive(),tools:z.array(z.string().regex(/^(file_read|file_list|pdf_read|sheet_read|personalbrain_search|get_current_time|mcp_[a-zA-Z0-9_-]+)$/)).default(['file_read','file_list','get_current_time'])})).min(1),
  mcp:z.array(mcpConfigSchema).default([]),
  routines:z.array(z.object({agentId:z.string(),name:z.string(),prompt:z.string(),project:z.string().default('Workspace'),intervalMinutes:z.number().int().min(1),autonomy:z.enum(['draft','run']).default('draft')})).default([]),
  server:z.object({host:z.string().default('127.0.0.1'),port:z.number().int().min(0).max(65535).default(47830),principals:z.array(principalSchema).min(1)}).optional(),
});
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export class WorkspaceRuntime {
  readonly storage:StorageManager; readonly work:WorkManager; readonly manager = new AgentManager();
  readonly checkpoints:CheckpointStore; readonly mcp:McpManager;
  private pending = new Set<Promise<unknown>>();
  constructor(readonly config:WorkspaceConfig, dataDir:string, configDir:string) {
    if (new Set(config.agents.map(a=>a.id)).size !== config.agents.length) throw new Error('Agent IDs must be unique');
    if (new Set(config.routines.map(r=>`${r.agentId}:${r.name}`)).size !== config.routines.length) throw new Error('Routine names must be unique per agent');
    if (config.routines.some(r=>!config.agents.some(a=>a.id===r.agentId))) throw new Error('Routine references unknown agent');
    this.storage = new StorageManager(dataDir); this.storage.recoverInterruptedExecutions();
    this.work = new WorkManager(this.storage,true); this.checkpoints = new CheckpointStore(this.storage);
    this.manager.setCheckpointStore(this.checkpoints); this.mcp = new McpManager(this.manager.getToolRegistry());
    const memory = new MemoryManager(this.storage);
    this.manager.getToolRegistry().setContext({workspaceDir:path.resolve(configDir,config.workspace),personalBrainSearch:async(q,n)=>memory.search(q,n)});
    this.manager.setConstraintsProvider(()=>({policy:{fileAccess:'workspace',shellAccess:'disabled'}}));
    this.manager.setUsageRecorder(r=>this.storage.saveLlmUsage({...r,promptTokens:r.usage.promptTokens,completionTokens:r.usage.completionTokens,costUsd:r.costUsd??costFromUsage(r.model,r.usage.promptTokens,r.usage.completionTokens),partial:r.partial??false}));
    this.manager.setBudgetChecker((id,_model,estimate)=>{
      const a=config.agents.find(a=>a.id===id); if(!a)throw new Error('Unknown agent');
      const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);
      if(this.storage.getAgentSpendSince(id,start.toISOString())+estimate>a.monthlyBudgetUsd)throw new Error('Monthly budget exceeded');
    });
    this.manager.getToolRegistry().setGate(async(name,args,policy)=>{
      const decision=actionDecision(name,this.mcp.isAutomaticRead(name));
      const pendingId=policy?.executionId&&policy.toolCallKey?this.checkpoints.approval(policy.executionId,policy.toolCallKey):undefined;
      if(!decision.requiresApproval&&!pendingId)return null;
      if(!policy?.executionId||!policy.toolCallKey)throw new Error('Impactful calls require a durable execution');
      const {executionId,toolCallKey}=policy;
      const previous=this.checkpoints.approval(executionId,toolCallKey);
      const existing=previous?this.storage.getApproval(previous):undefined;
      if(previous&&!existing)throw new Error('Saved approval missing');
      const approval:Approval=existing??{id:randomUUID(),type:'agent_action',agentId:policy.callerAgentId||'',agentName:config.agents.find(a=>a.id===policy.callerAgentId)?.name||'',action:`tool:${name}`,context:{tool:name,decisionReason:decision.reason,args,executionId,workTaskId:policy.workTaskId,argsHash:fingerprint(args)},status:'pending',createdAt:new Date().toISOString()};
      if(approval.action!==`tool:${name}`||approval.context.argsHash!==fingerprint(args)||approval.context.executionId!==executionId)throw new Error('Approval binding changed');
      this.storage.saveApproval(approval);this.checkpoints.approval(executionId,toolCallKey,approval.id);
      while(Date.now()-Date.parse(approval.createdAt)<86400000){
        policy.signal?.throwIfAborted();
        const current=this.storage.getApproval(approval.id);
        if(current?.status==='approved')return null;
        if(current?.status==='rejected')return 'Tool action rejected by reviewer';
        await new Promise<void>((resolve,reject)=>{
          const abort=()=>{clearTimeout(timer);reject(policy.signal?.reason);};
          const timer=setTimeout(()=>{policy.signal?.removeEventListener('abort',abort);resolve();},500);
          policy.signal?.addEventListener('abort',abort,{once:true});
        });
      }
      this.storage.updateApprovalStatus(approval.id,'rejected','Approval expired','system');return 'Approval expired';
    });
  }
  async initialize(){await this.mcp.configure(this.config.mcp);}
  agent(id:string){const a=this.config.agents.find(a=>a.id===id);if(!a)throw new Error('Unknown agent');return a;}
  agentConfig(id:string){const a=this.agent(id);return {model:a.model,temperature:0.2,maxTokens:a.maxTokens,systemPrompt:a.prompt,monthlyBudgetUsd:a.monthlyBudgetUsd,tools:a.tools.map(name=>({name,type:'custom' as const,config:{}}))};}
  async execute(agentId:string,input:Record<string,unknown>,actor:string,resumeId?:string):Promise<AgentExecution>{
    const old=resumeId?this.storage.getAgentExecution(resumeId):undefined;
    if(resumeId&&(!old||old.agentId!==agentId||!this.checkpoints.read(resumeId)||(old.status!=='failed'&&!(old.status==='completed'&&this.checkpoints.read(resumeId)?.output))))throw new Error('No resumable execution');
    if(old)input=old.input;
    const principal=this.config.server?.principals.find(p=>p.id===actor);
    if(principal&&Array.isArray(input.projectRules)){
      const all=this.work.snapshot();const allowed=(list:string[],v:string)=>list.includes('*')||list.includes(v);
      const visible=new Set(all.tasks.filter(t=>allowed(principal.projects,t.project)&&allowed(principal.agents,t.agentId)).map(t=>t.id));
      const rules=new Set(all.rules.filter(r=>visible.has(r.sourceTaskId)).map(r=>r.id));
      input={...input,projectRules:input.projectRules.filter(r=>r&&typeof r==='object'&&rules.has((r as {id:string}).id))};
    }
    const id=resumeId??randomUUID();const startedAt=old?.startedAt??new Date().toISOString();
    if(typeof input.workTaskId==='string')this.work.attachExecution(input.workTaskId,id);
    this.storage.saveAgentExecution({id,agentId,input,userId:actor,status:'running',progress:0,startedAt});
    try{
      const result=await this.manager.executeAgent(agentId,this.agentConfig(agentId),input,p=>this.storage.updateAgentExecutionProgress(id,p),id);
      result.userId=actor;this.storage.saveAgentExecution(result);return result;
    }catch(error){this.storage.saveAgentExecution({id,agentId,input,userId:actor,status:'failed',progress:0,startedAt,completedAt:new Date().toISOString(),error:String(error)});throw error;}
  }
  start(taskId:string,actor:string,resume=false){
    const task=this.work.get(taskId);this.work.assertReady(taskId);
    if(this.pending.size>=this.config.maxConcurrent)throw new Error('Concurrent execution limit reached');
    if(resume&&(!task.executionId||!this.checkpoints.read(task.executionId)||task.status!=='blocked'))throw new Error('No resumable checkpoint');
    if(!resume&&task.executionId&&this.checkpoints.read(task.executionId))throw new Error('Resume the checkpoint or request a revision');
    const promise=this.work.run(taskId,(agent,input)=>this.execute(agent,input,actor,resume?task.executionId:undefined));
    this.pending.add(promise);void promise.finally(()=>this.pending.delete(promise)).catch(()=>{});
    return promise;
  }
  cancel(taskId:string){
    for(const run of this.manager.getActiveExecutions())if(run.input.workTaskId===taskId)this.manager.cancelExecution(run.id);
    for(const a of this.storage.getPendingApprovals())if(a.context.workTaskId===taskId)this.storage.updateApprovalStatus(a.id,'rejected','Task cancelled','system');
  }
  async close(){await this.manager.shutdown();await Promise.allSettled([...this.pending]);await this.mcp.close();this.storage.close();}
}
