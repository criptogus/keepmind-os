import { it,expect } from 'vitest';
import { ArtifactStore } from '../src/main/artifacts/ArtifactStore';
import { ToolRegistry } from '../src/main/tools/registry';
import { actionDecision } from '../src/main/governance/ActionPolicy';
function setup(){const data=new Map<string,string>();const storage={getSetting:(k:string)=>data.get(k),setSetting:(k:string,v:string)=>{data.set(k,v);}};return {store:new ArtifactStore(storage),storage};}
it('keeps immutable versions, reuses identical writes and isolates executions',()=>{
 const {store,storage}=setup();const first=store.create('run-a',{name:'fix.patch',content:'first'});
 expect(store.create('run-a',{name:'fix.patch',content:'first'})).toEqual(first);
 const second=store.create('run-a',{name:'fix.patch',content:'second'});expect(second.version).toBe(2);expect(second.sha256).not.toBe(first.sha256);
 expect(new ArtifactStore(storage).list('run-a').map(a=>a.content)).toEqual(['first','second']);expect(store.list('run-b')).toEqual([]);
});
it('rejects traversal, missing execution and quota excess without changing saved artifacts',()=>{
 const {store}=setup();for(const name of ['../x','/tmp/x','folder/x','..\\x'])expect(()=>store.create('a',{name,content:'x'})).toThrow();
 expect(()=>store.create('',{name:'x',content:'x'})).toThrow();
 expect(()=>store.create('a',{name:'x',content:'é'.repeat(60000)})).toThrow('100 KB');
 for(let i=0;i<5;i++)store.create('a',{name:`file${i}`,content:'x'.repeat(100000)});
 expect(()=>store.create('a',{name:'extra',content:'x'})).toThrow('quota');expect(store.list('a')).toHaveLength(5);
});
it('saves artifacts automatically with runtime identity while enforcing assigned tools',async()=>{
 const {store}=setup();const registry=new ToolRegistry();registry.setContext({createArtifact:(id,args)=>store.create(id,args)});
 registry.setGate(async name=>actionDecision(name).requiresApproval?'needs approval':null);
 expect(await registry.execute('artifact_create',{name:'report.md',content:'Evidence',executionId:'forged'},{executionId:'real',allowedTools:['artifact_create']})).toContain('draft artifact saved');
 expect(store.list('real')).toHaveLength(1);expect(store.list('forged')).toHaveLength(0);
 await expect(registry.execute('artifact_create',{name:'x',content:'x'},{executionId:'real',allowedTools:[]})).rejects.toThrow('not authorized');
 await expect(registry.execute('artifact_create',{name:'x',content:'x'})).rejects.toThrow('persistent execution');
});
