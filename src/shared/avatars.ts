import { examples, validateAvatar, type AvatarDefinition } from 'open-bot-avatar';

/**
 * Agent avatar helpers — open-bot-avatar definitions are geometry-only JSON
 * (one SVG path + eye placement); color, mood and motion belong to the
 * renderer. Definitions are validated before use so a corrupt stored value
 * can never break the UI.
 */

export const AVATAR_PRESETS: AvatarDefinition[] = examples;

function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic preset for agents that have no stored avatar yet. */
export function presetAvatarFor(seed: string): AvatarDefinition {
  return examples[hashSeed(seed) % examples.length];
}

export function parseAvatarDefinition(json: string | null | undefined): AvatarDefinition | null {
  if (!json) return null;
  try {
    const result = validateAvatar(JSON.parse(json));
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/** Stored definition when valid, otherwise a stable preset for the agent id. */
export function avatarForAgent(agent: { id: string; avatar?: string }): AvatarDefinition {
  return parseAvatarDefinition(agent.avatar) ?? presetAvatarFor(agent.id);
}

export function avatarJson(def: AvatarDefinition): string {
  return JSON.stringify(def);
}
