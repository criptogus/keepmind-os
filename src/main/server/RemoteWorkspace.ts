import { randomUUID } from 'node:crypto';
import { validateEndpoint } from '../mcp/McpManager.js';
export class RemoteWorkspace {
  constructor(readonly url:string,private token:string){
    const base=validateEndpoint(url);if(base.search||base.pathname!=='/')throw new Error('Use the server origin without a path or query');
    if(token.length<32)throw new Error('Workspace token must contain at least 32 characters');
  }
  async call(method:string,args:unknown[]=[]){
    let response:Response;
    try{response=await fetch(new URL('/v1/call',this.url),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.token}`,'Idempotency-Key':randomUUID()},body:JSON.stringify({method,args}),redirect:'error',signal:AbortSignal.timeout(method === 'work:message' ? 90000 : 15000)});}
    catch{throw new Error('Shared workspace unavailable. Check the connection and refresh before retrying. Local work was not changed.');}
    const result=await response.json() as {value?:unknown;error?:string};
    if(!response.ok)throw new Error(result.error||`Workspace request failed (${response.status})`);
    return result.value;
  }
}
