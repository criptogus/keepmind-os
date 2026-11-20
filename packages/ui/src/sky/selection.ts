import type { AgentColorName } from "../agent/engine.js";

/** Smooth KeepMind current at the right edge; transparent beneath the selected row's label. */
export function selectionSkyUrl(_color: AgentColorName = "sky", dark = false): string {
  const line = dark ? "#454545" : "#d6d6d2";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 40" width="144" height="40" fill="none"><path d="M65-15C75 44 107-5 150 50M85-15C95 44 127-5 170 50" stroke="${line}"/><path d="M75-15C85 44 117-5 160 50" stroke="#c4ff3d" stroke-width="1.5" stroke-dasharray="18 140" stroke-dashoffset="-30"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
