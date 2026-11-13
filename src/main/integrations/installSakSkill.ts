import { createHash } from 'node:crypto';
import type { SakPreview } from '../../shared/superAgentSkill.js';
import type { StorageManager } from '../storage/StorageManager.js';
/** Imports the reviewed text only. Remote tool declarations never grant local authority. */
export function installSakSkill(storage: StorageManager, preview: SakPreview, agentId: string) {
  const id = `sak-${createHash('sha256').update(`${preview.slug}:${preview.version}:${preview.digest}`).digest('hex').slice(0,32)}`;
  return storage.transaction(() => {
    const agent = storage.getAgent(agentId); if (!agent) throw new Error('Agente não encontrado.');
    const now = new Date().toISOString(); const old = storage.getSkill(id);
    if (!old) storage.saveSkill({ id, name: preview.name, description: preview.description, prompt: preview.prompt, toolNames: [], source: preview.source, sourceRef: preview.version, version: 1, createdAt: now, updatedAt: now });
    storage.saveAgent({ ...agent, config: { ...agent.config, skillIds: [...new Set([...(agent.config.skillIds || []),id])] }, updatedAt: now });
    return { skillId: id, agentId, name: preview.name };
  });
}
