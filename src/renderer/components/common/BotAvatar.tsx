import React, { useEffect, useMemo, useState } from 'react';
import { renderAvatarSvg, type AvatarDefinition, type AvatarMotion } from 'open-bot-avatar';

interface BotAvatarProps {
  definition: AvatarDefinition;
  /** idle (default) | thinking | happy — mapped from real execution state. */
  mood?: AvatarMotion;
  size?: number;
  color?: string;
}

/**
 * Renders an open-bot-avatar definition as inline SVG. The package owns
 * volume/motion/gaze math; we only feed it the mood and respect the OS
 * reduced-motion setting.
 */
export default function BotAvatar({ definition, mood = 'idle', size = 40, color }: BotAvatarProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const svg = useMemo(
    () => renderAvatarSvg(definition, { motion: mood, size, color, reducedMotion }),
    [definition, mood, size, color, reducedMotion]
  );

  return (
    <span
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0, lineHeight: 0 }}
      // SVG comes from the validated open-bot-avatar renderer (static markup).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
