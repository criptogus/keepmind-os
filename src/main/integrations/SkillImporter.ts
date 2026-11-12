import JSZip from 'jszip';

export interface ImportedSkill {
  name: string;
  description: string;
  prompt: string;
  toolNames: string[];
  source: string;
  /** Git ref the skill was read from (branch/tag/commit). */
  sourceRef?: string;
  /** Paths of supporting text files found in the skill folder. */
  files?: string[];
  /** Entries deliberately not imported (scripts, binaries) — listed, never run. */
  ignored?: string[];
}

export interface SkillImportResult {
  skills: ImportedSkill[];
  /** Folders that looked like skills but failed validation, with reasons. */
  skipped: Array<{ name: string; reason: string }>;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_SKILL_MD_BYTES = 512 * 1024;
const ALLOWED_TEXT_EXT = /\.(md|txt|csv|json|ya?ml|html?|svg)$/i;
const GITHUB_HOSTS = /^(github\.com|raw\.githubusercontent\.com|codeload\.github\.com)$/;

/**
 * Imports skills from GitHub. Accepts repo URLs, /tree/<ref>/<path> folder
 * links, /blob links to a SKILL.md, and raw.githubusercontent.com URLs.
 *
 * Repo links are read from the repository zip archive (one download, no
 * per-folder API calls — the contents API shares a 60 req/h budget).
 * Safety rules mirror the upstream convention: text files only, size and
 * file-count caps, path-traversal rejection, and scripts/binaries are
 * listed as ignored — never stored as runnable content.
 */
export async function importSkillsFromGitHub(url: string): Promise<SkillImportResult> {
  const trimmed = url.trim();
  if (trimmed.startsWith('http')) {
    const repo = parseGitHubRepo(trimmed);
    if (repo) return importFromArchive(repo);
  }
  // raw file URL → single SKILL.md fallback (no archive needed)
  const rawUrl = await resolveRawUrl(trimmed);
  const res = await fetch(rawUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'keepmind-os', 'Accept': 'text/plain' },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${rawUrl}`);
  const text = (await res.text()).slice(0, MAX_SKILL_MD_BYTES);
  return { skills: [parseSkillMarkdown(text, trimmed)], skipped: [] };
}

/** Back-compat single-skill entry point used by older callers. */
export async function importSkillFromGitHub(url: string): Promise<ImportedSkill> {
  const result = await importSkillsFromGitHub(url);
  if (result.skills.length === 0) {
    const why = result.skipped.map((s) => `${s.name}: ${s.reason}`).join('; ') || 'no SKILL.md found';
    throw new Error(`No importable skill found (${why})`);
  }
  return result.skills[0];
}

interface RepoRef {
  owner: string;
  repo: string;
  ref: string;
  /** Folder path inside the repo ('' = root). */
  path: string;
  /** Display URL for provenance. */
  display: string;
}

function parseGitHubRepo(url: string): RepoRef | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(tree|blob)\/([^/]+)\/(.+?))?\/?(?:\?.*)?$/);
  if (!m) return null;
  const [, owner, repo, kind, ref, ...rest] = m;
  const rawPath = rest.join('/');
  // blob/.../SKILL.md → the folder is the dirname
  const path = kind === 'blob' ? rawPath.replace(/\/[^/]+$/, '') : rawPath;
  return {
    owner, repo,
    ref: ref || 'HEAD',
    path: path.replace(/\/+$/, ''),
    display: url,
  };
}

async function downloadArchive(repo: RepoRef): Promise<Uint8Array> {
  // github.com/.../archive/<ref>.zip redirects to codeload with the bytes.
  const url = `https://github.com/${repo.owner}/${repo.repo}/archive/${encodeURIComponent(repo.ref)}.zip`;
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
      headers: { 'User-Agent': 'keepmind-os', Accept: 'application/zip' },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Archive redirect without location');
      const next = new URL(loc, current);
      if (!GITHUB_HOSTS.test(next.hostname)) throw new Error(`Refusing redirect to ${next.hostname}`);
      current = next.toString();
      continue;
    }
    if (!res.ok) {
      const hint = res.status === 404 ? ' (private repo, bad ref, or repo not found)' : '';
      throw new Error(`Archive download failed (${res.status})${hint}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Repository archive too large (>50MB)');
    return buf;
  }
  throw new Error('Too many archive redirects');
}

async function importFromArchive(repo: RepoRef): Promise<SkillImportResult> {
  const buf = await downloadArchive(repo);
  const zip = await JSZip.loadAsync(buf);

  // Archive root is "<owner>-<repo>-<shortref>/" — normalize entries.
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const root = entries[0] ? entries[0].name.split('/')[0] + '/' : '';
  const strip = (name: string) => (root && name.startsWith(root) ? name.slice(root.length) : name);

  // Reject traversal before touching any content.
  for (const f of entries) {
    const p = strip(f.name);
    if (p.startsWith('/') || p.split('/').includes('..')) {
      throw new Error(`Unsafe path in archive: ${f.name}`);
    }
  }

  const base = repo.path ? `${repo.path}/` : '';
  const underBase = entries.filter((f) => strip(f.name).startsWith(base));

  // Skill folders = dirs containing SKILL.md (case-insensitive), up to 6 deep.
  const skillDirs = new Set<string>();
  for (const f of underBase) {
    const p = strip(f.name);
    const parts = p.split('/');
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^skill\.md$/i.test(parts[i]) && parts.slice(0, i).length <= 6) {
        skillDirs.add(parts.slice(0, i).join('/'));
        break;
      }
    }
  }

  const result: SkillImportResult = { skills: [], skipped: [] };
  for (const dir of [...skillDirs].sort()) {
    const prefix = dir ? `${dir}/` : '';
    const files = underBase
      .map((f) => ({ f, p: strip(f.name) }))
      .filter((x) => x.p.startsWith(prefix))
      .sort((a, b) => a.p.localeCompare(b.p));

    const skillMd = files.find((x) => /(^|\/)skill\.md$/i.test(x.p));
    if (!skillMd) continue;
    const uncompressed = (skillMd.f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (uncompressed > MAX_SKILL_MD_BYTES) {
      result.skipped.push({ name: dir || repo.repo, reason: 'SKILL.md too large (>512KB)' });
      continue;
    }

    const textFiles: Array<{ path: string; text: string }> = [];
    const ignored: string[] = [];
    let textBytes = 0;
    for (const { f, p } of files) {
      const rel = p.slice(prefix.length);
      if (!rel || rel.includes('..')) continue;
      const isText = ALLOWED_TEXT_EXT.test(rel);
      const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
      if (isText && textBytes + size <= MAX_TEXT_BYTES && textFiles.length < MAX_FILES) {
        const content = await f.async('string');
        textFiles.push({ path: rel, text: content });
        textBytes += size;
      } else {
        ignored.push(rel);
      }
    }

    const md = textFiles.find((x) => /(^|\/)skill\.md$/i.test(x.path));
    if (!md) continue;
    try {
      const skill = parseSkillMarkdown(md.text, repo.display);
      skill.sourceRef = repo.ref === 'HEAD' ? undefined : repo.ref;
      skill.files = textFiles.filter((x) => x !== md).map((x) => x.path);
      if (ignored.length) skill.ignored = ignored;
      result.skills.push(skill);
    } catch (e) {
      result.skipped.push({ name: dir || repo.repo, reason: e instanceof Error ? e.message : 'invalid SKILL.md' });
    }
  }

  if (result.skills.length === 0 && result.skipped.length === 0) {
    throw new Error(`No SKILL.md found${repo.path ? ` under ${repo.path}` : ''} (tried archive of ${repo.owner}/${repo.repo}@${repo.ref})`);
  }
  return result;
}

async function resolveRawUrl(url: string): Promise<string> {
  if (url.startsWith('raw.githubusercontent.com/')) {
    return `https://${url}`;
  }
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)\/(.+?))?(?:\/blob\/([^/]+)\/(.+?))?\/?$/);
  if (!m) throw new Error('Not a recognized GitHub URL');
  const [, owner, repo, treeBranch, treePath, blobBranch, blobPath] = m;

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

  if (!name) {
    const h = body.match(/^#\s+(.+)$/m);
    name = h ? h[1].trim() : '';
  }
  if (!description) {
    const p = body.replace(/^#.*$/m, '').trim().split(/\n\s*\n/)[0] || '';
    description = p.replace(/\n/g, ' ').slice(0, 300);
  }
  if (!name) name = source.split('/').slice(-2, -1)[0] || 'Imported Skill';
  if (name.length > 64) name = name.slice(0, 64);
  if (description.length > 1024) description = description.slice(0, 1024);

  const prompt = body.trim() || description;
  return { name, description, prompt, toolNames, source };
}

function scalar(frontmatter: string, key: string): string {
  const m = frontmatter.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'));
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '');
}
