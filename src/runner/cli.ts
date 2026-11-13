#!/usr/bin/env node
import { CheckpointStore } from '../main/execution/CheckpointStore.js';
import { readFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageManager } from '../main/storage/StorageManager.js';
import { AgentManager } from '../main/agent/AgentManager.js';
import { MemoryManager } from '../main/integrations/MemoryManager.js';
import { WorkManager } from '../main/work/WorkManager.js';
import { TriggerManager } from '../main/agent/TriggerManager.js';
import { costFromUsage } from '../shared/models.js';
import { z } from 'zod';

const args = process.argv.slice(2);
const value = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
if (args.includes('--help') || !value('--config')) {
  console.log('KeepMind OS — free MIT runner\nUsage: npm run runner -- --config examples/workspace.json --task "Review README"\nOptions: --watch (scheduled routines), --data-dir DIR, --agent ID, --accept TASK_ID, --resume TASK_ID, --inspect TASK_ID, --reconcile TASK_ID --step KEY --result-file FILE\nAPI keys: OPENAI_API_KEY / ANTHROPIC_API_KEY. No KeepMind account required.');
  process.exit(args.includes('--help') ? 0 : 1);
}
const configSchema = z.object({
  version: z.literal(1), workspace: z.string(),
  agents: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), model: z.string().min(1),
    prompt: z.string().min(1), maxTokens: z.number().int().min(1).max(32768).default(4096),
    monthlyBudgetUsd: z.number().positive(), tools: z.array(z.enum(['file_read','file_list','pdf_read','sheet_read','personalbrain_search','get_current_time'])).default(['file_read','file_list','get_current_time']) })).min(1),
  routines: z.array(z.object({ agentId: z.string(), name: z.string(), prompt: z.string(), intervalMinutes: z.number().int().min(1) })).default([]),
});
const configFile = path.resolve(value('--config')!);
const config = configSchema.parse(JSON.parse(readFileSync(configFile, 'utf8')));
if (new Set(config.agents.map(a => a.id)).size !== config.agents.length) throw new Error('Agent IDs must be unique');
if (config.routines.some(r => !config.agents.some(a => a.id === r.agentId))) throw new Error('Routine references an unknown agent');
const dataDir = path.resolve(value('--data-dir') || path.join(homedir(), '.keepmind', 'runner'));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
// Separate from desktop data. Refuse concurrent writers rather than duplicate scheduled effects.
const lock = path.join(dataDir, 'runner.lock');
let lockFd: number;
try { lockFd = openSync(lock, 'wx', 0o600); }
catch { throw new Error(`Runner data is locked. Stop the other runner; after a crash, remove ${lock} only after verifying no runner is active.`); }
process.on('exit', () => { closeSync(lockFd); unlinkSync(lock); });
const storage = new StorageManager(dataDir);
storage.recoverInterruptedExecutions();
const work = new WorkManager(storage); const manager = new AgentManager(); const memory = new MemoryManager(storage);
const checkpoints = new CheckpointStore(storage); manager.setCheckpointStore(checkpoints);
manager.getToolRegistry().setContext({ workspaceDir: path.resolve(path.dirname(configFile), config.workspace),
  personalBrainSearch: async (query, limit) => memory.search(query, limit) });
manager.setConstraintsProvider(() => ({ policy: { fileAccess: 'workspace', shellAccess: 'disabled' } }));
manager.setUsageRecorder(r => storage.saveLlmUsage({ ...r, promptTokens: r.usage.promptTokens, completionTokens: r.usage.completionTokens,
  costUsd: r.costUsd ?? costFromUsage(r.model, r.usage.promptTokens, r.usage.completionTokens), partial: r.partial ?? false }));
