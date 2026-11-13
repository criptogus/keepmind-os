import { it,expect } from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { WorkspaceRuntime,workspaceConfigSchema } from '../../src/main/server/WorkspaceRuntime';
import { WorkspaceApi,createWorkspaceServer } from '../../src/main/server/WorkspaceApi';
import { RemoteWorkspace } from '../../src/main/server/RemoteWorkspace';
it('synchronizes two authenticated clients through real HTTP and preserves state across restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'km-http-'));process.env.KM_TEST_ALICE='a'.repeat(40);process.env.KM_TEST_BOB='b'.repeat(40);
 const config=workspaceConfigSchema.parse({version:1,workspace:'.',agents:[{id:'a',name:'A',model:'gpt-4o-mini',prompt:'Read',monthlyBudgetUsd:5}],server:{principals:[{id:'alice',tokenEnv:'KM_TEST_ALICE',role:'contributor',projects:['app'],agents:['a']},{id:'bob',tokenEnv:'KM_TEST_BOB',role:'reviewer',projects:['app'],agents:['a']}]}});
 let runtime=new WorkspaceRuntime(config,dir,dir);let server=createWorkspaceServer(new WorkspaceApi(runtime),config.server!.principals);
 const listen=()=>new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const stop=()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 try{
  await listen();const port=(server.address() as {port:number}).port;const url=`http://127.0.0.1:${port}`;
  const alice=new RemoteWorkspace(url,process.env.KM_TEST_ALICE!);const bob=new RemoteWorkspace(url,process.env.KM_TEST_BOB!);
  const task=await alice.call('work:create',[{goal:'Shared review',project:'app',agentId:'a'}]) as any;
  expect((await bob.call('work:list') as any).tasks[0].id).toBe(task.id);
  await alice.call('work:action',[task.id,'comment','Alice feedback',task.revision]);
  await expect(bob.call('work:action',[task.id,'comment','Stale feedback',task.revision])).rejects.toThrow('another device');
  const current=(await bob.call('work:list') as any).tasks[0];await bob.call('work:action',[task.id,'comment','Bob feedback',current.revision]);
  expect((await alice.call('work:list') as any).tasks[0].events.at(-1).actorId).toBe('bob');
  expect((await fetch(url+'/v1/context')).status).toBe(401);
  expect((await fetch(url+'/v1/context',{headers:{Authorization:'Bearer '+process.env.KM_TEST_ALICE,Origin:'https://evil.example'}})).status).toBe(403);
  await stop();await runtime.close();runtime=new WorkspaceRuntime(config,dir,dir);server=createWorkspaceServer(new WorkspaceApi(runtime),config.server!.principals);await listen();
  const restored=new RemoteWorkspace(`http://127.0.0.1:${(server.address() as {port:number}).port}`,process.env.KM_TEST_ALICE!);
  expect((await restored.call('work:list') as any).tasks[0].events.at(-1).text).toBe('Bob feedback');
 }finally{if(server.listening)await stop();await runtime.close();delete process.env.KM_TEST_ALICE;delete process.env.KM_TEST_BOB;fs.rmSync(dir,{recursive:true,force:true});}
},20000);
