import { Button, cx } from "@keepmind/ui";
import { type ReactNode, useRef } from "react";
import { WelcomeSky } from "@/components/Sky";
import "./welcome.css";

/** Welcome message, crew and actions on the shared KeepMind stage. */
export function WelcomeCard({
  title,
  titleId,
  lead,
  crew,
  actions,
  onClose,
  closeLabel,
  level = 1,
  className,
}: {
  title: ReactNode;
  titleId: string;
  lead: ReactNode;
  crew?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  /** The title's heading level: 2 under a page's own title (a channel's). */
  level?: 1 | 2;
  className?: string;
}) {
  const text = useRef<HTMLDivElement>(null);
  const faces = useRef<HTMLDivElement>(null);
  const acts = useRef<HTMLDivElement>(null);
  const shut = useRef<HTMLButtonElement>(null);
  const Heading = level === 2 ? "h2" : "h1";
  return (
    <section className={cx("welcome-card", className)} aria-labelledby={titleId}>
      <WelcomeSky calm={() => [text.current]} clear={() => [faces.current, acts.current, shut.current]} />
      <div className="welcome-card__text" ref={text}>
        <Heading id={titleId} className="welcome-card__title">
          {title}
        </Heading>
        <p className="welcome-card__lead">{lead}</p>
      </div>
      {crew && (
        <div className="welcome-card__crew" ref={faces}>
          {crew}
        </div>
      )}
      {actions && (
        <div className="welcome-card__acts" ref={acts}>
          {actions}
        </div>
      )}
      {onClose && (
        <Button
          ref={shut}
          variant="ghost"
          size="sm"
          iconOnly
          icon="close"
          className="welcome-card__close"
          aria-label={closeLabel}
          onClick={onClose}
        />
      )}
    </section>
  );
}
