import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

/** KeepMind's quiet graphite stage; status and identity remain in the profile itself. */
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
        <path className="km-agent-backdrop__fold" d="M190-40C280 100 400 24 700 140V220H100Z" />
        <g className="km-agent-backdrop__flow">
          <path d="M140-80C240 180 420-85 720 135" />
          <path d="M175-80C275 180 455-85 755 135" />
          <path d="M210-80C310 180 490-85 790 135" />
          <path className="km-agent-backdrop__accent" d="M175-80C275 180 455-85 755 135" />
        </g>
      </svg>
    </span>
  );
}
