import type { Level } from "@keepmind/client/lib/access-levels";
import { ROLE_DEFAULTS, ROLE_IDS, type RoleId } from "@keepmind/client/lib/new-agent";
import type { AgentAppearance, IconName } from "@keepmind/ui";

export * from "@keepmind/client/lib/new-agent";

/**
 * "Criar agente" in steps: each role's icon on the web (what it starts with is shared:
 * `@keepmind/client/lib/new-agent`).
 */

export interface RolePreset {
  icon: IconName;
  look: Required<AgentAppearance>;
  /** Levels by catalog connector id ("github"); connectors not listed start at "Sem acesso". */
  levels: Record<string, Level>;
  /** Channels it joins when the workspace has them (by name; only channels you're in). */
  channels: string[];
}

const ROLE_ICON: Record<RoleId, IconName> = {
  dev: "code",
  ops: "bolt",
  qa: "checks",
  pm: "issues",
  support: "message",
  sales: "coin",
  marketing: "globe",
  content: "edit",
  seo: "search",
  data: "chart",
  finance: "wallet",
  people: "members",
  research: "search",
  assistant: "calendar",
  cybersec: "shield",
  consulting: "layers",
  strategy: "layers",
  trends: "search",
  inspired_musk: "layers",
  inspired_gates: "layers",
  inspired_buffett: "layers",
  inspired_welch: "layers",
  inspired_jobs: "layers",
  inspired_ma: "layers",
  inspired_kawasaki: "layers",
  inspired_bezos: "layers",
  inspired_nadella: "layers",
  inspired_drucker: "layers",
  inspired_altman: "layers",
  inspired_hassabis: "layers",
  inspired_amodei: "layers",
  inspired_huang: "layers",
  inspired_christensen: "layers",
  inspired_thiel: "layers",
  inspired_blank: "layers",
  inspired_blakely: "layers",
  inspired_munger: "layers",
  inspired_dunford: "layers",
  inspired_godin: "layers",
  inspired_taleb: "layers",
  inspired_blount: "layers",
  exec_cfo: "chart",
  exec_cmo: "globe",
  exec_cto: "code",
  exec_coo: "bolt",
  exec_people: "members",
  exec_research: "search",
  custom: "plus",
};

/** Picking a role fills the rest (name and instructions come from i18n: `newAgent.roles.{id}`). */
export const ROLE_PRESETS = Object.fromEntries(
  ROLE_IDS.map((id) => [id, { ...ROLE_DEFAULTS[id], icon: ROLE_ICON[id] }]),
) as Record<RoleId, RolePreset>;
