import React, { useMemo, useRef, useState } from 'react';
import type { Agent, Team } from '../../../shared/types.js';
import { mentionQuery } from '../../../shared/mentions.js';
import { commandSuggestions } from './commands.js';
import BotAvatar from '../common/BotAvatar.js';
import { avatarForAgent, presetAvatarFor } from '../../../shared/avatars.js';
import { useLang } from '../../lib/i18n.js';

interface ComposerProps {
  agents: Agent[];
  teams: Team[];
  onSend: (text: string) => void;
  disabled?: boolean;
}

interface Candidate {
  kind: 'agent' | 'team';
  id: string;
  name: string;
  avatar?: Agent['avatar'];
}

export default function Composer({ agents, teams, onSend, disabled }: ComposerProps) {
  const { t } = useLang();
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const candidates: Candidate[] = useMemo(() => [
    ...agents.map((a) => ({ kind: 'agent' as const, id: a.id, name: a.name, avatar: a.avatar })),
    ...teams.map((tm) => ({ kind: 'team' as const, id: tm.id, name: tm.name })),
  ], [agents, teams]);

  const trimmedStart = text.trimStart();
  const isCommand = trimmedStart.startsWith('/');
  const cmdPrefix = isCommand ? trimmedStart.slice(1).split(/\s/)[0] ?? '' : '';
  const cmdList = useMemo(
    () => (isCommand ? commandSuggestions(cmdPrefix) : []),
    [isCommand, cmdPrefix],
  );

  const query = isCommand ? null : mentionQuery(text, text.length);
  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return candidates
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, candidates]);

  const showPopup = isCommand ? cmdList.length > 0 : suggestions.length > 0;

  const applyCommand = (name: string) => {
    const at = text.indexOf('/');
    const next = `${text.slice(0, at)}/${name} `;
    setText(next);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const applySuggestion = (c: Candidate) => {
    const at = text.lastIndexOf('@');
    const next = `${text.slice(0, at)}@${c.name} ${text.slice(text.length)}`;
    setText(next);
    setSel(0);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        const pos = at + c.name.length + 2;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    setSel(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isCommand && showPopup) {
      const len = cmdList.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % len); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + len) % len); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyCommand(cmdList[sel].name); return; }
      if (e.key === 'Escape') { e.preventDefault(); setText(''); return; }
    }
    if (showPopup) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[sel]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setText(text.slice(0, text.lastIndexOf('@'))); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div data-tour="chat-composer" style={{ position: 'relative', padding: '12px 20px 16px', borderTop: '1px solid var(--mantine-color-gray-3)' }}>
      {showPopup && (
        <div className="km-enter" style={{
          position: 'absolute', bottom: '100%', left: 20, right: 20, marginBottom: 6,
          backgroundColor: '#fff', border: '1px solid var(--mantine-color-gray-3)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.08)', overflow: 'hidden', zIndex: 10,
        }}>
          {isCommand
            ? cmdList.map((c, i) => (
              <button
                key={c.name}
                onMouseDown={(e) => { e.preventDefault(); applyCommand(c.name); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '8px 12px', border: 'none', background: i === sel ? 'var(--mantine-color-gray-1)' : 'transparent',
                  cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                <span style={{ fontFamily: 'monospace', fontWeight: 700, width: 90 }}>/{c.name}</span>
                <span style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>{c.usage ?? ''}</span>
                <span style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)', flex: 1, textAlign: 'right' }}>{t(c.descKey)}</span>
              </button>
            ))
            : suggestions.map((c, i) => (
            <button
              key={`${c.kind}-${c.id}`}
              onMouseDown={(e) => { e.preventDefault(); applySuggestion(c); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 12px', border: 'none', background: i === sel ? 'var(--mantine-color-gray-1)' : 'transparent',
                cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              {c.kind === 'agent' ? (
                <BotAvatar definition={avatarForAgent({ id: c.id, avatar: c.avatar })} size={20} showBadge={false} />
              ) : (
                <BotAvatar definition={presetAvatarFor(c.id)} size={20} showBadge={false} />
              )}
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)' }}>{c.kind === 'agent' ? 'agent' : 'team'}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'flex-end',
        border: '1px solid var(--mantine-color-gray-3)', borderRadius: 12,
        padding: '8px 10px', backgroundColor: '#fff',
      }}>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => { setText(e.currentTarget.value); setSel(0); }}
          onKeyDown={onKeyDown}
          placeholder={t('chat.placeholder')}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: 14,
            fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 160, background: 'transparent',
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
        />
        <button
          onClick={send}
          disabled={disabled || !text.trim()}
          style={{
            padding: '7px 16px', borderRadius: 8, border: 'none',
            backgroundColor: disabled || !text.trim() ? 'var(--mantine-color-gray-3)' : '#111',
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {t('chat.send')}
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)', marginTop: 6, paddingLeft: 4 }}>
        {t('chat.hint')}
      </div>
    </div>
  );
}
