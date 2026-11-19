import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ForbiddenError, importLocalSkills, listSkills } from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
let home: string;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
  if (home) await rm(home, { recursive: true, force: true });
});

const skillDeps = () => ({ db: f.db, blobs: f.artifactDeps.blobs });

/** The person's skills, without the builtins every workspace has. */
const ownSkills = async () =>
  (await listSkills(f.db, f.owner.id, f.org.id)).filter((s) => !(s.metadata as { builtin?: boolean } | null)?.builtin);

const skillMd = (name: string) => `---\nname: ${name}\ndescription: Faz algo útil\n---\n# Como fazer\n`;

async function skillFolder(root: string, name: string, files: Record<string, string> = {}) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), files.skill ?? skillMd(name));
  for (const [path, content] of Object.entries(files)) {
    if (path === "skill") continue;
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

async function newHome() {
  home = await mkdtemp(join(tmpdir(), "km-local-skills-"));
  return home;
}

describe("importLocalSkills", () => {
  test("installs each folder with a SKILL.md from the server's own folders", async () => {
    f = await setup();
    const h = await newHome();
    await skillFolder(join(h, ".claude/skills"), "relatorio", { "notas.md": "detalhes" });
    await skillFolder(join(h, ".codex/skills"), "resumir");
    await mkdir(join(h, ".agents/skills", "vazia"), { recursive: true }); // no SKILL.md
    await mkdir(join(h, ".claude/skills", ".oculta"), { recursive: true });

    const result = await importLocalSkills(skillDeps(), f.owner.id, f.org.id, { home: h });
    expect(result.skills.map((s) => s.name).sort()).toEqual(["relatorio", "resumir"]);
    expect(result.skipped).toEqual([]);
    expect(result.sources.map((s) => s.found)).toEqual([1, 1, 0]);
    expect(await ownSkills()).toHaveLength(2);
  });

  test("a folder that can't be installed is skipped with its code, the rest still install", async () => {
    f = await setup();
    const h = await newHome();
    const bad = join(h, ".claude/skills", "quebrada");
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, "SKILL.md"), "sem frontmatter");
    await skillFolder(join(h, ".claude/skills"), "boa");

    const result = await importLocalSkills(skillDeps(), f.owner.id, f.org.id, { home: h });
    expect(result.skills).toHaveLength(1);
    expect(result.skipped).toEqual([{ name: "quebrada", code: "skill.no_frontmatter", message: expect.any(String) }]);
  });

  test("the same name in two folders installs once; the second is skipped as duplicate", async () => {
    f = await setup();
    const h = await newHome();
    await skillFolder(join(h, ".claude/skills"), "um", { skill: skillMd("igual") });
    await skillFolder(join(h, ".agents/skills"), "dois", { skill: skillMd("igual") });

    const result = await importLocalSkills(skillDeps(), f.owner.id, f.org.id, { home: h });
    expect(result.skills).toHaveLength(1);
    expect(result.skipped[0]?.code).toBe("duplicate");
  });

  test("personal installs the person's own skill; who doesn't manage agents is refused", async () => {
    f = await setup();
    const member = await addMember(f.db, f.org.id, "member");
    const h = await newHome();
    await skillFolder(join(h, ".claude/skills"), "minha");

    await expect(importLocalSkills(skillDeps(), member.id, f.org.id, { home: h })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const result = await importLocalSkills(skillDeps(), f.owner.id, f.org.id, { home: h, personal: true });
    expect(result.skills).toHaveLength(1);
    expect((await ownSkills())[0]?.ownerUserId).toBe(f.owner.id);
  });
});
