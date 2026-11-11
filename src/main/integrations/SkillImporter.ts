export interface ImportedSkill {
  name: string;
  description: string;
  prompt: string;
  toolNames: string[];
  source: string;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 512 * 1024;

/**
 * Imports a skill from a GitHub repository. Accepts:
 *  - https://github.com/owner/repo
 *  - https://github.com/owner/repo/tree/<branch>/<path>
 *  - https://github.com/owner/repo/blob/<branch>/<path>/SKILL.md
 *  - raw.githubusercontent.com URLs
 *
 * Looks for SKILL.md (or skill.md) and parses simple YAML-ish frontmatter:
 *   ---
 *   name: ...
 *   description: ...
 *   tools: [a, b]  (or tools: a, b)
 *   ---
 *   <prompt body>
 */
export async function importSkillFromGitHub(url: string): Promise<ImportedSkill> {
  const rawUrl = await resolveRawUrl(url.trim());
  const res = await fetch(rawUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'keepmind-os', 'Accept': 'text/plain' },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${rawUrl}`);
  const text = (await res.text()).slice(0, MAX_BYTES);
  return parseSkillMarkdown(text, url);
}

async function resolveRawUrl(url: string): Promise<string> {
  if (url.startsWith('raw.githubusercontent.com/')) {
    return `https://${url}`;
  }
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)\/(.+?))?(?:\/blob\/([^/]+)\/(.+?))?\/?$/);
  if (!m) throw new Error('Not a recognized GitHub URL');
  const [, owner, repo, treeBranch, treePath, blobBranch, blobPath] = m;

  // blob URL → direct raw file
  if (blobBranch && blobPath) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${blobBranch}/${blobPath}`;
  }

  const branch = treeBranch || 'main';
  const basePath = treePath ? `/${treePath.replace(/\/+$/, '')}` : '';
  const candidates = [
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${basePath}/SKILL.md`,
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${basePath}/skill.md`,
    `https://raw.githubusercontent.com/${owner}/${repo}/master${basePath}/SKILL.md`,
  ];

  // Probe candidates; return first that exists.
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        method: 'HEAD',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'keepmind-os' },
      });
      if (res.ok) return candidate;
    } catch { /* try next */ }
  }
  throw new Error(`No SKILL.md found in ${owner}/${repo} (tried main/master${basePath || ''})`);
}

export function parseSkillMarkdown(text: string, source: string): ImportedSkill {
  let body = text;
  let name = '';
  let description = '';
  let toolNames: string[] = [];

  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fm) {
    const header = fm[1];
    body = text.slice(fm[0].length);
    name = scalar(header, 'name');
    description = scalar(header, 'description');
    const tools = scalar(header, 'tools');
    if (tools) {
      toolNames = tools.replace(/[\[\]]/g, '').split(',').map((t) => t.trim()).filter(Boolean);
    }
  }

  // Fallbacks: first # heading as name, first paragraph as description.
  if (!name) {
    const h = body.match(/^#\s+(.+)$/m);
    name = h ? h[1].trim() : '';
  }
  if (!description) {
    const p = body.replace(/^#.*$/m, '').trim().split(/\n\s*\n/)[0] || '';
    description = p.replace(/\n/g, ' ').slice(0, 300);
  }
  if (!name) name = source.split('/').slice(-2, -1)[0] || 'Imported Skill';

  const prompt = body.trim() || description;
  return { name, description, prompt, toolNames, source };
}

function scalar(frontmatter: string, key: string): string {
  const m = frontmatter.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'));
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '');
}
