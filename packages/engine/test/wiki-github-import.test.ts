import { afterEach, describe, expect, test } from "bun:test";
import { ForbiddenError } from "../src";
import { getWikiPage, listWikiPages } from "../src/wiki";
import { githubNotesFromZip, importGithubWiki } from "../src/wiki-github";
import { addUser, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

/** A minimal zip writer (stored entries) for tests, as skills.test.ts's. */
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = enc.encode(path);
    const data = enc.encode(text);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** acme/docs as its archive holds it: notes under the archive's own folder, one with frontmatter and #tags. */
const REPO = {
  "docs-main/README.md": "# Docs\n\nThe repo's notes. #guide",
  "docs-main/guides/setup.md":
    "---\ntags: [dev, setup]\naliases: [Install]\n---\n# Setup\n\nHow to install. #onboarding",
  "docs-main/guides/api.md": "# API\n\nEndpoints. [[Setup]]",
  "docs-main/src/index.ts": "code, never a note",
  "docs-main/.github/hidden.md": "hidden, never a note",
};

/** Fake GitHub for acme/docs: github.com redirects the archive to codeload, which sends it. */
function fakeGithub() {
  const fetch = async (url: string) => {
    const ref = /^https:\/\/github\.com\/acme\/docs\/archive\/(.+)\.zip$/.exec(url)?.[1];
    if (ref) {
      const at = ref === "HEAD" ? "0123abc" : ref === "main" ? "refs/heads/main" : ref;
      return new Response(null, {
        status: 302,
        headers: { location: `https://codeload.github.com/acme/docs/zip/${at}` },
      });
    }
    if (/^https:\/\/codeload\.github\.com\/acme\/docs\/zip\//.test(url)) return new Response(zip(REPO));
    return new Response("404: Not Found", { status: 404 });
  };
  return { fetch };
}

const deps = () => ({
  db: f.db,
  pubsub: f.pubsub,
  fetch: fakeGithub().fetch,
  resolveHost: async () => ["140.82.112.3"],
});

describe("githubNotesFromZip", () => {
  test("notes keep their folder, title, frontmatter tags and aliases, and #tags in the text", () => {
    // `readGithubNotes`'s zip holds paths relative to the link (the archive's own folder already stripped).
    const relative = Object.fromEntries(Object.entries(REPO).map(([k, v]) => [k.replace(/^docs-main\//, ""), v]));
    const notes = githubNotesFromZip(zip(relative));
    expect(notes.map((n) => n.title).sort()).toEqual(["README", "api", "setup"]);
    const setup = notes.find((n) => n.title === "setup");
    expect(setup).toMatchObject({ folder: "guides", aliases: ["Install"] });
    expect(setup?.tags?.sort()).toEqual(["dev", "onboarding", "setup"]);
    expect(setup?.body).toContain("# Setup");
    expect(setup?.body).not.toContain("---");
    const readme = notes.find((n) => n.title === "README");
    expect(readme?.folder).toBeUndefined();
    expect(readme?.tags).toEqual(["guide"]);
  });
});

describe("importGithubWiki", () => {
  test("a repository's notes become wiki pages; asking again adds nothing twice", async () => {
    f = await setup();
    const first = await importGithubWiki(deps(), f.owner.id, f.org.id, "https://github.com/acme/docs");
    expect(first.source).toBe("acme/docs");
    expect(first.created).toBe(3);
    expect(first.alreadyIn).toBe(0);
    expect(first.titles.sort()).toEqual(["README", "api", "setup"]);

    const pages = await listWikiPages(f.db, { type: "person", userId: f.owner.id }, f.org.id);
    const setupPage = pages.find((p) => p.title === "setup");
    expect(setupPage?.folder).toBe("guides");
    expect(setupPage?.tags.sort()).toEqual(["dev", "onboarding", "setup"]);
    const api = await getWikiPage(f.db, { type: "person", userId: f.owner.id }, f.org.id, "api");
    expect(api.body).toContain("[[Setup]]");

    const again = await importGithubWiki(deps(), f.owner.id, f.org.id, "https://github.com/acme/docs");
    expect(again.created).toBe(0);
    expect(again.alreadyIn).toBe(3);
    expect((await listWikiPages(f.db, { type: "person", userId: f.owner.id }, f.org.id)).length).toBe(3);
  });

  test("a folder link imports only its notes, under the folder given", async () => {
    f = await setup();
    const r = await importGithubWiki(deps(), f.owner.id, f.org.id, "https://github.com/acme/docs/tree/main/guides", {
      folder: "GitHub/docs",
    });
    expect(r.created).toBe(2);
    const pages = await listWikiPages(f.db, { type: "person", userId: f.owner.id }, f.org.id);
    expect(pages.every((p) => p.folder.startsWith("GitHub/docs"))).toBe(true);
  });

  test("a single file link imports that note", async () => {
    f = await setup();
    const r = await importGithubWiki(deps(), f.owner.id, f.org.id, "https://github.com/acme/docs/blob/main/README.md");
    expect(r.created).toBe(1);
    expect(r.titles).toEqual(["README"]);
  });

  test("whoever can't edit the wiki can't import, and a non-GitHub link is refused", async () => {
    f = await setup();
    const outsider = await addUser(f.db, "out");
    await expect(importGithubWiki(deps(), outsider.id, f.org.id, "https://github.com/acme/docs")).rejects.toThrow(
      ForbiddenError,
    );
    await expect(importGithubWiki(deps(), f.owner.id, f.org.id, "https://example.com/x")).rejects.toThrow(/GitHub/);
  });
});