manager.setBudgetChecker((id, _model, estimate) => {
  const agent = config.agents.find(a => a.id === id)!;
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0,0,0,0);
  if (storage.getAgentSpendSince(id, start.toISOString()) + estimate > agent.monthlyBudgetUsd) throw new Error('Monthly budget exceeded');
});
async function run(agentId: string, goal: string, resumeTaskId?: string) {
  const agent = config.agents.find(a => a.id === agentId); if (!agent) throw new Error('Unknown agent');
  const task = resumeTaskId ? work.get(resumeTaskId) : work.create({ goal, agentId, project: path.basename(config.workspace) }, 'runner');
  const previous = resumeTaskId && task.executionId ? storage.getAgentExecution(task.executionId) : undefined;
  if (resumeTaskId && (task.status !== 'blocked' || !previous || (previous.status !== 'failed' && !(previous.status === 'completed' && checkpoints.read(previous.id)?.output)) || !checkpoints.read(previous.id))) throw new Error('No resumable checkpoint');
  const result = await work.run(task.id, async (_id, input) => {
    const id = previous?.id ?? randomUUID(); const startedAt = previous?.startedAt ?? new Date().toISOString();
    if (previous) input = previous.input;
    work.attachExecution(task.id, id);
    storage.saveAgentExecution({ id, agentId, input, status: 'running', progress: 0, startedAt, userId: 'runner' });
    try {
      const execution = await manager.executeAgent(agentId, { model: agent.model, temperature: 0.2, maxTokens: agent.maxTokens,
        systemPrompt: agent.prompt, monthlyBudgetUsd: agent.monthlyBudgetUsd,
        tools: agent.tools.map(name => ({ name, type: 'custom', config: {} })) }, input, undefined, id);
      storage.saveAgentExecution(execution); return execution;
    } catch (error) {
      storage.saveAgentExecution({ id, agentId, input, startedAt, completedAt: new Date().toISOString(), status: 'failed', progress: 0, error: String(error), userId: 'runner' }); throw error;
    }
  });
  console.log(JSON.stringify(result));
  return result;
}
const inspect = value('--inspect');
if (inspect) { const task = work.get(inspect); console.log(JSON.stringify({ task, steps: task.executionId ? checkpoints.steps(task.executionId) : [] }, null, 2)); storage.close(); process.exit(0); }
const reconcile = value('--reconcile');
if (reconcile) {
  const task = work.get(reconcile);
  if (task.status !== 'blocked' || !task.executionId || !value('--step') || !value('--result-file')) throw new Error('Use a blocked task with --step and --result-file');
  checkpoints.reconcile(task.executionId, value('--step')!, readFileSync(value('--result-file')!, 'utf8'), 'runner');
  work.change(task.id, 'comment', `External result verified for ${value('--step')}`);
  storage.close(); process.exit(0);
}
const resume = value('--resume');
if (resume) { const task = work.get(resume); const result = await run(task.agentId, task.goal, resume); storage.close(); process.exit(result.status === 'review' ? 0 : 1); }
const accept = value('--accept');
if (accept) { console.log(JSON.stringify(work.change(accept, 'accept'))); storage.close(); process.exit(0); }
if (value('--task')) {
  const result = await run(value('--agent') || config.agents[0].id, value('--task')!);
  if (!args.includes('--watch')) { storage.close(); process.exit(result.status === 'review' ? 0 : 1); }
}
if (args.includes('--watch')) {
  const triggers = new TriggerManager(k => storage.getSetting(k), (k,v) => storage.setSetting(k,v));
  triggers.attach({ getAgentName: id => config.agents.find(a => a.id === id)?.name, runAgent: (id, input) => run(id, String(input.task)) });
  for (const routine of config.routines) {
    if (!triggers.list().some(t => t.name === routine.name && t.agentId === routine.agentId)) triggers.create({ ...routine, kind: 'interval', enabled: true });
  }
  const keepAlive = setInterval(() => {}, 60_000);
  for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, () => { triggers.stop(); clearInterval(keepAlive); void manager.shutdown().then(() => { storage.close(); process.exit(0); }); });
  console.log(`Runner active; ${config.routines.length} routines. Results require human acceptance. Data: ${dataDir}`);
} else { storage.close(); }
