import React from 'react';
import type { AvatarDefinition, AvatarMotion } from 'open-bot-avatar';
interface BotAvatarProps {
  definition: AvatarDefinition;
  name?: string;
  mood?: AvatarMotion;
  size?: number;
  color?: string;
  showBadge?: boolean;
}
/** Consistent monochrome identity; real execution state drives the small badge. */
export default function BotAvatar({ definition, name, mood = 'idle', size = 40, showBadge = true }: BotAvatarProps) {
  const words = name?.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials = (words.length > 1 ? [words[0]!, words.at(-1)!] : words).map(word => word[0]).join('').toLocaleUpperCase();
  const variant = [...definition.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 3;
  return <span className="km-bot-avatar" data-mood={mood} style={{ width: size, height: size, fontSize: Math.round(size * 0.33) }} aria-hidden="true">
    {initials || <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {variant === 0 ? <><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><path d="M14 17h6m-3-3v6" /></> : variant === 1 ? <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></> : <><path d="M5 5h6v6H5zM13 13h6v6h-6zM16 4v6M13 7h6M4 16h6" /></>}
    </svg>}
    {showBadge && mood !== 'idle' && <span className="km-avatar-state">{mood === 'happy' ? <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m2 6 3 3 5-6" /></svg> : <span className="km-thinking-dot" />}</span>}
  </span>;
}
