import { describe, expect, test } from "bun:test";
import { resources } from "@keepmind/i18n";
import i18next from "i18next";
import {
  BATCH_SKIPPED_STEPS,
  batchDrafts,
  NEW_AGENT_STEPS,
  presetChannels,
  ROLE_DEFAULTS,
  type RoleId,
  stepAfter,
} from "../src/lib/new-agent";

const t = (() => {
  const instance = i18next.createInstance();
  void instance.init({
    lng: "en",
    fallbackLng: "en",
    resources,
    initAsync: false,
    interpolation: { escapeValue: false },
  });
  return instance.t;
})();

const myChannels = [
  { id: "c-eng", name: "Engenharia" },
  { id: "c-dev", name: "Dev" },
  { id: "c-sup", name: "Suporte" },
  { id: "c-geral", name: "Geral" },
];
const connected = ["github", "linear", "intercom"];

describe("batchDrafts", () => {
  test("one draft per role, in order, filled like picking the role once", () => {
    const drafts = batchDrafts(["dev", "support"], t, myChannels, connected);
    expect(drafts.map((d) => d.roleId)).toEqual(["dev", "support"]);
    const [dev, support] = drafts;
    expect(dev?.name).toBe(t("newAgent.roles.dev.name"));
    expect(dev?.agentName).toBe(t("newAgent.roles.dev.agent"));
    expect(dev?.instructions).toBe(t("newAgent.roles.dev.instructions"));
    expect(dev?.look).toEqual(ROLE_DEFAULTS.dev.look);
    expect(dev?.handleBase).toBe("ada");
    expect(support?.agentName).toBe(t("newAgent.roles.support.agent"));
    expect(support?.handleBase).toBe("nina");
  });

  test("preset channels: every existing match, the first the submit picks", () => {
    const [dev] = batchDrafts(["dev"], t, myChannels, connected);
    // "Engenharia" and "Dev" both match dev's hints; order follows the channels given.
    expect(dev?.channels).toEqual(presetChannels("dev", myChannels));
    expect(dev?.channels).toEqual(["c-eng", "c-dev"]);
    const [, support] = batchDrafts(["dev", "support"], t, myChannels, connected);
    expect(support?.channels).toEqual(["c-sup"]);
    // A role with no matching channel gets none.
    const [pm] = batchDrafts(["pm"], t, myChannels, connected);
    expect(pm?.channels).toEqual([]);
  });

  test("levels only for the connected apps, at the role's presets", () => {
    const [dev, support] = batchDrafts(["dev", "support"], t, myChannels, connected);
    // dev presets github write, linear read; intercom isn't in them, so it starts at write.
    expect(dev?.levels).toEqual({ github: "write", linear: "read", intercom: "write" });
    // support presets intercom write, linear read; github isn't in them, so it starts at write.
    expect(support?.levels).toEqual({ intercom: "write", github: "write", linear: "read" });
    // Nothing connected, nothing to grant.
    const [none] = batchDrafts(["dev"], t, myChannels, []);
    expect(none?.levels).toEqual({});
  });

  test("a restricted role's connected apps all stay at none", () => {
    const [cyber] = batchDrafts(["cybersec"], t, myChannels, connected);
    expect(cyber?.levels).toEqual({ github: "none", linear: "none", intercom: "none" });
    expect(cyber?.channels).toEqual([]);
  });

  test("custom and unknown roles leave; an empty pick gives no drafts", () => {
    expect(batchDrafts(["custom", "dev"], t, myChannels, connected).map((d) => d.roleId)).toEqual(["dev"]);
    expect(batchDrafts(["dev", "custom", "pm"], t, myChannels, connected).map((d) => d.roleId)).toEqual(["dev", "pm"]);
    expect(batchDrafts(["custom"], t, myChannels, connected)).toEqual([]);
    expect(batchDrafts([], t, myChannels, connected)).toEqual([]);
    // A value that isn't a role at all is dropped too, not crashed on.
    expect(batchDrafts(["nope" as RoleId], t, myChannels, connected)).toEqual([]);
  });
});

describe("BATCH_SKIPPED_STEPS", () => {
  const at = (s: (typeof NEW_AGENT_STEPS)[number]) => NEW_AGENT_STEPS.indexOf(s);

  test("a batch passes over identity, instructions and tools, both ways", () => {
    expect(BATCH_SKIPPED_STEPS).toEqual(["identity", "instructions", "tools"]);
    expect(stepAfter(at("role"), 1, BATCH_SKIPPED_STEPS)).toBe(at("where"));
    expect(stepAfter(at("review"), -1, BATCH_SKIPPED_STEPS)).toBe(at("model"));
    expect(stepAfter(at("where"), -1, BATCH_SKIPPED_STEPS)).toBe(at("role"));
  });
});

describe("batchDrafts personal", () => {
  test("a personal workspace's broad rule still applies through presetLevels", () => {
    // Catalog ids only: broad changes nothing here (it widens custom servers, which have no catalog id).
    const [dev] = batchDrafts(["dev"], t, myChannels, connected, true);
    expect(dev?.levels).toEqual(batchDrafts(["dev"], t, myChannels, connected)[0]?.levels);
  });
});
