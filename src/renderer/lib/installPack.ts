import { v4 as uuidv4 } from 'uuid';
import { avatarJson, presetAvatarFor } from '../../shared/avatars';
import { DEFAULT_MODEL } from '../../shared/models';
import type { Agent, AgentConfig, Skill, ToolConfig } from '../../shared/types';
import type { AgentTemplate } from './agentTemplates';
import type { NichePack } from './nichePacks';

const toToolConfig = (name: string): ToolConfig => ({ name, type: 'custom', config: {} });

/** Builds the AgentConfig for a template, resolving skill names to ids. */
export function configForTemplate(tpl: AgentTemplate, skills: Skill[]): AgentConfig {
  return {
    ...tpl.config,
    model: tpl.config.model || DEFAULT_MODEL.openai,
    skillIds: skills.filter((s) => tpl.skillNames.includes(s.name)).map((s) => s.id),
    tools: tpl.toolNames?.length ? tpl.toolNames.map(toToolConfig) : tpl.config.tools || [],
  };
}

/**
 * Installs a whole pack: creates every agent (skills resolved by name),
 * then a sequential team chaining them. Returns created entities so callers
 * can refresh their stores or navigate.
 */
export async function installNichePack(pack: NichePack): Promise<{ agents: Agent[]; team: { id: string } | null }> {
  const skills = await window.electronAPI.getSkills().catch(() => [] as Skill[]);
  const agents: Agent[] = [];
  for (const tpl of pack.agents) {
    const agent = await window.electronAPI.createAgent({
      ...configForTemplate(tpl, skills),
      name: tpl.name,
      description: tpl.description,
      capabilities: tpl.capabilities,
      avatar: avatarJson(presetAvatarFor(`tpl:${tpl.id}`)),
    });
    agents.push(agent);
  }
  if (agents.length === 0) return { agents, team: null };
  const team = await window.electronAPI.createTeam({
    name: pack.teamName,
    description: pack.description,
    agentIds: agents.map((a) => a.id),
    workflow: {
      id: uuidv4(),
      name: `${pack.teamName} flow`,
      executionMode: 'sequential',
      steps: agents.map((a) => ({ id: uuidv4(), agentId: a.id, inputs: {} })),
    },
  });
  return { agents, team };
}
