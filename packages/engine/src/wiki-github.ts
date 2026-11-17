import { SECRET_FILE } from "./agent-import";
import { zip } from "./docx";
import { ValidationError } from "./errors";
import { can, requirePermission } from "./organizations";
import { type GithubReadDeps, linkedRepository, parseGithubUrl } from "./skills";
import { importWikiPages, WIKI_IMPORT_MAX_NOTES, type WikiDeps, type WikiImportNote } from "./wiki";
import { inflateZipEntry, listZip } from "./zip";

/**
 * Notes for the wiki from a GitHub link (a repository, a folder or one Markdown file): what the app's own import
 * reads from a folder, as one zip. Notes always; the files they may embed while they fit.
 */
export const WIKI_GITHUB_LIMITS = { bytes: 100 * 1024 * 1024, fileBytes: 50 * 1024 * 1024, notes: 5000 };

const NOTE = /\.(md|markdown)$/i;
/** What a note may embed (the Drive's kinds the import sends). */
const ATTACHMENT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|pdf|mp4|mov|webm|mp3|wav|m4a|ogg|xlsx?|csv|docx?|pptx?|txt)$/i;
/**
 * Hidden folders and files (`.git`, `.github`, `.obsidian`, `.env`) and installed packages: never read. Nor are the
 * files where apps keep keys and sign-ins (`SECRET_FILE`: `credentials.csv`, `secrets.txt`), whatever names them.
 */
const LEFT_OUT = /(^|\/)(\.[^/]*|node_modules)(\/|$)/;

const tooLarge = () =>
  new ValidationError(
    "That repository holds too many notes to read from a link. Upload it as a .zip instead.",
    "wiki.github_too_large",
  );

/**
 * The Markdown notes at or below a GitHub link, and the files a note names (an image, a PDF), as a zip with paths
 * relative to the link: a file no note mentions never leaves the server. Nothing is saved: the app reviews it as it reviews a folder, then imports. A private
 * repository is read through the workspace's GitHub (the GitHub App's token for it, else the connection's) for who
 * edits any agent (`manage_agents`, as installing a skill from one asks); tokens never leave the server.
 */
export async function readGithubNotes(deps: GithubReadDeps, actorId: string, orgId: string, url: string) {
  const membership = await requirePermission(deps.db, actorId, orgId, "edit_wiki");
  const through = can(membership, "manage_agents") ? deps : { ...deps, github: undefined };
  const { target, zip: archive, files } = await linkedRepository(through, orgId, url);
  if (target.kind === "file") {
    const entry = files.get(target.path);
    if (!entry || !NOTE.test(target.path)) throw new ValidationError("Link a Markdown file, a folder or a repository");
    if (entry.size > WIKI_GITHUB_LIMITS.fileBytes) throw tooLarge();
    return zip([[target.path.split("/").pop() ?? target.path, inflateZipEntry(archive, entry)]]);
  }
  const base = target.path.replace(/^\/+|\/+$/g, "");
  const prefix = base ? `${base}/` : "";
  const nameOf = (path: string) => path.split("/").pop() ?? path;
  const inside = [...files]
    .filter(([path]) => path.startsWith(prefix) && !LEFT_OUT.test(path.slice(prefix.length)))
    .filter(([path]) => !SECRET_FILE.test(nameOf(path)))
    .map(([path, entry]) => ({ path: path.slice(prefix.length), entry }));
  const notes = inside.filter((f) => NOTE.test(f.path));
  if (notes.length === 0) {
    throw new ValidationError("No Markdown notes in that link", "wiki.github_no_notes");
  }
  let total = notes.reduce((n, f) => n + f.entry.size, 0);
  if (notes.length > WIKI_GITHUB_LIMITS.notes || total > WIKI_GITHUB_LIMITS.bytes) throw tooLarge();
  const read = notes.map((f) => ({ path: f.path, data: inflateZipEntry(archive, f.entry) }));
  const text = read.map((f) => new TextDecoder().decode(f.data)).join("\n");
  /** A note names the file, as written or as a link encodes it. */
  const named = (path: string) => text.includes(nameOf(path)) || text.includes(encodeURIComponent(nameOf(path)));
  // Only what a note names, while it fits, the smallest first: a note keeps its text without them.
  const attachments = inside
    .filter((f) => ATTACHMENT.test(f.path) && f.entry.size <= WIKI_GITHUB_LIMITS.fileBytes && named(f.path))
    .sort((a, b) => a.entry.size - b.entry.size)
    .filter((f) => {
      if (total + f.entry.size > WIKI_GITHUB_LIMITS.bytes) return false;
      total += f.entry.size;
      return true;
    });
  return zip([
    ...read.map((f): [string, Uint8Array] => [f.path, f.data]),
    ...attachments.map((f): [string, Uint8Array] => [f.path, inflateZipEntry(archive, f.entry)]),
  ]);
}

