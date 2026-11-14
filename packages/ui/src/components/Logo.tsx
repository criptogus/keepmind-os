import type { CSSProperties } from "react";
import { cx } from "../cx";

/** KeepMind's existing K mark. Attribution to the engine remains in About. */
export function LogoMark({ size, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cx("ac-logo__mark", className)}
      style={size ? { width: size, height: size } : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect width="32" height="32" rx="8" fill="#111111" />
      <path d="M10 9h3v6l5-6h4l-7 8 7 7h-4l-5-5v5h-3Z" fill="#ffffff" />
    </svg>
  );
}
export interface LogoProps {
  variant?: "main" | "expanded";
  mono?: boolean;
  size?: number;
  className?: string;
  style?: CSSProperties;
}
export function Logo({ mono, size = 24, className, style }: LogoProps) {
  return (
    <span
      className={cx("ac-logo", mono && "ac-logo--mono", className)}
      style={{ fontSize: size, ...style }}
      role="img"
      aria-label="KeepMind OS"
    >
      <LogoMark />
      <span aria-hidden="true">
        KeepMind<span className="km-logo-os"> OS</span>
      </span>
    </span>
  );
}
