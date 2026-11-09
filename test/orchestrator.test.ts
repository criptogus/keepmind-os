import { it, expect, vi } from 'vitest';
import { Orchestrator } from '../src/main/orchestrator';
import type { WorkspaceState } from '../src/main/orchestrator';
const provider = { baseUrl: 'http://127.0.0.1:40000/v1', model: 'mock', inputCentsPerMTok: 100, outputCentsPerMTok: 200, maxOutputTokens: 100, maxRunCents: 1 };
function setup() {
    const state: WorkspaceState = { managedAgentIds: [], telemetry: false };
    const request = vi.fn().mockImplementation(async (method, path) => {
        if (path === '/api/cli-auth/me')
            return { userId: 'operator-user' };
        if (path.endsWith('/companies'))
            return { id: 'c' };
        if (path.endsWith('/secrets'))
            return { id: 'secret' };
        if (path.endsWith('/agents'))
            return { id: 'a' };
        if (path.endsWith('/budgets/overview'))
            return { policies: [] };
        return {};
    });
    const save = vi.fn();
    const sleep = vi.fn(async (_ms: number) => {});
    return { state, request, save, sleep, o: new Orchestrator({ request }, state, { node: '/node', runnerPath: '/runner.mjs', cwd: '/tmp' }, save, () => ({ state: 'ready' }), sleep) };
}
it('setup keeps execution off until key, valid cap and explicit consent', async () => {
    const { o, request, state } = setup();
    await o.createCompany('Example');
    await o.setProviderKey('test-only-key');
    await o.createAgentFromTemplate('researcher', provider);
    expect(request.mock.calls.find(c => c[1].endsWith('/agents'))?.[2].adapterConfig.env.ZAOS_PROVIDER_API_KEY).toEqual({ type: 'secret_ref', secretId: 'secret', version: 'latest' });
    expect(request.mock.calls.find(c => c[1].endsWith('/agents'))?.[2].adapterConfig.env.ZAOS_REVIEWER_USER_ID).toBe('operator-user');
    expect(o.getStatus()).toMatchObject({ paidExecution: false });
    await o.setSpendCap(100);
    await expect(o.setPaidExecution(true, false)).rejects.toThrow();
    await o.setPaidExecution(true, true);
    expect(o.getStatus()).toMatchObject({ paidExecution: true });
    await o.setPaidExecution(false, false);
    expect(request.mock.calls.at(-1)?.[1]).toBe('/api/agents/a/pause');
    expect(state.cap).toBe(100);
});
it('rejects task before consent; telemetry persists without sending', async () => {
    const { o, request, save } = setup();
    await expect(o.runTask('Test', 'Task')).rejects.toThrow('disabled');
    await o.setTelemetry(true);
    expect(o.getTelemetry()).toBe(true);
    expect(save).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
});
it('startup never automatically resumes paid execution', async () => {
    const { o, state, request } = setup();
    state.companyId = 'c';
    state.agentId = 'a';
    state.managedAgentIds = ['a'];
    await o.startupAudit();
    expect(request.mock.calls.at(-1)?.[1]).toBe('/api/agents/a/pause');
    expect(o.getStatus()).toMatchObject({ paidExecution: false });
});
it('rotates existing runner secret reference while execution remains paused', async () => {
    const { o, state, request } = setup();
    state.companyId = 'c';
    state.agentId = 'a';
    state.managedAgentIds = ['a'];
    request.mockImplementation(async (method, path) => {
        if (path.endsWith('/secrets'))
            return { id: 'rotated' };
        if (method === 'GET' && path === '/api/agents/a')
            return { adapterConfig: { command: '/node', args: ['/runner.mjs'], env: { ZAOS_PROVIDER_MODEL: 'mock' } } };
        return {};
    });
    await o.setProviderKey('new-key');
    expect(request.mock.calls.find(c => c[0] === 'PATCH' && c[1] === '/api/agents/a')?.[2].adapterConfig.env.ZAOS_PROVIDER_API_KEY.secretId).toBe('rotated');
    expect(o.getStatus()).toMatchObject({ paidExecution: false });
});
it.each(['succeeded', 'cancelled', 'missing receipt', 'refused', 'wrong reviewer', 'failed', 'event only', 'no unpriced', 'delayed handoff'])('handles task outcome: %s',async scenario=>{
 const priced = !['missing receipt', 'refused'].includes(scenario);
 const {o,state,request,sleep}=setup();state.companyId='c';state.agentId='a';state.managedAgentIds=['a'];state.provider=provider;state.secretId='s';state.cap=100;
 let runQueries=0, qualityQueries=0, issueQueries=0;
 const receipt=JSON.stringify({zaosReceipt:{eventId:'priced',runId:'run',idempotencyKey:'zaos:run',costCents:0.1,costStatus:'reported'}})+'\n';
 request.mockImplementation(async(method,path)=>{
  if(path === '/api/cli-auth/me')return {userId:'operator-user'};
  if(path === '/api/issues/issue')return {id:'issue',status:scenario==='delayed handoff' && ++issueQueries<3?'todo':'in_review',assigneeUserId:scenario==='wrong reviewer'?'other':'operator-user'};
  if(path.endsWith('/heartbeat-runs'))return ++runQueries===1?[]:[{id:'foreign',issueId:'foreign',status:'succeeded'},{id:'run',issueId:'issue',status:scenario==='failed'?'failed':scenario==='succeeded'?'succeeded':'cancelled'}];
  if(path.endsWith('/issues'))return {id:'issue'};
  if(path.endsWith('/costs/data-quality'))return {events:[...(scenario==='event only'?[{id:'priced',heartbeatRunId:'run',idempotencyKey:'zaos:run',costStatus:'reported',costCents:'0.1'}]:[]),...(scenario==='no unpriced'||++qualityQueries<3?[]:[{id:'unpriced',runId:'run',provider:'unknown'}])]};
  if(path.endsWith('/log'))return {content:priced && scenario!=='event only'?JSON.stringify({stream:'stdout',chunk:receipt}):''};
  if(path.endsWith('/comments'))return [{body:'Old result',createdByRunId:'old'},{body:scenario==='refused'?'ZAOS refused: Insufficient capped budget':'Result for review',createdByRunId:'run',createdByAgentId:'a'},{body:'Human reply',createdByRunId:null}];
  if(path==='/api/agents/a')return {spentMonthlyCents:0.1};
  return {};
 });
 await o.setPaidExecution(true,true);
 const result=await o.runTask('Task','Description');
 expect(result.status).toBe(scenario==='refused'?'refused':['missing receipt','wrong reviewer','failed'].includes(scenario)?'failed':'succeeded');expect(result.result).toBe(scenario==='refused'?'ZAOS refused: Insufficient capped budget':'Result for review');
 expect(o.getStatus()).toMatchObject({paidExecution:priced});
 expect(request.mock.calls.filter(c=>c[1].endsWith('/adjustments'))).toHaveLength(priced && scenario!=='no unpriced'?1:0);
 if(scenario==='no unpriced')expect(sleep).toHaveBeenCalledTimes(30);
 if(scenario==='delayed handoff')expect(issueQueries).toBeGreaterThanOrEqual(3);
});

it('does not create an agent without an authenticated human reviewer', async () => {
    const { o, state, request } = setup();
    state.companyId = 'c';
    state.secretId = 's';
    request.mockResolvedValue({});
    await expect(o.createAgentFromTemplate('researcher', provider)).rejects.toThrow('reviewer');
    expect(request.mock.calls.some(c => c[0] === 'POST' && c[1].endsWith('/agents'))).toBe(false);
});
