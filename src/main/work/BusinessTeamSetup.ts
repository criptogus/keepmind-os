import { randomUUID, createHash } from 'node:crypto';
import { buildBusinessTeam, validateBusinessTeam, type BusinessTeamInput, type BusinessTeamResult } from '../../shared/businessTeams.js';
import type { StorageManager } from '../storage/StorageManager.js';
import type { WorkManager } from './WorkManager.js';

export function createBusinessTeam(storage: StorageManager, work: WorkManager, input: BusinessTeamInput, ownerId: string): BusinessTeamResult {
  validateBusinessTeam(input);
  const key = `guidedTeam.${ownerId}.${input.requestId}`;
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return work.atomic(() => storage.transaction(() => {
    const previous = storage.getSetting(key);
    if (previous) {
      const saved = JSON.parse(previous);
      if (saved.hash !== hash) throw new Error('Este pedido de criação já foi usado com outras informações.');
      return saved.result;
    }
    const { agents, team } = buildBusinessTeam(input, randomUUID, new Date().toISOString());
    for (const agent of agents) storage.saveAgent(agent);
    storage.saveTeam(team);
    const task = work.create({ goal: input.firstRequest, project: team.name, agentId: agents[0].id, reviewRequired: true,
      criteria: 'Uma entrega clara e útil para o negócio, com informações faltantes identificadas e próximos passos. Nenhuma publicação ou ação externa sem aprovação.' }, ownerId);
    const result = { teamId: team.id, coordinatorId: agents[0].id, taskId: task.id };
    storage.setSetting(key, JSON.stringify({ hash, result }));
    return result;
  }));
}
