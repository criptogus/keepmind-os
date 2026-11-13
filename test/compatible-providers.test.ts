import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { CompatibleProviders, validateProvider } from '../src/main/connectors/CompatibleProviders';
import { AgentManager } from '../src/main/agent/AgentManager';
import { WorkManager } from '../src/main/work/WorkManager';
import { routeModelForTask } from '../src/shared/models';
import type { CompatibleProviderProfile } from '../src/shared/connectors';
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
const profile: CompatibleProviderProfile = { id: 'local', kind: 'custom', name: 'Local fixture', baseUrl: 'http://127.0.0.1:1234/v1', model: 'fixture-model', inputUsdPerMillion: 2, outputUsdPerMillion: 5, maxOutputTokens: 100, maxRunUsd: 1 };
function setup() {
  const values = new Map<string, string>(), keys = new Map<string, string>();
  const settings = { getSetting: (k: string) => values.get(k), setSetting: (k: string, v: string) => { values.set(k, v); } };
  const providers = new CompatibleProviders(settings, { getSecret: k => keys.get(k) ?? null, setSecret: (k, v) => { keys.set(k, v); }, clearSecret: k => { keys.delete(k); } });
  return { settings, values, providers };
}
describe('compatible providers', () => {
  it('validates endpoint authority, known pricing and output limits without persisting keys', () => {
    const { values, providers } = setup();
    providers.save({ ...profile, apiKey: 'secret-extra-field' } as any, 'private-fixture-key');
    expect(JSON.stringify([...values])).not.toContain('private-fixture-key');
    expect(JSON.stringify([...values])).not.toContain('secret-extra-field');
    for (const patch of [{ baseUrl: 'http://remote.example/v1' }, { baseUrl: 'https://user:pass@example.com' }, { inputUsdPerMillion: 0 }, { maxOutputTokens: -1 }, { kind: 'openrouter', baseUrl: 'https://wrong.example' }]) expect(() => validateProvider({ ...profile, ...patch } as any)).toThrow();
    expect(routeModelForTask('compatible/local', 'Create a detailed strategy')).toBe('compatible/local');
    providers.remove('local'); expect(() => providers.resolve('compatible/local')).toThrow('not configured');
  });

  it('executes request → delivery → immediate revision → approval on the selected endpoint, with OAuth also connected', async () => {
    const requests: any[] = [];
    const server = createServer(async (req, res) => {
      if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return; }
      let body = ''; for await (const part of req) body += part;
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: `Delivery ${requests.length}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
    });
    servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    const { providers, settings } = setup();
    providers.save({ ...profile, baseUrl: `http://127.0.0.1:${port}/v1` });
    expect((await providers.test('local')).models).toEqual(['fixture-model']);
    const manager = new AgentManager(); manager.setCompatibleProviders(providers); manager.setOAuthToken('openai', 'synthetic-oauth');
    const costs: number[] = []; manager.setUsageRecorder(record => costs.push(record.costUsd!));
    const config = { model: 'compatible/local', temperature: 0, maxTokens: 200, systemPrompt: 'Help a business.', tools: [] };
    const work = new WorkManager(settings);
    const task = work.create({ goal: 'Prepare a customer proposal', agentId: 'a', reviewRequired: true }, 'owner');
    const execute = (agentId: string, input: Record<string, unknown>) => manager.executeAgent(agentId, config, input);
    await work.run(task.id, execute);
    expect(work.get(task.id).status).toBe('review');
    await work.reviseAndRun(task.id, 'Make it shorter', execute);
    expect(work.get(task.id).deliveries?.map(d => d.content)).toEqual(['Delivery 1', 'Delivery 2']);
    expect(JSON.stringify(requests[1].messages)).toContain('Make it shorter');
    expect(requests.every(r => r.model === 'fixture-model' && r.max_tokens === 100)).toBe(true);
    expect(costs).toEqual([0.0003, 0.0003]);
    work.change(task.id, 'accept'); expect(work.get(task.id).status).toBe('done');
    providers.save({ ...profile, baseUrl: `http://127.0.0.1:${port}/v1`, maxRunUsd: 0.000001 });
    await expect(execute('a', { task: 'Another request' })).rejects.toThrow('per-run budget');
    expect(requests).toHaveLength(2);
    await manager.shutdown();
  });
});

it('charges missing usage against the run cap and restores persistent spend for resume', async () => {
  const manager = new AgentManager();
  let calls = 0;
  const ledger: Array<{ executionId?: string; costUsd?: number }> = [];
  manager.setUsageRecorder(record => ledger.push(record));
  manager.setExecutionSpendProvider(id => ledger.filter(r => r.executionId === id).reduce((sum, record) => sum + (record.costUsd || 0), 0));
  manager.setCompatibleProviders({ resolve: () => ({ profile: { ...profile, maxRunUsd: 0.001 }, client: { chat: { completions: { create: async () => {
    calls++;
    return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: `call-${calls}`, type: 'function', function: { name: 'get_current_time', arguments: '{}' } }] } }] };
  } } } } }) } as any);
  const config = { model: 'compatible/local', temperature: 0, maxTokens: 100, systemPrompt: 'Help.', tools: [{ name: 'get_current_time', type: 'custom' as const, config: {} }] };
  await expect(manager.executeAgent('a', config, { task: 'Check time' }, undefined, 'persisted-run')).rejects.toThrow('per-run budget');
  expect(calls).toBe(1);
  expect(ledger[0].costUsd).toBeGreaterThan(0);
  await expect(manager.executeAgent('a', config, { task: 'Check time' }, undefined, 'persisted-run')).rejects.toThrow('per-run budget');
  expect(calls).toBe(1);
  await manager.shutdown();
});

it('keeps conversation replies tool-free and isolated from skills/memory while recording spend', async () => {
  const manager = new AgentManager();
  const requests: any[] = []; const costs: number[] = [];
  manager.setSkillLoader(() => { throw new Error('Conversation loaded skills'); });
  manager.setAutoSkillSelector(() => { throw new Error('Conversation auto-selected skills'); });
  manager.setContextProvider(async () => { throw new Error('Conversation read external memory'); });
  manager.setModelRouter(() => { throw new Error('Conversation routed to another model'); });
  manager.setUsageRecorder(record => costs.push(record.costUsd || 0));
  manager.setCompatibleProviders({resolve: () => ({profile, client: {chat: {completions: {create: async (request: any) => {
    requests.push(request);
    return (async function* () { yield {choices:[{delta:{content:'{"intent":"answer","reply":"Explanation only"}'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10}}; })();
  }}}}})} as any);
  try {
    const result = await manager.executeAgent('a', {model:'compatible/local',temperature:1,maxTokens:100,systemPrompt:'Publish everything',tools:[{name:'get_current_time',type:'custom',config:{}}],skillIds:['dangerous']}, {task:'Why?'}, undefined, undefined, undefined, {conversationOnly:true});
    expect(result.status).toBe('completed');
    expect(result.activatedSkillIds).toEqual([]);
    expect(requests[0].tools).toBeUndefined();
    expect(requests[0].messages[0].content).toContain('You have no tools');
    expect(requests[0].messages[0].content).not.toContain('Publish everything');
    expect(costs.length).toBe(1); expect(costs[0]).toBeGreaterThan(0);
  } finally { await manager.shutdown(); }
});
