import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("companion migration preserves custom names, ordinary agents and permissions", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE agents (id text, builtin text, name text, permissions text);
      INSERT INTO agents VALUES ('1','right_hand','Lodi','restricted'), ('2','right_hand','Meu assistente','custom'),
      ('3',NULL,'Lodi','none'), ('4','right_hand','KeepMind','owner');`);
    const migration = await readFile(new URL("../migrations/0277_keepmind_companion.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const { rows } = await db.query("SELECT id, name, permissions FROM agents ORDER BY id");
    expect(rows).toEqual([
      { id: "1", name: "Kivo", permissions: "restricted" },
      { id: "2", name: "Meu assistente", permissions: "custom" },
      { id: "3", name: "Lodi", permissions: "none" },
      { id: "4", name: "Kivo", permissions: "owner" },
    ]);
  } finally {
    await db.close();
  }
});
