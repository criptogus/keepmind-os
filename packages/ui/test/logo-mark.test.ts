import { expect, test } from "bun:test";
// The command line's logo lives in the MIT setup package, which can't import the engine: it keeps a copy.
import { LOGO_MARK } from "../../setup/src/term";

test("the command line's logo is the KeepMind K mark: the ink square and the lime K on its 12×12 grid", () => {
  expect(LOGO_MARK).toHaveLength(12);
  for (const row of LOGO_MARK) {
    expect(row).toHaveLength(12);
    expect(row).toMatch(/^[0w.]+$/);
  }
  const pixels = LOGO_MARK.join("");
  // The rounded ink square (0) frames the lime K (w), which has pixels of its own.
  expect(pixels.match(/w/g)?.length).toBeGreaterThan(0);
  expect(LOGO_MARK[0]).toBe("..00000000..");
  expect(LOGO_MARK[11]).toBe("..00000000..");
});
