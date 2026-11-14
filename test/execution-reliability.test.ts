import { describe, it, expect } from 'vitest';
import { AgentManager } from '../src/main/agent/AgentManager';
import { ToolRegistry } from '../src/main/tools/registry';
const config = { model: 'gpt-4o-mini', temperature: 0, maxTokens: 100, systemPrompt: 'Test', tools: [] };

describe('Execution reliability', () => {
  it('fails closed when approval infrastructure throws', async () => {
    const registry = new ToolRegistry(); let ran = false;
    registry.register({ name: 'sensitive', description: '', parameters: {}, handler: async () => { ran = true; return 'done'; } });
    registry.setGate(async () => { throw new Error('storage unavailable'); });
    await expect(registry.execute('sensitive', {})).rejects.toThrow('storage unavailable');
    expect(ran).toBe(false);
  });
  it('checks allowed tools at execution time, not just in the model schema', async () => {
    await expect(new ToolRegistry().execute('get_current_time', {}, { allowedTools: [] })).rejects.toThrow('not authorized');
  });
  it('cancels an in-flight provider call and prevents subsequent completion', async () => {
    const manager = new AgentManager(); let observed: AbortSignal | undefined;
    (manager as any).openaiClients.set('default', { chat: { completions: { create: async (_: unknown, opts: { signal: AbortSignal }) => {
      observed = opts.signal;
      await new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true }));
    } } } });
    const running = manager.executeAgent('a', config, {}, undefined, 'run');
    await new Promise(resolve => setTimeout(resolve, 10));
    manager.cancelExecution('run');
    await expect(running).rejects.toThrow('cancelled');
    expect(observed?.aborted).toBe(true); expect(manager.getActiveExecutions()).toHaveLength(0);
  });
  it('keeps parallel agent identities isolated', async () => {
    const manager = new AgentManager(); const seen: string[] = [];
    (manager as any).executeOpenAI = async () => { await new Promise(resolve => setTimeout(resolve, 5)); seen.push(manager.getActiveAgentId()!); return {}; };
    await Promise.all([manager.executeAgent('alpha', config, {}), manager.executeAgent('beta', config, {})]);
    expect(seen.sort()).toEqual(['alpha','beta']); expect(manager.getActiveAgentId()).toBeUndefined();
  });
});

it('resolves symlinks before allowing workspace reads', async () => {
  const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'km-roots-'));
  try {
    const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
    await fs.writeFile(path.join(root, 'private.txt'), 'private');
    await fs.symlink(path.join(root, 'private.txt'), path.join(workspace, 'link.txt'));
    const registry = new ToolRegistry(); registry.setContext({ workspaceDir: workspace });
    await expect(registry.execute('file_read', { path: 'link.txt' })).rejects.toThrow('escapes');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('previews assigned and routed tools while enforcing current role restrictions without executing', () => {
  const manager = new AgentManager(); let ran = false;
  manager.getToolRegistry().register({ name: 'effect', description: '', parameters: {}, handler: async () => { ran = true; return ''; } });
  manager.setAutoSkillSelector(() => [{ id: 'skill', name: 'Skill', description: '', prompt: '', toolNames: ['effect','file_read'], createdAt: '', updatedAt: '' }]);
  manager.setConstraintsProvider(() => ({ denyTools: ['effect'] }));
  expect(manager.previewTools('a', config, { task: 'read' })).toEqual(['file_read']);
  expect(ran).toBe(false);
});

it('keeps curated teams free of automatically routed tools', () => {
  const manager = new AgentManager();
  manager.setAutoSkillSelector(() => [{ id: 'skill', name: 'Skill', description: '', prompt: '', toolNames: ['sheet_write','secondbrain_remember'], createdAt: '', updatedAt: '' }]);
  expect(manager.previewTools('a', { ...config, autoSkills: false }, { task: 'Marketing plan' })).toEqual([]);
});
it('permits only explicit local overview reads without approving team creation or settings changes', async () => {
  const { actionDecision } = await import('../src/main/governance/ActionPolicy');
  for (const name of ['app_status','app_agents_list','app_teams_list']) expect(actionDecision(name).requiresApproval).toBe(false);
  for (const name of ['app_team_create','app_settings_update','app_unknown','create_agent']) expect(actionDecision(name).requiresApproval).toBe(true);
});
