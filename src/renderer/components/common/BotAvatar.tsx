import React, { useEffect, useMemo, useState } from 'react';
import { renderAvatarSvg, type AvatarDefinition, type AvatarMotion } from 'open-bot-avatar';

interface BotAvatarProps {
  definition: AvatarDefinition;
  /** idle (default) | thinking | happy — mapped from real execution state. */
  mood?: AvatarMotion;
  size?: number;
  color?: string;
  /** Small monochrome mood badge ("?" thinking, "✓" happy) at the corner. */
  showBadge?: boolean;
}

/**
 * Renders an open-bot-avatar definition as inline SVG. The package owns
 * volume/motion/gaze math; we only feed it the mood and respect the OS
 * reduced-motion setting. A tiny pixel-style badge marks non-idle moods,
 * inspired by agentes.chat's sticker props.
 */
export default function BotAvatar({ definition, mood = 'idle', size = 40, color, showBadge = true }: BotAvatarProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const svg = useMemo(
    () => renderAvatarSvg(definition, { motion: mood, size, color: '#111111', reducedMotion }),
    [definition, mood, size, reducedMotion]
  );

  const badge = mood === 'thinking' ? '?' : mood === 'happy' ? '✓' : null;
  const badgeSize = Math.max(12, Math.round(size * 0.32));

  return (
    <span className="km-bot-avatar" style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0, lineHeight: 0, position: 'relative' }}>
      {/* SVG comes from the validated open-bot-avatar renderer (static markup). */}
      <span dangerouslySetInnerHTML={{ __html: svg }} />
      {showBadge && badge && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: '50%',
            backgroundColor: '#fff',
            border: '1.5px solid #111',
            color: '#111',
            fontSize: Math.round(badgeSize * 0.62),
            fontWeight: 700,
            lineHeight: `${badgeSize - 3}px`,
            textAlign: 'center',
            fontFamily: 'inherit',
          }}
        >
          {badge}
        </span>
      )}
    </span>
  );
}