/** What bringing a GitHub link's notes into the wiki needs: reading the repository and the wiki's own deps. */
export type GithubWikiDeps = GithubReadDeps & Omit<WikiDeps, "db">;

/** `---` frontmatter of a note: its `tags`/`tag` and `aliases`/`alias`, and the body without it. */
function noteFrontmatter(text: string): { tags: string[]; aliases: string[]; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { tags: [], aliases: [], body: text };
  const meta: Record<string, string[]> = {};
  let key: string | null = null;
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = (kv[1] ?? "").toLowerCase();
      const v = (kv[2] ?? "").trim();
      meta[key] = v.startsWith("[")
        ? v
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : v
          ? [v]
          : [];
      continue;
    }
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (li && key) meta[key]?.push((li[1] ?? "").trim());
  }
  const clean = (a: string[] | undefined) =>
    (a ?? []).map((s) => s.replace(/^["']|["']$/g, "").replace(/^#/, "")).filter(Boolean);
  return {
    tags: clean([...(meta.tags ?? []), ...(meta.tag ?? [])]),
    aliases: clean([...(meta.aliases ?? []), ...(meta.alias ?? [])]),
    body: text.slice(m[0].length),
  };
}

const INLINE_TAGS = /(?:^|\s)#([\p{L}\d_/-]*[\p{L}_/-][\p{L}\d_/-]*)/gu;

/**
 * The Markdown notes a `readGithubNotes` zip holds, as import notes: frontmatter and `#tags` kept, each file's
 * folder kept. Attachments aren't copied — uploading them to the Drive is the app review's step — so a note's
 * image links stay as the author wrote them.
 */
export function githubNotesFromZip(bytes: Uint8Array): WikiImportNote[] {
  const notes: WikiImportNote[] = [];
  for (const entry of listZip(bytes)) {
    if (entry.symlink || !NOTE.test(entry.path)) continue;
    // The same exclusions `readGithubNotes` applies: hidden folders and files, installed packages, secret names.
    if (LEFT_OUT.test(entry.path) || SECRET_FILE.test(entry.path.split("/").pop() ?? entry.path)) continue;
    const fm = noteFrontmatter(new TextDecoder().decode(inflateZipEntry(bytes, entry)));
    const noCode = fm.body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    const parts = entry.path.split("/");
    const file = parts.pop() ?? entry.path;
    const inline = [...noCode.matchAll(INLINE_TAGS)].map((m) => m[1] ?? "");
    notes.push({
      title: file.replace(/\.(md|markdown)$/i, ""),
      ...(parts.length ? { folder: parts.join("/") } : {}),
      body: fm.body,
      tags: [...new Set([...fm.tags, ...inline].map((t) => t.toLowerCase()))],
      ...(fm.aliases.length ? { aliases: fm.aliases } : {}),
    });
  }
  return notes;
}

/**
 * A GitHub link's Markdown notes as wiki pages, without the app's review step: for an agent asked to bring a
 * repository into the wiki. Reads as `readGithubNotes` does (the person's `edit_wiki`; private repositories through
 * the workspace's GitHub for whoever may manage agents), then imports in batches under one `importId` per
 * repository: asking again adds only the notes that are new and never duplicates the ones already in.
 */
export async function importGithubWiki(
  deps: GithubWikiDeps,
  userId: string,
  orgId: string,
  url: string,
  options: { folder?: string } = {},
): Promise<{
  source: string;
  created: number;
  alreadyIn: number;
  titles: string[];
  skipped: string[];
  failed: { title: string; reason: "title" | "too_long" }[];
}> {
  const target = parseGithubUrl(url);
  const source = `${target.owner}/${target.repo}`;
  const bytes = await readGithubNotes(deps, userId, orgId, url);
  const notes = githubNotesFromZip(bytes);
  if (notes.length === 0) throw new ValidationError("No Markdown notes in that link", "wiki.github_no_notes");
  const wiki: WikiDeps = { db: deps.db, pubsub: deps.pubsub, search: deps.search };
  const titles: string[] = [];
  const skipped: string[] = [];
  const failed: { title: string; reason: "title" | "too_long" }[] = [];
  let created = 0;
  let alreadyIn = 0;
  for (let i = 0; i < notes.length; i += WIKI_IMPORT_MAX_NOTES) {
    const r = await importWikiPages(wiki, userId, orgId, {
      source: { type: "github", name: source },
      notes: notes.slice(i, i + WIKI_IMPORT_MAX_NOTES),
      folder: options.folder,
      onConflict: "keep_both",
      importId: `github:${source.toLowerCase()}`,
    });
    const again = new Set(r.alreadyIn.map((p) => p.id));
    created += r.created.length - r.alreadyIn.length;
    alreadyIn += r.alreadyIn.length;
    titles.push(...r.created.filter((p) => !again.has(p.id)).map((p) => p.title));
    skipped.push(...r.skipped);
    failed.push(...r.failed);
  }
  return { source, created, alreadyIn, titles, skipped, failed };
}
