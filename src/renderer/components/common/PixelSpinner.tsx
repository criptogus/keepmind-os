import React, { useEffect, useRef } from 'react';

/**
 * Pixel orbit loader — ported from agentes.chat's PixelSpinner, simplified to
 * monochrome ink (fits the KeepMind B&W system). A 3×3 grid where one lit
 * cell walks the ring leaving a fading trail. One shared clock drives every
 * spinner on the page; still under prefers-reduced-motion.
 */

export type PixelSpinnerSize = 14 | 16 | 24 | 32;

/** The ring, clockwise from top-left (center stays dark). */
const RING = [
  [0, 0], [1, 0], [2, 0],
  [2, 1], [2, 2], [1, 2],
  [0, 2], [0, 1],
] as const;

const STEP_MS = 110;
/** Lit cell, two fading trail cells, then the dim ring. */
const ALPHA = [1, 0.62, 0.38, 0.16] as const;

const draws = new Set<(head: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let head = 0;

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

function shades(at: number): number[] {
  const n = RING.length;
  return RING.map((_, i) => Math.min(3, (((at - i) % n) + n) % n));
}

function join(draw: (head: number) => void) {
  draws.add(draw);
  draw(head);
  if (!timer && !prefersReduced()) {
    timer = setInterval(() => {
      head = (head + 1) % RING.length;
      for (const d of draws) d(head);
    }, STEP_MS);
  }
  return () => {
    draws.delete(draw);
    if (draws.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function paint(canvas: HTMLCanvasElement, size: number, at: number) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const w = canvas.width;
  const cell = w / 3;
  const gap = Math.max(1, Math.round(cell * 0.14));
  const ink = getComputedStyle(canvas).color || '#151514';
  ctx.clearRect(0, 0, w, w);
  shades(at).forEach((shade, i) => {
    const [x, y] = RING[i] ?? [0, 0];
    ctx.fillStyle = ink;
    ctx.globalAlpha = ALPHA[shade] ?? 0.16;
    const x0 = Math.round(x * cell + gap / 2);
    const y0 = Math.round(y * cell + gap / 2);
    ctx.fillRect(x0, y0, Math.round((x + 1) * cell - gap / 2) - x0, Math.round((y + 1) * cell - gap / 2) - y0);
  });
  ctx.globalAlpha = 1;
}

export interface PixelSpinnerProps {
  size?: PixelSpinnerSize;
  /** Accessible name; without it the spinner is aria-hidden. */
  label?: string;
  className?: string;
}

export default function PixelSpinner({ size = 16, label, className }: PixelSpinnerProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    return join((at) => paint(canvas, size, at));
  }, [size]);

  return (
    <canvas
      ref={ref}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: 'inline-block', flexShrink: 0 }}
    />
  );
}
