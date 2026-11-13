import { it, expect } from 'vitest';
import path from 'node:path';
import { actionDecision } from '../src/main/governance/ActionPolicy';
import { WorkManager } from '../src/main/work/WorkManager';
import { McpManager } from '../src/main/mcp/McpManager';
import { ToolRegistry } from '../src/main/tools/registry';
function setup() { const map=new Map<string,string>(); const storage={getSetting:(k:string)=>map.get(k),setSetting:(k:string,v:string)=>{map.set(k,v);}};return {storage,work:new WorkManager(storage)}; }
const result={id:'run',agentId:'a',status:'completed' as const,progress:100,input:{},output:{content:'Report with evidence'}};
it('delivers routine work without claiming human acceptance and releases dependencies',async()=>{
 const {work,storage}=setup();const task=work.create({goal:'Research',agentId:'a'},'alice');
 const child=work.create({goal:'Summarize',agentId:'a',dependencies:[task.id]},'alice');
 await work.run(task.id,async()=>result);
 expect(work.get(task.id).status).toBe('done');expect(work.get(task.id).acceptedAt).toBeUndefined();expect(work.get(task.id).completedAt).toBeTruthy();
 await work.run(child.id,async()=>result);expect(work.get(child.id).status).toBe('done');
 expect(new WorkManager(storage).get(task.id).reviewRequired).toBe(false);
 work.change(task.id,'revise','Correct the source');expect(work.get(task.id).status).toBe('backlog');
});
it('keeps legacy review contracts and blocks failed or empty deliveries',async()=>{
 const {work,storage}=setup();const task=work.create({goal:'Review',agentId:'a'},'alice');
 const state=work.snapshot();delete state.tasks[0].reviewRequired;storage.setSetting('work.v1',JSON.stringify(state));
 const legacy=new WorkManager(storage);await legacy.run(task.id,async()=>result);expect(legacy.get(task.id).status).toBe('review');
 const empty=work.create({goal:'Empty',agentId:'a'},'alice');await work.run(empty.id,async()=>({...result,output:{content:''}}));expect(work.get(empty.id).status).toBe('blocked');
 const failed=work.create({goal:'Failed',agentId:'a'},'alice');await work.run(failed.id,async()=>({...result,status:'failed'}));expect(work.get(failed.id).status).toBe('blocked');
});
it('requires decisions for impactful and unknown tools while routine tools proceed',()=>{
 for(const name of ['file_read','file_list','personalbrain_search','delegate_to_agent'])expect(actionDecision(name).requiresApproval).toBe(false);
 for(const name of ['shell_exec','file_write','sheet_write','whatsapp_send_message','composio_execute','unknown','create_agent'])expect(actionDecision(name,true).requiresApproval).toBe(true);
 expect(actionDecision('mcp_docs_lookup',false).requiresApproval).toBe(true);
 expect(actionDecision('mcp_docs_lookup',true).requiresApproval).toBe(false);
});
it('requires explicit owner authorization for MCP reads and retains tool allowlists',async()=>{
 const registry=new ToolRegistry();const manager=new McpManager(registry);
 const config={id:'fixture',transport:'stdio',command:process.execPath,args:[path.resolve('test/fixtures/mcp-server.mjs')],enabled:true};
 try {
  let status=await manager.configure([config]);let name=status[0].tools[0];expect(manager.isAutomaticRead(name)).toBe(false);
  status=await manager.configure([{...config,automaticReadTools:['echo']}]);name=status[0].tools[0];expect(manager.isAutomaticRead(name)).toBe(true);
  registry.setGate(async n=>actionDecision(n,manager.isAutomaticRead(n)).requiresApproval?'Needs approval':null);
  expect(await registry.execute(name,{text:'automatic'},{allowedTools:[name]})).toContain('automatic');
  await expect(registry.execute(name,{text:'denied'},{allowedTools:[]})).rejects.toThrow('not authorized');
  await manager.configure([{...config,args:[...config.args,'--destructive'],automaticReadTools:['echo']}]);expect(manager.isAutomaticRead(name)).toBe(false);
  await manager.close();expect(manager.isAutomaticRead(name)).toBe(false);
 } finally {await manager.close();}
},20000);
