import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { WorkArtifact } from '../../shared/artifacts.js';
interface Storage { getSetting(key:string):string|null|undefined; setSetting(key:string,value:string):void; }
const input=z.object({name:z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/),content:z.string().min(1).max(100000)}).strict();
/** Immutable text proposals in SQLite. Never writes to the project or executes content. */
export class ArtifactStore {
  constructor(private storage:Storage){}
  list(executionId:string):WorkArtifact[]{
    if(!executionId||executionId.length>200)throw new Error('Execution identity required');
    return JSON.parse(this.storage.getSetting(`artifacts.v1.${executionId}`)||'[]');
  }
  create(executionId:string,raw:unknown):WorkArtifact{
    const {name,content}=input.parse(raw);
    if(Buffer.byteLength(content)>100000)throw new Error('Artifact exceeds 100 KB');
    const records=this.list(executionId);
    const sha256=createHash('sha256').update(content).digest('hex');
    const existing=records.find(a=>a.name===name&&a.sha256===sha256);
    if(existing)return existing;
    if(records.length>=20||records.reduce((sum,a)=>sum+Buffer.byteLength(a.content),0)+Buffer.byteLength(content)>500000)throw new Error('Execution artifact quota exceeded');
    const artifact:WorkArtifact={id:createHash('sha256').update(JSON.stringify([executionId,name,sha256])).digest('hex'),executionId,name,content,sha256,version:records.filter(a=>a.name===name).length+1,createdAt:new Date().toISOString()};
    this.storage.setSetting(`artifacts.v1.${executionId}`,JSON.stringify([...records,artifact]));
    return artifact;
  }
}
