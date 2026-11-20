import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

// Fixed geometry keeps server/client rendering identical and avoids a canvas render loop.
const synapses = [
  "M282 142C310 138 306 95 342 92S382 30 410 32",
  "M342 92C372 88 386 119 420 116S468 75 485 72",
  "M410 32C440 34 455 66 485 72S532 47 550 30",
  "M485 72C509 89 515 123 548 132S593 110 615 94",
  "M550 30C581 34 582 72 615 94S655 104 680 126",
  "M420 116C449 127 463 152 475 180",
  "M410 32C387 16 378 3 368-20",
  "M550 30C578 11 606 10 630-12",
  "M342 92C322 79 308 58 286 54",
  "M548 132C549 152 571 166 586 182",
];
const neurons = [
  [342, 92],
  [410, 32],
  [420, 116],
  [485, 72],
  [550, 30],
  [548, 132],
  [615, 94],
];

/** KeepMind's neural stage; decorative activity never substitutes for real status. */
export function KeepMindBackdrop({
  busy = false,
  tone = "surface",
  accent,
  strength = 1,
  still = false,
}: {
  busy?: boolean;
  tone?: "surface" | "graphite";
  accent?: string;
  strength?: number;
  still?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(() => typeof document !== "undefined" && !document.hidden);
  useEffect(() => {
    const update = () => setForeground(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => setVisible(entries.at(-1)?.isIntersecting ?? false))
        : null;
    if (host.current) observer?.observe(host.current);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <span
      className="km-agent-backdrop"
      data-tone={tone}
      style={{ "--km-backdrop-accent": accent, opacity: Math.max(0, Math.min(1, strength)) } as CSSProperties}
      ref={host}
      aria-hidden="true"
      data-moving={(!still && visible && foreground) || undefined}
      data-busy={busy || undefined}
    >
      <svg aria-hidden="true" viewBox="0 0 640 160" preserveAspectRatio="xMidYMid slice" focusable="false">
        <path className="km-agent-backdrop__fold" d="M300-40C340 90 480 24 700 140V220H260Z" />
        <g className="km-agent-backdrop__flow">
          {synapses.map((d, index) => (
            <g key={d} style={{ "--km-synapse-delay": `${index * -1.3}s` } as CSSProperties}>
              <path className="km-agent-backdrop__connection" d={d} />
              <path className="km-agent-backdrop__accent" d={d} pathLength="100" />
            </g>
          ))}
          {neurons.map(([cx, cy], index) => (
            <g key={`${cx}-${cy}`} style={{ "--km-synapse-delay": `${index * -1.7}s` } as CSSProperties}>
              <circle className="km-agent-backdrop__neuron-ring" cx={cx} cy={cy} r="7" />
              <circle className="km-agent-backdrop__neuron" cx={cx} cy={cy} r="2.4" />
            </g>
          ))}
        </g>
      </svg>
    </span>
  );
}
