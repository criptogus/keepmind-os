import { cx } from "../cx";
import { AgentSticker } from "./AgentSticker";

/** The searching companion shares the same motion and appearance as the chat. */
export function AgentSearching({ className }: { className?: string }) {
  return (
    <span className={cx("km-searching", className)} aria-hidden="true">
      <AgentSticker mood="thinking" size={72} />
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </svg>
    </span>
  );
}
