import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@keepmind/db";
import { createAgents, ForbiddenError, NEW_AGENT_DEFAULTS, ValidationError } from "../src";
import { addMember, type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  await f?.close();
});

const agentsOf = (fx: Fixture) => fx.db.select().from(schema.agents).where(eq(schema.agents.orgId, fx.org.id));

describe("createAgents", () => {
  test("creates the agents in order, each with its own fields and the shared ones on every row", async () => {
    f = await setup();
    const made = await createAgents(
      f.db,
      f.owner.id,
      f.org.id,
      [
        {
          name: "Ana",
          handle: "ana-bot",
          role: "Designer",
          instructions: "Desenha.",
          appearance: { color: "rose", eyes: "happy", accessory: "none" },
          setup: { role: "designer", hello: "Oi!" },
        },
        { name: "Beto", role: "Developer", instructions: "Codifica." },
        { name: "Cida" },
      ],
      {
        credentialId: f.credential.id,
        monthlyBudgetNanoUsd: 2_000_000_000,
        autonomy: "never",
        audienceMode: "everyone",
      },
      NEW_AGENT_DEFAULTS,
      { pubsub: f.pubsub },
    );
    expect(made.map((a) => a.name)).toEqual(["Ana", "Beto", "Cida"]);
    expect(made.map((a) => a.handle)).toEqual(["ana-bot", "beto", "cida"]);
    const rows = await agentsOf(f);
    expect(rows).toHaveLength(4); // @dev plus the three
    for (const agent of made) {
      const row = rows.find((r) => r.id === agent.id);
      expect(row?.credentialId).toBe(f.credential.id);
      expect(row?.monthlyBudgetNanoUsd).toBe(2_000_000_000);
      expect(row?.missionCommandApproval).toBe("never");
      expect(row?.ownerUserId).toBe(f.owner.id);
      expect(row?.audienceMode).toBe("everyone");
    }
    const ana = rows.find((r) => r.handle === "ana-bot");
    expect(ana?.role).toBe("Designer");
    expect(ana?.instructions).toBe("Desenha.");
    expect(ana?.appearance).toEqual({ color: "rose", eyes: "happy", accessory: "none" });
    expect(ana?.setup?.role).toBe("designer");
    expect(ana?.setup?.hello).toBe("Oi!");
    const cida = rows.find((r) => r.handle === "cida");
    expect(cida?.setup?.role).toBeNull();
  });

  test("dedupes handles inside the batch and against agents already there", async () => {
    f = await setup();
    await createAgents(
      f.db,
      f.owner.id,
      f.org.id,
      [
        { name: "First", handle: "scout" },
        { name: "Second", handle: "Scout" },
        { name: "Third", handle: "scout" },
        { name: "Fourth" },
      ],
      {},
      NEW_AGENT_DEFAULTS,
    );
    // @dev exists already: an explicit "dev" gets the next free suffix.
    const made = await createAgents(
      f.db,
      f.owner.id,
      f.org.id,
      [{ name: "Dev Jr" }, { name: "Dev Again", handle: "dev" }],
      {},
      NEW_AGENT_DEFAULTS,
    );
    const rows = await agentsOf(f);
    const handles = rows.map((r) => r.handle).sort();
    expect(handles).toEqual(["dev", "dev-2", "dev-jr", "fourth", "scout", "scout-2", "scout-3"]);
    expect(made.map((a) => a.handle)).toEqual(["dev-jr", "dev-2"]);
  });

  test("derives a handle from the name when the item has none", async () => {
    f = await setup();
    const made = await createAgents(
      f.db,
      f.owner.id,
      f.org.id,
      [{ name: "Suporte Tecnico!" }, { name: "!!!" }, { name: "A" }],
      {},
      NEW_AGENT_DEFAULTS,
    );
    expect(made.map((a) => a.handle)).toEqual(["suporte-tecnico", "agent", "agent-2"]);
  });

  test("applies the shared audience to every agent", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    const made = await createAgents(
      f.db,
      f.owner.id,
      f.org.id,
      [{ name: "One" }, { name: "Two" }],
      { audience: { mode: "people", userIds: [bia.id], roleIds: [] } },
      NEW_AGENT_DEFAULTS,
    );
    for (const agent of made) {
      const row = (await agentsOf(f)).find((r) => r.id === agent.id);
      expect(row?.audienceMode).toBe("people");
      expect(row?.audienceUserIds).toEqual([bia.id]);
    }
  });

  test("a mid-batch failure persists nothing", async () => {
    f = await setup();
    await expect(
      createAgents(
        f.db,
        f.owner.id,
        f.org.id,
        [{ name: "Good" }, { name: "Bad", handle: "not valid!" }],
        {},
        NEW_AGENT_DEFAULTS,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await agentsOf(f)).toHaveLength(1); // only @dev
  });

  test("an empty batch is a validation error", async () => {
    f = await setup();
    await expect(createAgents(f.db, f.owner.id, f.org.id, [], {}, NEW_AGENT_DEFAULTS)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("a member can't create agents for someone else", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    await expect(
      createAgents(f.db, bia.id, f.org.id, [{ name: "Theirs" }], { ownerUserId: f.owner.id }, NEW_AGENT_DEFAULTS),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await agentsOf(f)).toHaveLength(1);
  });
});
