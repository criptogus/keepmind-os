import { it,expect } from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { WorkspaceRuntime,workspaceConfigSchema,type Principal } from '../src/main/server/WorkspaceRuntime';
import { WorkspaceApi,authenticate } from '../src/main/server/WorkspaceApi';
import { validateEndpoint,mcpToolName } from '../src/main/mcp/McpManager';
const alice:Principal={id:'alice',tokenEnv:'ALICE_TOKEN',role:'contributor',projects:['app'],agents:['a']};
const bob:Principal={...alice,id:'bob',tokenEnv:'BOB_TOKEN',role:'reviewer'};
const reader:Principal={...alice,id:'reader',role:'reader'};
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'km-server-'));const config=workspaceConfigSchema.parse({version:1,workspace:'.',agents:[{id:'a',name:'A',model:'gpt-4o-mini',prompt:'Read',monthlyBudgetUsd:5,tools:[]},{id:'private',name:'Private',model:'gpt-4o-mini',prompt:'Private',monthlyBudgetUsd:5,tools:[]}],server:{principals:[alice,bob,reader]}});const runtime=new WorkspaceRuntime(config,dir,dir);runtime.manager.clearApiKey('openai');runtime.manager.clearApiKey('anthropic');return {runtime,api:new WorkspaceApi(runtime),async close(){await runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};}
const input={reviewRequired:true,goal:'Review docs',project:'app',agentId:'a'};
it('authenticates scoped tokens without accepting missing, short or wrong secrets',()=>{
  expect(authenticate([alice],'Bearer '+'x'.repeat(32),{ALICE_TOKEN:'x'.repeat(32)}).id).toBe('alice');
  for(const token of [undefined,'Bearer wrong','Basic x'])expect(()=>authenticate([alice],token,{ALICE_TOKEN:'x'.repeat(32)})).toThrow();
  expect(()=>authenticate([alice],'Bearer short',{ALICE_TOKEN:'short'})).toThrow();
});
it('shares authorized projects, denies other projects/agents and prevents reader mutation',async()=>{
  const f=fixture();try{
    const t=f.api.call(alice,'work:create',[input],'request-one-123456') as any;
    f.runtime.work.create({...input,project:'secret'},'admin');f.runtime.work.create({...input,agentId:'private'},'admin');
    expect(f.api.snapshot(bob).tasks.map(t=>t.id)).toEqual([t.id]);expect(f.api.agents(alice).map(a=>a.id)).toEqual(['a']);
    expect(()=>f.api.call(reader,'work:create',[input],'request-reader-123456')).toThrow('contributor');
    expect(()=>f.api.call(alice,'work:create',[{...input,project:'secret'}],'request-secret-123456')).toThrow('denied');
    expect(()=>f.api.call(alice,'work:checkpoint',[f.runtime.work.snapshot().tasks[0].id])).toThrow('unavailable');
  }finally{await f.close();}
});
it('makes task creation idempotent and rejects conflicting concurrent decisions',async()=>{
  const f=fixture();try{
    const a=f.api.call(alice,'work:create',[input],'request-create-123456') as any;
    const b=f.api.call(alice,'work:create',[input],'request-create-123456') as any;expect(a.id).toBe(b.id);
    expect(()=>f.api.call(alice,'work:create',[{...input,goal:'Different'}],'request-create-123456')).toThrow('different input');
    f.api.call(alice,'work:action',[a.id,'comment','first',a.revision]);
    expect(()=>f.api.call(bob,'work:action',[a.id,'comment','stale',a.revision])).toThrow('another device');
    expect(f.runtime.work.get(a.id).events.at(-1)?.actorId).toBe('alice');
    const fresh=f.runtime.work.get(a.id);f.api.call(bob,'work:action',[a.id,'comment','second',fresh.revision]);
    expect(f.runtime.work.get(a.id).events.at(-1)?.text).toBe('second');
  }finally{await f.close();}
});
it('supports shared dependencies and only reviewers can accept deliveries',async()=>{
  const f=fixture();try{
    const parent=f.api.call(alice,'work:create',[input],'request-parent-123456') as any;
    const child=f.api.call(bob,'work:create',[{...input,goal:'Follow up',dependencies:[parent.id]}],'request-child-123456') as any;
    expect(()=>f.api.call(alice,'work:action',[child.id,'run','',child.revision])).toThrow('accepted');
    await f.runtime.work.run(parent.id,async()=>({id:'r',agentId:'a',status:'completed',progress:100,input:{},output:{content:'Done'}}));
    const t=f.runtime.work.get(parent.id);expect(()=>f.api.call(alice,'work:action',[t.id,'accept','',t.revision])).toThrow('reviewer');
    f.api.call(bob,'work:action',[t.id,'accept','',t.revision]);expect(f.runtime.work.get(t.id).status).toBe('done');
  }finally{await f.close();}
});
it('does not expose or decide approvals outside the project grant',async()=>{
  const f=fixture();try{
    const t=f.runtime.work.create({...input,project:'secret'},'admin');
    f.runtime.storage.saveApproval({id:'private',type:'agent_action',agentId:'a',agentName:'A',action:'tool:x',context:{workTaskId:t.id},status:'pending',createdAt:new Date().toISOString()});
    expect(f.api.approvals(bob)).toEqual([]);expect(()=>f.api.call(bob,'governance:approve',['private'])).toThrow('unavailable');
  }finally{await f.close();}
});
it('keeps a failing execution resumable and refuses duplicate active runs',async()=>{
  const f=fixture();try{
    const task=f.runtime.work.create(input,'alice');
    const result=await f.runtime.start(task.id,'alice');expect(result.status).toBe('blocked');expect(result.executionId).toBeTruthy();
    expect(f.runtime.checkpoints.read(result.executionId!)?.version).toBe(1);
    expect(()=>f.runtime.start(task.id,'alice')).toThrow('Resume');
  }finally{await f.close();}
});
it('requires HTTPS for remote endpoints and namespaces tool names deterministically',()=>{
  expect(validateEndpoint('http://127.0.0.1:47830').hostname).toBe('127.0.0.1');
  expect(()=>validateEndpoint('http://remote.example')).toThrow('HTTPS');expect(()=>validateEndpoint('https://user:pass@example.com')).toThrow();
  expect(mcpToolName('docs','a/b')).not.toBe(mcpToolName('docs','a_b'));expect(mcpToolName('docs','x'.repeat(100)).length).toBeLessThanOrEqual(64);
});
