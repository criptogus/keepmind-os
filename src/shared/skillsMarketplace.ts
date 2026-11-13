/**
 * Community skill marketplace catalog.
 *
 * This file IS the marketplace index — community PRs add entries here.
 * Each entry points at a GitHub repo/folder containing one or more
 * SKILL.md files (same format as `importSkillsFromGitHub`).
 *
 * Entry shape:
 *   id          stable slug (used for install/dedupe)
 *   name        display name
 *   description one-line summary shown in the Explore list
 *   source      GitHub URL (repo, /tree/<ref>/<path>, or SKILL.md link)
 *   tags        free-form labels for filtering (e.g. "pdf", "br", "legal")
 *   audience    'personal' | 'corporate' | 'any'
 *   version     catalog semver — bump when the source content changes
 *   featured    pinned to the top of the Explore list
 */
export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  tags: string[];
  audience: 'personal' | 'corporate' | 'any';
  version: string;
  featured?: boolean;
}

export const MARKETPLACE_SKILLS: MarketplaceSkill[] = [
  {
    id: 'anthropic-skills',
    name: 'Anthropic Skills',
    description: 'Official Anthropic skill collection — document handling, code help and workflow templates.',
    source: 'https://github.com/anthropics/skills',
    tags: ['official', 'documents', 'code'],
    audience: 'any',
    version: '1.0.0',
    featured: true,
  },
];
