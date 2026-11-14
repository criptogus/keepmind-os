import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, ChannelMessage, ChatAttachment, Team } from '../../../shared/types.js';
import BotAvatar from '../common/BotAvatar.js';
import PixelSpinner from '../common/PixelSpinner.js';
import ApprovalCardMessage from './ApprovalCardMessage.js';
import { avatarForAgent, presetAvatarFor } from '../../../shared/avatars.js';
import { useLang } from '../../lib/i18n.js';

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function useElapsed(startIso?: string, active?: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!startIso) return '';
  const secs = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000));
  return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
}

const QUICK_REACTIONS = ['👍', '✅', '🎉', '👀'];

function AttachmentChip({ a }: { a: ChatAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const isImage = a.mime.startsWith('image/') && !a.mime.includes('svg');
  const hasPreview = !!a.preview;

  useEffect(() => {
    if (!isImage) return;
    let obj: string | null = null;
    let dead = false;
    void window.electronAPI.getChatAttachmentData?.(a.id)
      .then(({ data }) => {
        if (dead) return;
        obj = URL.createObjectURL(new Blob([data], { type: a.mime }));
        setUrl(obj);
      })
      .catch(() => {});
    return () => { dead = true; if (obj) URL.revokeObjectURL(obj); };
  }, [a.id, a.mime, isImage]);

  if (isImage) {
    return (
      <div style={{ marginTop: 6 }}>
        {url ? (
          <img
            src={url}
            alt={a.name}
            onClick={() => void window.electronAPI.openChatAttachment?.(a.id, a.name).catch(() => {})}
            style={{ maxWidth: 320, maxHeight: 240, borderRadius: 10, border: '1px solid var(--mantine-color-default-border)', cursor: 'zoom-in', display: 'block' }}
          />
        ) : (
          <button onClick={() => void window.electronAPI.openChatAttachment?.(a.id, a.name).catch(() => {})} style={{ fontSize: 12 }}>🖼 {a.name}</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={() => void window.electronAPI.openChatAttachment?.(a.id, a.name).catch(() => {})}
        title={a.preview ? a.preview.slice(0, 300) : a.mime}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 8, border: '1px solid var(--mantine-color-default-border)',
          background: 'var(--mantine-color-default)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: 13 }}>📎</span>
        <span style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
        <span style={{ color: 'var(--mantine-color-dimmed)' }}>{a.size > 1048576 ? `${(a.size / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(a.size / 1024))}KB`}</span>
      </button>
      {hasPreview && (
        <div style={{ marginTop: 4 }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--mantine-color-dimmed)', padding: 0, fontFamily: 'inherit' }}
          >{expanded ? '▾ ocultar' : '▸ preview'}</button>
          {expanded && (
            <pre style={{
              marginTop: 4, padding: 8, borderRadius: 8, fontSize: 11, lineHeight: 1.4,
              background: 'var(--mantine-color-default)', border: '1px solid var(--mantine-color-default-border)',
              maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{a.preview!.slice(0, 4000)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

interface MessageFeedProps {
  channelId?: string;
  messages: ChannelMessage[];
  agents: Agent[];
  teams: Team[];
  meId?: string;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: ChannelMessage) => void;
  onOpenThread?: (message: ChannelMessage) => void;
  onRefresh: () => void;
  onLoadEarlier?: (beforeId: string) => void;
}

export default function MessageFeed({ messages, agents, teams, meId, onReact, onReply, onOpenThread, onRefresh, onLoadEarlier }: MessageFeedProps) {
  const { t } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const teamById = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams]);

  useEffect(() => {
    if (stickBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && messages.length > 0 && !loadingEarlier && onLoadEarlier) {
      setLoadingEarlier(true);
      onLoadEarlier(messages[0].id);
      setLoadingEarlier(false);
    }
  };

  const hasStreaming = messages.some((m) => m.status === 'streaming');

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      {loadingEarlier && <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>{t('nav.loading')}</div>}
      {messages.length === 0 && (
        <div className="km-enter" style={{ margin: 'auto', textAlign: 'center', maxWidth: 420 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, backgroundColor: 'var(--km-lime, #c4ff3d)', color: '#111',
            fontSize: 20, fontWeight: 700, margin: '0 auto 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>K</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>KeepMind OS</div>
          <div style={{ fontSize: 13, color: 'var(--mantine-color-dimmed)', marginBottom: 18 }}>{t('chat.emptyHint')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[t('chat.suggestion1'), t('chat.suggestion2'), t('chat.suggestion3')].map((s) => (
              <button
                key={s}
                style={{
                  padding: '9px 14px', borderRadius: 10, border: '1px dashed var(--mantine-color-default-border)',
                  background: 'transparent', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          agent={m.authorKind === 'agent' ? agentById.get(m.authorId) : undefined}
          team={m.authorKind === 'team' ? teamById.get(m.authorId) : undefined}
          meId={meId}
          onReact={onReact}
          onReply={onReply}
          onOpenThread={onOpenThread}
          onRefresh={onRefresh}
        />
      ))}
      {hasStreaming && (
        <div className="km-chat-typing" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
          <PixelSpinner size={14} /> {t('chat.working')}
          <span className="km-chat-typing-dots"><i /><i /><i /></span>
        </div>
      )}
      <div data-tour="chat-end" />
    </div>
  );
}

export function MessageBubble({ message: m, agent, team, meId, onReact, onReply, onOpenThread, onRefresh }: {
  message: ChannelMessage;
  agent?: Agent;
  team?: Team;
  meId?: string;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: ChannelMessage) => void;
  onOpenThread?: (message: ChannelMessage) => void;
  onRefresh: () => void;
}) {
  const { t } = useLang();
  const elapsed = useElapsed(m.createdAt, m.status === 'streaming');
  const toolCalls = (m.meta?.toolCalls as Array<{ name: string; status?: string }> | undefined) ?? [];
  const reactions = (m.meta?.reactions as Record<string, string[]> | undefined) ?? {};

  if (m.authorKind === 'system' && m.meta?.kind === 'approval') {
    return <ApprovalCardMessage message={m} onResolved={onRefresh} />;
  }
  if (m.authorKind === 'system') {
    return (
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
        {m.body} · {fmtTime(m.createdAt)}
      </div>
    );
  }

  const isAgent = m.authorKind === 'agent' || m.authorKind === 'team';
  const avatarDef = isAgent
    ? agent ? avatarForAgent(agent) : presetAvatarFor(m.authorId)
    : null;
  const mood = m.status === 'streaming' ? 'thinking' : m.status === 'error' ? 'idle' : 'idle';

  return (
    <div className="km-msg km-enter" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      {onReact && (
        <div className="km-msg-actions" role="toolbar" aria-label={t('chat.react')}>
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              className="km-msg-action"
              onClick={() => onReact(m.id, emoji)}
              aria-label={`${t('chat.react')} ${emoji}`}
            >{emoji}</button>
          ))}
          {onReply && (
            <button
              className="km-msg-action"
              onClick={() => onReply(m)}
              aria-label={t('chat.reply')}
              title={t('chat.reply')}
            >↩</button>
          )}
        </div>
      )}
      {isAgent && avatarDef ? (
        <BotAvatar definition={avatarDef} mood={mood as 'thinking' | 'idle'} size={34} />
      ) : (
        <div style={{
          width: 34, height: 34, borderRadius: '50%', backgroundColor: '#111', color: '#fff',
          fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {(m.authorName || '?').slice(0, 1).toUpperCase()}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{m.authorName}</span>
          {isAgent && <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)' }}>{m.authorKind === 'team' ? 'team' : 'agent'}</span>}
          <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)' }}>{fmtTime(m.createdAt)}</span>
          {m.status === 'streaming' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mantine-color-dimmed)' }}>
              <PixelSpinner size={14} /> {t('chat.working')} {elapsed && `· ${elapsed}`}
            </span>
          )}
          {m.status === 'error' && <span style={{ fontSize: 11, color: '#b42318' }}>error</span>}
        </div>
        <div style={{
          marginTop: 3, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: m.status === 'error' ? 'var(--mantine-color-dark-5)' : 'inherit',
        }}>
          <span className={m.status === 'streaming' ? 'km-stream-caret' : undefined}>
            {m.body || (m.status === 'streaming' ? '…' : '')}
          </span>
        </div>
        {Object.keys(reactions).length > 0 && (
          <div className="km-reactions">
            {Object.entries(reactions).map(([emoji, users]) => (
              <button
                key={emoji}
                className={`km-reaction${meId && users.includes(meId) ? ' mine' : ''}`}
                onClick={() => onReact?.(m.id, emoji)}
                title={users.join(', ')}
              >{emoji} {users.length}</button>
            ))}
          </div>
        )}
        {(m.meta?.attachments as ChatAttachment[] | undefined)?.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {(m.meta!.attachments as ChatAttachment[]).map((a) => <AttachmentChip key={a.id} a={a} />)}
          </div>
        ) : null}
        {(m.replyCount ?? 0) > 0 && !m.parentId && onOpenThread && (
          <button
            onClick={() => onOpenThread(m)}
            style={{
              marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 12, border: '1px solid var(--mantine-color-default-border)',
              background: 'transparent', fontSize: 12, color: 'var(--mantine-color-dimmed)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            💬 {m.replyCount} {t('chat.replies')}
          </button>
        )}
        {toolCalls.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {toolCalls.map((tc, i) => (
              <span key={i} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                border: '1px solid var(--mantine-color-default-border)', color: 'var(--mantine-color-dimmed)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                {tc.status === 'pending' ? <PixelSpinner size={14} /> : tc.status === 'done' ? '✓' : '·'} {tc.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
