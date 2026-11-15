import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import "./agent-backdrop.css";

/** KeepMind's quiet graphite stage; status and identity remain in the profile itself. */
export function AgentBackdrop({ busy = false }: { busy?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", update);
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false))
        : null;
    if (host.current) observer?.observe(host.current);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <div
      className="km-agent-backdrop"
      ref={host}
      aria-hidden="true"
      data-moving={(!reduced && visible && foreground) || undefined}
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
    </div>
  );
}
