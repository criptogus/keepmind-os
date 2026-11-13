import { describe, it, expect, vi } from 'vitest';
import { WorkManager } from '../src/main/work/WorkManager';
import { WorkConversation } from '../src/main/work/WorkConversation';
import type { ConversationInput, ConversationReply } from '../src/shared/conversation';
import type { AgentExecution } from '../src/shared/types';

const execution = (content: string): AgentExecution => ({ id: 'run', agentId: 'a', input: {}, status: 'completed', progress: 100, output: { content } });
function setup(reply: ConversationReply = { intent: 'answer', reply: 'Explanation from the delivery.', choices: [] }) {
  const data = new Map<string,string>();
  const storage = {getSetting:(k:string)=>data.get(k),setSetting:(k:string,v:string)=>{data.set(k,v);}};
  const work = new WorkManager(storage);
  const task = work.create({ goal: 'Prepare a business proposal', agentId: 'a', reviewRequired: true }, 'owner');
  const respond = vi.fn(async () => execution(JSON.stringify(reply)));
  const runs: Promise<unknown>[] = [];
  const start = vi.fn((id:string) => { work.assertReady(id); runs.push(work.run(id,async()=>execution('New delivery'))); });
  const conversation = new WorkConversation(work,{respond,start});
  let seq=0;
  const send = (text:string,extra:Partial<ConversationInput>={}) => conversation.send(task.id,{requestId:`message-${++seq}`,text,language:'en',...extra},work.get(task.id).revision);
  return {work,task,respond,start,conversation,send,storage,runs};
}
describe('work conversation',()=>{
  it('asks a question, accepts free text, presents a brief and starts only after confirmation',async()=>{
    const f=setup({intent:'clarify',reply:'Who is the audience?',choices:['Small businesses','Consumers']});
    await f.send('',{mode:'prepare'});const question=f.work.get(f.task.id).conversation!.decision!;
    expect(f.start).not.toHaveBeenCalled();expect(f.work.get(f.task.id).status).toBe('backlog');
    expect(()=>f.work.assertReady(f.task.id)).toThrow('conversation');
    f.respond.mockResolvedValue(execution(JSON.stringify({intent:'ready',reply:'A proposal for local retailers.',choices:[]})));
    await f.send('Local retailers',{choice:'clarify',decisionId:question.id});
    const ready=f.work.get(f.task.id).conversation!.decision!;expect(ready.kind).toBe('start');
    await f.send('',{choice:'start',decisionId:ready.id});await Promise.all(f.runs);
    expect(f.start).toHaveBeenCalledTimes(1);expect(f.work.get(f.task.id).deliveries).toHaveLength(1);
    expect(JSON.stringify(f.work.executionInput(f.task.id))).toContain('Local retailers');
  });
  it.each(['Obrigado!','Thank you.','muito obrigada'])('acknowledges %s without a paid call, acceptance or a version',async text=>{
    const f=setup();await f.work.run(f.task.id,async()=>execution('Original'));const before=f.work.get(f.task.id);
    await f.send(text);const after=f.work.get(f.task.id);
    expect(f.respond).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();expect(after.deliveries).toEqual(before.deliveries);expect(after.acceptedAt).toBeUndefined();expect(after.status).toBe('review');
  });
  it('answers a question while preserving the accepted delivery and checkpoint identity',async()=>{
    const f=setup();await f.work.run(f.task.id,async()=>execution('Original'));f.work.change(f.task.id,'accept');const before=f.work.get(f.task.id);
    await f.send('Why did you choose this scope?');const after=f.work.get(f.task.id);
    expect(after.output).toBe(before.output);expect(after.deliveries).toEqual(before.deliveries);expect(after.acceptedAt).toBe(before.acceptedAt);expect(after.executionId).toBe(before.executionId);expect(f.start).not.toHaveBeenCalled();
  });
  it('starts a clear change exactly once and retains v1',async()=>{
    const f=setup({intent:'revise',reply:'I will shorten it.',choices:[]});await f.work.run(f.task.id,async()=>execution('Original'));
    await f.send('Make it shorter');await Promise.all(f.runs);
    expect(f.start).toHaveBeenCalledTimes(1);expect(f.work.get(f.task.id).deliveries?.map(d=>d.version)).toEqual([1,2]);
  });
  it('corrects a blocked first attempt without an existing delivery',async()=>{
    const f=setup({intent:'revise',reply:'I will try the updated request.',choices:[]});
    await f.work.run(f.task.id,async()=>({...execution(''),status:'failed',error:'Provider unavailable'}));
    expect(f.work.get(f.task.id).status).toBe('blocked');
    await f.send('Use a shorter scope and try again');await Promise.all(f.runs);
    expect(f.start).toHaveBeenCalledTimes(1);expect(f.work.get(f.task.id).deliveries?.map(d=>d.version)).toEqual([1]);
    expect(f.work.executionInput(f.task.id).corrections).toEqual(['Use a shorter scope and try again']);
  });
  it('offers an explicit decision for ambiguous feedback and does not interpret a comment as approval',async()=>{
    const f=setup({intent:'ambiguous',reply:'Explain it or revise it?',choices:[]});await f.work.run(f.task.id,async()=>execution('Original'));
    await f.send('Not sure about this');const decision=f.work.get(f.task.id).conversation!.decision!;
    expect(f.start).not.toHaveBeenCalled();await f.send('',{choice:'note',decisionId:decision.id});expect(f.start).not.toHaveBeenCalled();expect(f.work.get(f.task.id).acceptedAt).toBeUndefined();
    await expect(f.send('',{choice:'revise',decisionId:decision.id})).rejects.toThrow('no longer');
  });
  it('rejects model-ready decisions on a delivered conversation',async()=>{
    const f=setup({intent:'ready',reply:'Ready',choices:[]});await f.work.run(f.task.id,async()=>execution('Original'));
    await expect(f.send('Question')).rejects.toThrow('Invalid conversation');expect(f.start).not.toHaveBeenCalled();expect(f.work.get(f.task.id).output).toBe('Original');
  });
  it('keeps malformed replies recoverable without execution or erasing the message',async()=>{
    const f=setup();f.respond.mockResolvedValue(execution('not JSON'));
    await expect(f.send('Question')).rejects.toThrow();expect(f.work.get(f.task.id).conversation?.error).toBeTruthy();expect(f.work.get(f.task.id).conversation?.pending).toBeUndefined();expect(f.work.get(f.task.id).conversation?.turns[0].text).toBe('Question');expect(f.start).not.toHaveBeenCalled();
    f.respond.mockResolvedValue(execution(JSON.stringify({intent:'answer',reply:'Now answered',choices:[]})));await f.send('Question');expect(f.work.get(f.task.id).conversation?.error).toBeUndefined();
  });
  it('makes duplicate messages idempotent and detects changed payloads',async()=>{
    const f=setup();const input:ConversationInput={requestId:'unique-123',text:'Question',language:'en'};const revision=f.work.get(f.task.id).revision;
    await f.conversation.send(f.task.id,input,revision);await f.conversation.send(f.task.id,input,revision);expect(f.respond).toHaveBeenCalledTimes(1);
    await expect(f.conversation.send(f.task.id,{...input,text:'Different'},revision)).rejects.toThrow('reused');
  });
  it('ignores a late classification after cancellation',async()=>{
    const f=setup();let resolve!:(r:AgentExecution)=>void;f.respond.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const pending=f.send('Start something');expect(f.work.get(f.task.id).conversation?.pending).toBeTruthy();f.work.change(f.task.id,'cancel');resolve(execution(JSON.stringify({intent:'revise',reply:'Changing',choices:[]})));await pending;
    expect(f.start).not.toHaveBeenCalled();expect(f.work.get(f.task.id).status).toBe('cancelled');
  });
  it('saves messages during execution as next-revision notes, without claiming they changed that execution',async()=>{
    const f=setup();let resolve!:(r:AgentExecution)=>void;const running=f.work.run(f.task.id,()=>new Promise(r=>{resolve=r;}));
    await f.send('A note while running');expect(f.respond).not.toHaveBeenCalled();expect(f.work.get(f.task.id).conversation?.turns.at(-1)?.text).toContain('does not change');resolve(execution('Original'));await running;
    expect(f.work.executionInput(f.task.id).notes).toEqual(['A note while running']);
  });
  it('persists pending decisions and marks interrupted replies recoverable on restart',async()=>{
    const f=setup({intent:'clarify',reply:'Audience?',choices:['Businesses']});await f.send('',{mode:'prepare'});
    expect(new WorkManager(f.storage).get(f.task.id).conversation?.decision?.kind).toBe('clarify');
    f.work.updateConversation(f.task.id,c=>{c.pending='interrupted';});const restarted=new WorkManager(f.storage).get(f.task.id);
    expect(restarted.conversation?.pending).toBeUndefined();expect(restarted.conversation?.error).toBe('interrupted');
  });
});

it('preserves the original request when preparation hands off to inline configuration',async()=>{
 const f=setup({intent:'configure',reply:'I can prepare this connection here.',choices:[]});
 const result=await f.send('',{mode:'prepare'});
 expect(result.conversation?.decision).toMatchObject({kind:'configure',sourceText:f.task.goal});
 expect(f.start).not.toHaveBeenCalled();
});
