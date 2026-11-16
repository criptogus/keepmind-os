import { expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { LAUNCHD_LABEL, launchdPlist, runnerLaunchdLabel } from "../../runner/service";

test("paired homes have independent persistent macOS services, while the default keeps its legacy label", () => {
  expect(runnerLaunchdLabel(path.join(os.homedir(), ".agentes-runner"))).toBe(LAUNCHD_LABEL);
  const first = runnerLaunchdLabel("/tmp/keepmind-a");
  expect(first).not.toBe(runnerLaunchdLabel("/tmp/keepmind-b"));
  expect(first).toBe(runnerLaunchdLabel("/tmp/keepmind-a/"));
  expect(launchdPlist({ runtime: "/usr/bin/bun", home: "/tmp/keepmind-a" })).toContain(`<string>${first}</string>`);
});
