import React, { useCallback, useEffect, useState } from 'react';
import type { Agent, ChannelMessage, Team } from '../../../shared/types.js';
import { MessageBubble } from './MessageFeed.js';
import Composer from './Composer.js';
import { useLang } from '../../lib/i18n.js';

interface ThreadPanelProps {
  parent: ChannelMessage;
  channelId: string;
  agents: Agent[];
  teams: Team[];
  meId?: string;
  refreshKey: number;
  onClose: () => void;
  onChanged: () => void;
}

export default function ThreadPanel({ parent, channelId, agents, teams, meId, refreshKey, onClose, onChanged }: ThreadPanelProps) {
  const { t } = useLang();
  const [replies, setReplies] = useState<ChannelMessage[]>([]);
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const teamById = new Map(teams.map((tm) => [tm.id, tm]));

  const load = useCallback(async () => {
    try {
      setReplies(await window.electronAPI.getChatThread(parent.id));
    } catch { /* ignore */ }
  }, [parent.id]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const send = async (text: string, attachments?: Array<Record<string, unknown>>) => {
    try {
      await window.electronAPI.sendChatMessage(channelId, text, { parentId: parent.id, attachments });
      void load();
      onChanged();
    } catch (e) { console.error('thread send failed', e); }
  };

  const all = [parent, ...replies];

  return (
    <div style={{
      width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--mantine-color-default-border)', backgroundColor: 'var(--mantine-color-body)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
        borderBottom: '1px solid var(--mantine-color-default-border)',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{t('chat.thread')}</span>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--mantine-color-dimmed)' }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {all.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            agent={m.authorKind === 'agent' ? agentById.get(m.authorId) : undefined}
            team={m.authorKind === 'team' ? teamById.get(m.authorId) : undefined}
            meId={meId}
            onChoose={m.id === all.at(-1)?.id && m.status === 'done' ? async text => { await window.electronAPI.sendChatMessage(channelId, text, { parentId: parent.id }); await load(); onChanged(); } : undefined}
            onRefresh={load}
          />
        ))}
      </div>
      <Composer agents={agents} teams={teams} onSend={send} replyTo={{ authorName: parent.authorName, snippet: parent.body.slice(0, 60) }} />
    </div>
  );
}
