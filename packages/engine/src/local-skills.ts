import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { requirePermission } from "./organizations";
import {
  classifyFile,
  parseSkillMarkdown,
  type SkillDeps,
  type SkillDetail,
  type SkillFileInput,
  saveSkill,
  splitSkillFolder,
} from "./skills";

/**
 * Skills found on the server's own machine (self-hosted installs: the person's Claude Code, Codex or agents
 * skill folders under their home). The folders are a fixed list — the client never names a path.
 */
export const LOCAL_SKILL_FOLDERS = [".claude/skills", ".codex/skills", ".agents/skills"] as const;

const MAX_LOCAL_SKILLS = 50;
const MAX_LOCAL_DEPTH = 6;
const MAX_LOCAL_FILES = 500;
/** One file bigger than this is not read; binaries past it are listed as ignored, text ones skipped. */
const MAX_LOCAL_FILE_BYTES = 25_000_000;

export interface LocalSkillSource {
  /** `~/.claude/skills`, as shown to the person. */
  label: string;
  /** What the folder holds that can be installed. */
  found: number;
}

export interface LocalSkillSkip {
  /** The folder's name (or SKILL.md's `name` once parsed). */
  name: string;
  /** Why it can't be installed: stable, the app translates it (`duplicate` for a name already installed). */
  code: string;
  /** English fallback. */
  message: string;
  params?: Record<string, unknown>;
}

export interface LocalSkillImport {
  skills: SkillDetail[];
  skipped: LocalSkillSkip[];
  sources: LocalSkillSource[];
}

export interface LocalSkillOptions {
  /** The person's own skills instead of the team's. */
  personal?: boolean;
  /** Tests: another home folder. Default the server's. */
  home?: string;
}

async function collectFiles(dir: string, prefix: string, depth: number, out: SkillFileInput[]) {
  if (depth > MAX_LOCAL_DEPTH || out.length >= MAX_LOCAL_FILES) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_LOCAL_FILES) return;
    const name = entry.name;
    if (name.startsWith(".") || name === "__MACOSX" || entry.isSymbolicLink()) continue;
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (entry.isDirectory()) {
      await collectFiles(full, rel, depth + 1, out);
    } else if (entry.isFile()) {
      const { size } = await stat(full);
      if (size > MAX_LOCAL_FILE_BYTES) {
        if (classifyFile(rel).kind === "binary") out.push({ path: rel, data: new Uint8Array(), skippedSize: size });
        continue;
      }
      out.push({ path: rel, data: new Uint8Array(await readFile(full)) });
    }
  }
}

const hasSkillMd = async (dir: string) => {
  try {
    return (await readdir(dir)).some((name) => name.toLowerCase() === "skill.md");
  } catch {
    return false;
  }
};

/**
 * Installs the skills found in the server's own skill folders (`~/.claude/skills`, `~/.codex/skills`,
 * `~/.agents/skills`), one folder per skill with a `SKILL.md`. Each goes through the same validation and storage
 * as a zip upload; a folder that fails is listed in `skipped` and the rest still install. Who manages agents only.
 */
export async function importLocalSkills(
  deps: SkillDeps,
  actorId: string,
  orgId: string,
  options: LocalSkillOptions = {},
): Promise<LocalSkillImport> {
  await requirePermission(deps.db, actorId, orgId, "manage_agents");
  const home = options.home ?? homedir();
  const result: LocalSkillImport = { skills: [], skipped: [], sources: [] };
  const seen = new Set<string>();
  let installed = 0;
  for (const rel of LOCAL_SKILL_FOLDERS) {
    const root = join(home, rel);
    const source: LocalSkillSource = { label: `~/${rel}`, found: 0 };
    result.sources.push(source);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (installed + result.skipped.length >= MAX_LOCAL_SKILLS) break;
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const dir = join(root, entry.name);
      if (!(await hasSkillMd(dir))) continue;
      source.found++;
      const files: SkillFileInput[] = [];
      await collectFiles(dir, "", 0, files);
      try {
        const { skillMd, files: rest } = splitSkillFolder(files);
        const parsed = parseSkillMarkdown(skillMd);
        if (seen.has(parsed.name)) {
          result.skipped.push({
            name: parsed.name,
            code: "duplicate",
            message: "A skill with this name was already installed",
          });
          continue;
        }
        seen.add(parsed.name);
        const skill = await saveSkill(deps, actorId, orgId, {
          ...parsed,
          files: rest,
          source: "upload",
          sourceUrl: `local:${dir}`,
          ...(options.personal ? { owner: actorId } : {}),
        });
        result.skills.push(skill);
        installed++;
      } catch (error) {
        const e = error as { code?: string; message?: string; params?: Record<string, unknown> };
        result.skipped.push({
          name: entry.name,
          code: typeof e?.code === "string" ? e.code : "import_failed",
          message: e?.message ?? String(error),
          ...(e?.params ? { params: e.params } : {}),
        });
      }
    }
  }
  return result;
}
