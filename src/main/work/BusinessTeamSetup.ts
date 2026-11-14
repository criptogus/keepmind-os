import { providerForModel } from '../../shared/models.js';
import { randomUUID, createHash } from 'node:crypto';
import { TEAM_STARTERS, buildBusinessTeam, validateBusinessTeam, type BusinessTeamInput, type BusinessTeamResult } from '../../shared/businessTeams.js';
import type { StorageManager } from '../storage/StorageManager.js';
import type { WorkManager } from './WorkManager.js';

export function createBusinessTeam(storage: StorageManager, work: WorkManager, input: BusinessTeamInput, ownerId: string, model?: string): BusinessTeamResult {
  validateBusinessTeam(input);
  const key = `guidedTeam.${ownerId}.${input.requestId}`;
  const hash = createHash('sha256').update(JSON.stringify(model ? { input, model } : input)).digest('hex');
  return work.atomic(() => storage.transaction(() => {
    const previous = storage.getSetting(key);
    if (previous) {
      const saved = JSON.parse(previous);
      if (saved.hash !== hash) throw new Error('Este pedido de criação já foi usado com outras informações.');
      return saved.result;
    }
    const { agents, team } = buildBusinessTeam(input, randomUUID, new Date().toISOString(), model);
    for (const agent of agents) storage.saveAgent(agent);
    storage.saveTeam(team);
    const task = work.create({ goal: input.firstRequest, project: team.name, agentId: agents[0].id, reviewRequired: true,
      criteria: 'Uma entrega clara e útil para o negócio, com informações faltantes identificadas e próximos passos. Nenhuma publicação ou ação externa sem aprovação.' }, ownerId);
    const result = { teamId: team.id, coordinatorId: agents[0].id, taskId: task.id };
    storage.setSetting(key, JSON.stringify({ hash, result }));
    return result;
  }));
}

/** One approved request creates the persisted team and optionally executes its draft once. */
export async function createTeamFromBrief(storage: StorageManager, work: WorkManager,
  spec: Record<string, unknown>, caller: { id: string; model: string }, ownerId: string,
  execute: (agentId: string, input: Record<string, unknown>) => Promise<import('../../shared/types.js').AgentExecution>) {
  const starter = TEAM_STARTERS.find(t => t.id === spec.priority);
  if (!starter || typeof spec.startFirstTask !== 'boolean') throw new Error('Invalid team request');
  const brief = { name: spec.name, problem: spec.problem, firstRequest: spec.firstRequest, priority: starter.id };
  const requestId = createHash('sha256').update(JSON.stringify({ callerId: caller.id, ...brief })).digest('hex');
  const result = createBusinessTeam(storage, work, { ...brief, requestId, roles: starter.roles.map(r => ({ ...r })),
    provider: providerForModel(caller.model) || 'openai' } as BusinessTeamInput, ownerId, caller.model);
  let task = work.get(result.taskId);
  if (spec.startFirstTask && task.status === 'backlog') task = await work.run(task.id, execute);
  return { ...result, name: brief.name, members: storage.getTeam(result.teamId)?.agentIds,
    taskStatus: task.status, delivery: task.output, error: task.error };
}
