import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CheckpointStore } from '../src/main/execution/CheckpointStore';
import { StorageManager } from '../src/main/storage/StorageManager';
import { AgentManager } from '../src/main/agent/AgentManager';
import { ToolRegistry } from '../src/main/tools/registry';
const config = { model: 'gpt-4o-mini', temperature: 0, maxTokens: 100, systemPrompt: 'Test', tools: [{ name: 'effect', type: 'custom' as const, config: {} }] };
const response = { model: config.model, usage: { prompt_tokens: 2, completion_tokens: 3 }, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [1,2].map(n => ({ type: 'function', id: `call${n}`, function: { name: 'effect', arguments: JSON.stringify({ n }) } })) } }] };
const final = { model: config.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Delivered' } }] };
function client(manager: AgentManager, create: (...args: any[]) => any) { (manager as any).openaiClients.set('default', { chat: { completions: { create } } }); }
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'km-checkpoint-')); let storage = new StorageManager(dir); return { get storage() { return storage; }, reopen() { storage.close(); storage = new StorageManager(dir); return storage; }, close() { storage.close(); fs.rmSync(dir,{recursive:true,force:true}); } }; }

it('restarts with cached provider responses and tool results, charging only new calls', async () => {
  const f = fixture(); const effects: number[] = []; let calls = 0; let charges = 0;
  try {
    const first = new AgentManager(); first.setCheckpointStore(new CheckpointStore(f.storage));
    first.setUsageRecorder(() => { charges++; });
    client(first, async () => { calls++; return response; });
    first.getToolRegistry().register({ name:'effect', description:'', parameters:{}, handler:async args => { effects.push(Number(args.n)); return 'done'; } });
    first.getToolRegistry().setGate(async (_name,args) => { if (args.n === 2) throw new Error('process interrupted waiting for review'); return null; });
    await expect(first.executeAgent('a', config, {}, undefined, 'run')).rejects.toThrow('interrupted');
    const second = new AgentManager(); second.setCheckpointStore(new CheckpointStore(f.reopen()));
    second.setUsageRecorder(() => { charges++; });
    client(second, async (request) => { calls++; expect(request.messages.filter((m:any) => m.role === 'tool')).toHaveLength(2); return final; });
    second.getToolRegistry().register({ name:'effect', description:'', parameters:{}, handler:async args => { effects.push(Number(args.n)); return 'done'; } });
    const result = await second.executeAgent('a', config, {}, undefined, 'run');
    expect(result.output?.content).toBe('Delivered'); expect(effects).toEqual([1,2]); expect(calls).toBe(2); expect(charges).toBe(2);
    await second.executeAgent('a', config, {}, undefined, 'run'); expect(calls).toBe(2);
  } finally { f.close(); }
});
it('never replays an uncertain effect until a human supplies the verified result', async () => {
  const f = fixture(); let effects = 0;
  try {
    let journal = new CheckpointStore(f.storage); journal.open('run',{},'');
    await expect(journal.tool('run','step','send',{},async started => { started(); effects++; throw new Error('connection lost after sending'); })).rejects.toThrow('connection lost');
    journal = new CheckpointStore(f.reopen());
    await expect(journal.tool('run','step','send',{},async started => { started(); effects++; return 'duplicate'; })).rejects.toThrow('Uncertain effect');
    journal.reconcile('run','step','Verified message ID 123','admin');
    expect(await journal.tool('run','step','send',{},async () => 'duplicate')).toBe('Verified message ID 123');
    expect(effects).toBe(1); expect(journal.steps('run')[0].reconciledBy).toBe('admin');
    await expect(journal.tool('run','step','send',{changed:true},async () => 'bad')).rejects.toThrow('changed');
    expect(() => journal.open('run',{changed:true},'')).toThrow('configuration changed');
  } finally { f.close(); }
});
it('retains only restartable approvals and reuses the exact binding', async () => {
  const f = fixture();
  try {
    let journal = new CheckpointStore(f.storage); journal.open('run',{},'');
    await expect(journal.tool('run','step','send',{},async () => {
      f.storage.saveApproval({id:'approval', type:'agent_action', agentId:'a',agentName:'A',action:'tool:send',context:{executionId:'run'},status:'pending',createdAt:new Date().toISOString()});
      journal.approval('run','step','approval'); throw new Error('restart');
    })).rejects.toThrow('restart');
    f.storage.saveApproval({id:'legacy',type:'agent_action',agentId:'a',agentName:'A',action:'send',context:{},status:'pending',createdAt:new Date().toISOString()});
    const storage = f.reopen(); storage.recoverInterruptedExecutions(); journal = new CheckpointStore(storage);
    expect(storage.getApproval('approval')?.status).toBe('pending'); expect(storage.getApproval('legacy')?.status).toBe('rejected');
    expect(journal.approval('run','step')).toBe('approval');
  } finally { f.close(); }
});
it('persists started before invoking a handler and fails closed when saving fails', async () => {
  const values = new Map<string,string>(); let fail = false; let effects = 0;
  const journal = new CheckpointStore({getSetting:key=>values.get(key),setSetting:(key,value)=>{if(fail) throw new Error('disk full'); values.set(key,value);}});
  journal.open('run',{},'');
  await expect(journal.tool('run','step','send',{},async started => { fail = true; started(); effects++; return 'done'; })).rejects.toThrow('disk full');
  expect(effects).toBe(0);
});
it('enforces current tool permissions even for a cached result', async () => {
  const f = fixture();
  try {
    const cp = new CheckpointStore(f.storage); cp.open('run',{},'');
    const registry = new ToolRegistry();
    const policy = {checkpoint:cp,executionId:'run',toolCallKey:'t',allowedTools:['get_current_time']};
    await registry.execute('get_current_time',{},policy);
    await expect(registry.execute('get_current_time',{}, {...policy,allowedTools:[]})).rejects.toThrow('not authorized');
  } finally { f.close(); }
});
it('reconstructs Anthropic tool results after restart without executing them twice', async () => {
  const f = fixture(); let effects = 0; let calls = 0;
  const cfg = { ...config, model:'claude-sonnet-4-5' };
  const toolResponse = {model:cfg.model,usage:{input_tokens:1,output_tokens:1}, stop_reason:'tool_use', content:[{type:'tool_use',id:'c1',name:'effect',input:{}}]};
  try {
    const first = new AgentManager(); first.setCheckpointStore(new CheckpointStore(f.storage));
    first.getToolRegistry().register({name:'effect',description:'',parameters:{},handler:async()=>{effects++;return 'verified';}});
    (first as any).anthropicClients.set('default',{messages:{create:async()=>{calls++; if(calls===1)return toolResponse;throw new Error('network down');}}});
    await expect(first.executeAgent('a',cfg,{},undefined,'anthropic')).rejects.toThrow('network down');
    const second = new AgentManager(); second.setCheckpointStore(new CheckpointStore(f.reopen()));
    second.getToolRegistry().register({name:'effect',description:'',parameters:{},handler:async()=>{effects++;return 'duplicate';}});
    (second as any).anthropicClients.set('default',{messages:{create:async(request:any)=>{expect(request.messages[2].content[0].content).toBe('verified');return {model:cfg.model,stop_reason:'end_turn',content:[{type:'text',text:'Done'}]};}}});
    expect((await second.executeAgent('a',cfg,{},undefined,'anthropic')).output?.content).toBe('Done'); expect(effects).toBe(1);
  } finally { f.close(); }
});
it('reconstructs Codex responses and tool outputs after restart', async () => {
  const f = fixture(); const originalFetch = globalThis.fetch; let calls = 0; let effects = 0;
  const cfg = {...config,model:'gpt-5.4'};
  const sse = (output: unknown[]) => new Response('data: '+JSON.stringify({type:'response.completed',response:{model:cfg.model,usage:{input_tokens:1,output_tokens:1},output}})+'\n\n');
  try {
    globalThis.fetch = async () => { calls++; if(calls===1)return sse([{type:'function_call',call_id:'c1',name:'effect',arguments:'{}'}]); throw new Error('network down'); };
    const first = new AgentManager(); first.setCheckpointStore(new CheckpointStore(f.storage)); first.setOAuthToken('openai','test');
    first.getToolRegistry().register({name:'effect',description:'',parameters:{},handler:async()=>{effects++;return 'saved';}});
    await expect(first.executeAgent('a',cfg,{},undefined,'codex')).rejects.toThrow('network down');
    const second = new AgentManager(); second.setCheckpointStore(new CheckpointStore(f.reopen())); second.setOAuthToken('openai','test');
    second.getToolRegistry().register({name:'effect',description:'',parameters:{},handler:async()=>{effects++;return 'duplicate';}});
    globalThis.fetch = async (_url, options) => { const body = JSON.parse(String(options?.body)); expect(body.input[2].output).toBe('saved'); return sse([{type:'message',content:[{type:'output_text',text:'Done'}]}]); };
    expect((await second.executeAgent('a',cfg,{},undefined,'codex')).output?.content).toBe('Done'); expect(effects).toBe(1);
  } finally { globalThis.fetch = originalFetch; f.close(); }
});
