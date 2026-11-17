import { useEffect, useRef } from "react";
import { cx } from "../cx";
import { redrawSkies, type SkyOptions, startSky } from "../sky/engine";
import type { AgentColor } from "./AgentLook";
import { AgentSticker } from "./AgentSticker";

/**
 * The pixel sky on a canvas that fills its parent (give the parent
 * `position: relative` and `overflow: hidden`). The options are read on every
 * frame, so changing them (a color, how many agents work) needs no restart.
 * Decorative: a presentation canvas with nothing to read.
 */
export function PixelSky({ options, className }: { options: SkyOptions; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const opts = useRef(options);
  opts.current = options;
  useEffect(() => {
    const canvas = ref.current;
    return canvas ? startSky(canvas, () => opts.current) : undefined;
  }, []);
  // With reduced motion a sky only redraws when asked: new options are a reason.
  useEffect(() => redrawSkies());
  return <canvas ref={ref} className={cx("ac-sky", className)} />;
}

/** KeepMind orbital accent; the companion uses the shared visibility-aware animation loop. */
export function SkyGlow({
  color,
  bare,
  className,
}: {
  color?: AgentColor;
  surface?: string;
  bare?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("ac-sky-glow", "km-presence", className)} aria-hidden="true">
      <svg aria-hidden="true" className="km-presence__orbits" viewBox="0 0 320 160" fill="none">
        <ellipse cx="160" cy="90" rx="112" ry="42" />
        <ellipse cx="160" cy="90" rx="82" ry="28" />
        <circle cx="55" cy="76" r="3" />
        <circle cx="238" cy="99" r="2" />
      </svg>
      {!bare && <AgentSticker mood="thinking" appearance={{ color: color ?? "graphite" }} size={100} />}
    </span>
  );
}
