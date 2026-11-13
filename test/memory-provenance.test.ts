import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StorageManager } from '../src/main/storage/StorageManager';
import { MemoryManager } from '../src/main/integrations/MemoryManager';
import { HybridMemory } from '../src/main/integrations/HybridMemory';
import { ToolRegistry } from '../src/main/tools/registry';

async function fixture(run: (memory:MemoryManager, storage:StorageManager, dir:string)=>Promise<void>) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'km-provenance-')); const storage=new StorageManager(dir);
 try { await run(new MemoryManager(storage),storage,dir); } finally { storage.close(); fs.rmSync(dir,{recursive:true,force:true}); }
}
it('retains multiple duplicate sources across restart and includes them in both recall paths',()=>fixture(async(memory,storage,dir)=>{
 await memory.remember('Release deploy uses railway','decision',{reference:'docs/release.md',agentId:'a',executionId:'e1'});
 await memory.remember('Release deploy uses railway','decision',{reference:'meeting:2',agentId:'b',executionId:'e2'});
 expect(storage.getAllMemoryItems()).toHaveLength(1);
 const reopened=new StorageManager(dir);
 try { const item=reopened.getAllMemoryItems()[0]; expect(item.sources).toHaveLength(2); expect(item.sources?.[0].executionId).toBe('e1'); } finally {reopened.close();}
 expect(memory.search('release').text).toContain('Evidence (unverified references)');
 expect((await new HybridMemory(storage,memory).search('release',5,async texts=>texts.map(()=>[1,0]))).text).toContain('meeting:2');
}));
it('preserves typed contradictions and excludes fabricated targets and invalid confidence',()=>fixture(async(memory,storage)=>{
 await memory.remember('Release deploy uses railway'); const old=storage.getAllMemoryItems()[0];
 await memory.remember('Unrelated lunch menu'); const unrelated=storage.getAllMemoryItems().find(m=>m.content.includes('lunch'))!;
 memory.setJudge(async()=>[
 {candidateId:unrelated.id,action:'updates',confidence:1},
 {candidateId:old.id,action:'contradicts',confidence:.9},
 {candidateId:old.id,action:'updates',confidence:1},
 ]);
 await memory.remember('Release deploy avoids railway');
 const current=storage.getAllMemoryItems().find(m=>m.content.includes('avoids'))!;
 expect(current.relations).toEqual([expect.objectContaining({targetId:old.id,type:'contradicts',confidence:.9})]);
 expect(storage.getMemoryItem(old.id)?.validUntil).toBeUndefined();
 expect(storage.getMemoryItem(unrelated.id)?.validUntil).toBeUndefined();
 memory.setJudge(async()=>[{candidateId:old.id,action:'updates',confidence:NaN}]);
 await memory.remember('Release deploy now uses another provider');
 expect(storage.getMemoryItem(old.id)?.validUntil).toBeUndefined();
}));
it('preserves all superseded links and rolls back a failed batch',()=>fixture(async(memory,storage)=>{
 await memory.remember('Release deploy uses railway'); await memory.remember('Release deploy uses vercel');
 const ids=storage.getAllMemoryItems().map(m=>m.id);
 memory.setJudge(async()=>ids.map(candidateId=>({candidateId,action:'updates' as const,confidence:.9})));
 await memory.remember('Release deploy uses local hardware');
 const current=storage.getAllMemoryItems().find(m=>m.content.includes('hardware'))!;
 expect(current.relatedIds?.sort()).toEqual(ids.sort()); expect(current.relations).toHaveLength(2);
 for(const id of ids) expect(storage.getMemoryItem(id)?.supersededBy).toBe(current.id);
 expect(()=>storage.saveMemoryItems([{...current,content:'Changed'}, {...current,id:'invalid',content:null as any}])).toThrow();
 expect(storage.getMemoryItem(current.id)?.content).toContain('hardware');
}));
it('binds provenance to execution context instead of model supplied identities',async()=>{
 const registry=new ToolRegistry(); let evidence:unknown;
 registry.setContext({personalBrainRemember:async(_content,_file,source)=>{evidence=source;return 'saved';}});
 await registry.execute('personalbrain_remember',{content:'hello',source:'issue:3',agentId:'forged',executionId:'forged'},{callerAgentId:'real-agent',executionId:'real-run'});
 expect(evidence).toEqual({reference:'issue:3',agentId:'real-agent',executionId:'real-run'});
});
it('rejects secret and oversized source references before saving',()=>fixture(async(memory,storage)=>{
 await expect(memory.remember('hello','fact',{reference:'api_key: do-not-store'})).rejects.toThrow('secret');
 await expect(memory.remember('hello','fact',{reference:'x'.repeat(1001)})).rejects.toThrow();
 expect(storage.getAllMemoryItems()).toHaveLength(0);
}));
