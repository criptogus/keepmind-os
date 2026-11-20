import { type RefObject, useEffect, useRef } from "react";
import { horizonHeight } from "../sky/horizon";
import type { AgentColor } from "./AgentLook";
import { KeepMindBackdrop } from "./KeepMindBackdrop";

export { horizonCrest, horizonHeight, horizonTones } from "../sky/horizon";

/** Where `holder`'s content ends: its children's lowest edge (the holder itself may be stretched to the card). */
function contentBottom(holder: HTMLElement): number {
  let bottom = holder.getBoundingClientRect().top;
  for (const child of holder.children) {
    if (child instanceof HTMLElement && child.hidden) continue;
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
  }
  return bottom;
}

/** A quiet KeepMind current only in the spare room below a card's content. */
export function CardHorizon({
  content,
}: {
  /** The element holding the card's content; where its children end is where the room starts. */
  content: RefObject<HTMLElement | null>;
  color?: AgentColor;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const stage = ref.current;
    const card = stage?.parentElement;
    if (!stage || !card) return;
    const draw = () => {
      const inner = content.current;
      const box = card.getBoundingClientRect();
      const room = inner ? box.bottom - contentBottom(inner) : 0;
      const height = horizonHeight(room);
      if (!height || !box.width) {
        stage.hidden = true;
        return;
      }
      stage.hidden = false;
      stage.style.height = `${height}px`;
    };
    draw();
    if (typeof ResizeObserver === "undefined") return;
    const size = new ResizeObserver(draw);
    size.observe(card);
    if (content.current) {
      size.observe(content.current);
      for (const child of content.current.children) size.observe(child);
    }
    // Content swapped (an empty line for the rows): watch the new children too.
    const swapped = new MutationObserver(() => {
      for (const child of content.current?.children ?? []) size.observe(child);
      draw();
    });
    if (content.current) swapped.observe(content.current, { childList: true });
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      size.disconnect();
      swapped.disconnect();
      theme.disconnect();
    };
  }, [content]);
  return (
    <span ref={ref} className="ac-card-horizon" aria-hidden="true" hidden>
      <KeepMindBackdrop still />
    </span>
  );
}
