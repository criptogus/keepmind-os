import { spriteGrid } from "./engine.js";

/** Compact KeepMind pod for timelines: the saved eye expression on our rounded, symmetric silhouette. */
export function companionMark(eyes = "round"): string[] {
  const expression = spriteGrid(9, eyes);
  const body = [
    "...XXX...",
    "..XXXXX..",
    ".XXXXXXX.",
    ".XXXXXXX.",
    ".XXXXXXX.",
    ".XXXXXXX.",
    "XXXXXXXXX",
    "XXX...XXX",
    ".XX...XX.",
  ];
  return body.map((row, y) =>
    [...row].map((cell, x) => (cell === "X" && expression[y]?.[x] === "o" ? "o" : cell)).join(""),
  );
}
