/** KeepMind's original companion family. The atlas is bundled locally, never fetched from a third party. */
import { bodyFrame, contrastOf, type DrawAgentOptions, drawEyes, eyeShapes } from "./engine.js";

export const COMPANIONS = ["Kivo", "Luma", "Nexo", "Faro"] as const;
export const companionAtlasUrl = new URL("../brand/assets/companions.png", import.meta.url).href;
let atlas: HTMLImageElement | undefined;
const waiting = new Set<() => void>();
export function loadCompanions(onReady: () => void): () => void {
  if (typeof Image === "undefined") return () => {};
  if (!atlas) {
    atlas = new Image();
    atlas.onload = () => {
      for (const fn of waiting) fn();
      waiting.clear();
    };
    atlas.src = companionAtlasUrl;
  }
  if (atlas.complete && atlas.naturalWidth) onReady();
  else waiting.add(onReady);
  return () => {
    waiting.delete(onReady);
  };
}

/** Names belong to the user; the body is derived from an existing saved appearance, without a data migration. */
export function companionIndex(color?: string): number {
  if (!color || color === "graphite" || color === "teal") return 0;
  if (["sky", "indigo", "violet"].includes(color)) return 1;
  if (["rose", "amber"].includes(color)) return 2;
  return 3;
}

/** Custom accents must keep the live face readable on its charcoal inset. */
export function companionEyeColor(color?: string): string {
  return color?.startsWith("#") && contrastOf(color, "#181b16") >= 3 ? color : "#c4ff3d";
}

export function drawCompanion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  opts: DrawAgentOptions = {},
) {
  const index = companionIndex(opts.color);
  const pose = opts.pose ?? {};
  const frame = bodyFrame(pose);
  ctx.save();
  ctx.translate(x + s / 2, y + s);
  ctx.scale(frame.sx, frame.sy);
  ctx.translate(-s / 2, -s);
  if (atlas?.complete && atlas.naturalWidth) {
    const half = atlas.naturalWidth / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(atlas, (index % 2) * half, Math.floor(index / 2) * half, half, half, 0, 0, s, s);
  } else {
    // Stable local silhouette while the asset loads, including an offline/error fallback.
    ctx.fillStyle = "#333630";
    ctx.beginPath();
    ctx.roundRect(s * 0.14, s * 0.1, s * 0.72, s * 0.8, s * 0.3);
    ctx.fill();
  }
  // A live face preserves all saved eye styles, feedback reactions and working/sleeping expressions.
  const faceY = [0.515, 0.3, 0.37, 0.45][index] ?? 0.5;
  const faceX = index === 2 ? 0.4 : 0.5;
  ctx.fillStyle = "#181b16";
  ctx.beginPath();
  ctx.ellipse(s * faceX, s * faceY, s * 0.175, s * 0.085, 0, 0, Math.PI * 2);
  ctx.fill();
  const eyes = eyeShapes(opts.eyes, pose).map((e) => ({
    ...e,
    x: faceX + (e.x - 0.5) * 0.6,
    y: faceY + (e.y - 0.5) * 0.6,
    w: e.w * 0.6,
    h: e.h * 0.6,
  }));
  drawEyes(ctx, 0, 0, s, eyes, companionEyeColor(opts.color));
  opts.after?.(ctx, s, frame);
  ctx.restore();
}
