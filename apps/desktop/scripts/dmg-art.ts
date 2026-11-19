/**
 * Draws the background of the macOS .dmg's window (tauri.macos.conf.json `bundle.macOS.dmg`): daybreak in the
 * landing's sky, clouds, a few agents far away, the wordmark, and a pixel hop from the app to Applications. Run by
 * CI before `tauri build` on macOS (`bun apps/desktop/scripts/dmg-art.ts`).
 *
 * The window is 660×400 points, the app at (180, 170) and Applications at (480, 170). Finder draws the icons and
 * their names over the picture, black on a light Mac and white on a dark one: the sky under them is a mid blue,
 * where both read. No text but the wordmark, so it suits any language the Mac is in.
 *
 * Outputs (ignored by git): src-tauri/dmg/background.png (660×400) and background@2x.png (1320×800), joined on
 * macOS into src-tauri/dmg/background.tiff (both sizes in one file, for Retina and non-Retina screens).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dottedWordmark, Picture, type RGB } from "./pixel-art";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The window and the icons' centers, in points (tauri.macos.conf.json). */
const W = 660;
const H = 400;
const APP = [180, 170] as const;
const APPS = [480, 170] as const;

/** The hop from the app to Applications: a dotted pixel arc, growing and brighter, then a ">" head. */
function hop(p: Picture, color: RGB, alpha: number, cell = 4) {
  const x0 = APP[0] + 78;
  const x1 = APPS[0] - 84;
  const y0 = APP[1] - 6;
  const peak = APP[1] - 52;
  const at = (t: number): [number, number] => [
    x0 + (x1 - x0) * t,
    (1 - t) ** 2 * y0 + 2 * (1 - t) * t * peak + t * t * y0,
  ];
  for (let i = 0; i <= 9; i++) {
    const t = i / 10;
    const [x, y] = at(t);
    const s = cell * (i < 3 ? 1 : i < 7 ? 1.5 : 2);
    p.box(Math.round((x - s / 2) / 2) * 2, Math.round((y - s / 2) / 2) * 2, s, s, color, alpha * (0.35 + 0.65 * t));
  }
  const [hx, hy] = at(1);
  const head = [
    [-1, 0],
    [0, 1],
    [1, 2],
    [0, 3],
    [-1, 4],
    [-2, 0],
    [-1, 1],
    [0, 2],
    [-1, 3],
    [-2, 4],
  ];
  for (const [dx, dy] of head)
    p.box(hx + (dx as number) * cell, hy - 2 * cell + (dy as number) * cell, cell, cell, color, alpha);
}

function background(k: number): Picture {
  const p = new Picture(W * k, H * k, k);
  p.box(0, 0, W, H, [25, 27, 23]);
  // Neutral icon wells preserve Finder labels in either system appearance.
  p.box(118, 110, 124, 148, [142, 145, 138]);
  p.box(418, 110, 124, 148, [142, 145, 138]);
  dottedWordmark(p, W / 2, 92, 96);
  hop(p, [196, 255, 61], 0.95);
  return p;
}

const dir = join(root, "src-tauri", "dmg");
mkdirSync(dir, { recursive: true });
const one = join(dir, "background.png");
const two = join(dir, "background@2x.png");
writeFileSync(one, background(1).png());
writeFileSync(two, background(2).png());
if (process.platform === "darwin") {
  // One TIFF with both sizes: Finder picks the one the screen needs.
  const tiff = spawnSync("tiffutil", ["-cathidpicheck", one, two, "-out", join(dir, "background.tiff")], {
    stdio: "inherit",
  });
  if (tiff.status !== 0) throw new Error("tiffutil could not join the .dmg backgrounds");
  console.log("dmg art: background.png, background@2x.png and background.tiff written");
} else {
  console.log("dmg art: background.png and background@2x.png written (the .tiff is joined on macOS)");
}
