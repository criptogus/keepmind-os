import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, ChannelMessage, ChatChannelView, Team } from '../../../shared/types.js';
import ChannelRail from './ChannelRail.js';
import MessageFeed from './MessageFeed.js';
import Composer from './Composer.js';
import ThreadPanel from './ThreadPanel.js';
import { useLang } from '../../lib/i18n.js';
import { useThemeStore } from '../../store/themeStore.js';
import { parseCommand, CHAT_COMMANDS } from './commands.js';
import { ASSISTANT_PERSONAS } from '../../../shared/personas.js';

interface ChatShellProps {
  onOpenAdmin: (section?: string) => void;
  pendingApprovals: number;
}

export default function ChatShell({ onOpenAdmin, pendingApprovals }: ChatShellProps) {
  const { t } = useLang();
  const [channels, setChannels] = useState<ChatChannelView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [meId, setMeId] = useState<string | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<ChannelMessage | null>(null);
  const [threadParent, setThreadParent] = useState<ChannelMessage | null>(null);
  const [threadKey, setThreadKey] = useState(0);
  const { setLang, lang } = useLang();
  const { setTheme } = useThemeStore();
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const threadParentRef = useRef<ChannelMessage | null>(null);
  threadParentRef.current = threadParent;

  const reloadChannels = useCallback(async () => {
    try {
      const list = await window.electronAPI.listChatChannels();
      setChannels(list);
      setActiveId((cur) => cur ?? list[0]?.id ?? null);
    } catch { /* main not ready */ }
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    try {
      const msgs = await window.electronAPI.getChatMessages(channelId, { limit: 100 });
      setMessages(msgs);
      void window.electronAPI.markChatRead(channelId);
      void reloadChannels();
    } catch { /* ignore */ }
  }, [reloadChannels]);

  useEffect(() => {
    void reloadChannels();
    void window.electronAPI.getAgents().then(setAgents).catch(() => {});
    void window.electronAPI.getTeams().then(setTeams).catch(() => {});
    void window.electronAPI.authGetState().then((s) => setMeId(s.currentUser?.id)).catch(() => {});

    const unsub = window.electronAPI.onChatEvent?.((event) => {
      if (event.type === 'channels-changed') {
        void reloadChannels();
        void window.electronAPI.getAgents().then(setAgents).catch(() => {});
        void window.electronAPI.getTeams().then(setTeams).catch(() => {});
        return;
      }
      const { channelId, message } = event;
      void reloadChannels();
      if (message.parentId) {
        setThreadKey((k) => k + 1);
        if (channelId === activeIdRef.current) void loadMessages(channelId);
        return;
      }
      if (channelId !== activeIdRef.current) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === message.id);
        if (idx === -1) return event.type === 'message-created' ? [...prev, message] : prev;
        const next = [...prev];
        next[idx] = message;
        return next;
      });
      if (event.type === 'message-created' && message.authorKind !== 'user') {
        void window.electronAPI.markChatRead(channelId);
      }
    });
    return () => unsub?.();
  }, [reloadChannels]);

  useEffect(() => {
    setThreadParent(null);
    setReplyTo(null);
    if (activeId) void loadMessages(activeId);
    else setMessages([]);
  }, [activeId, loadMessages]);

  const activeChannel = channels.find((c) => c.id === activeId) ?? null;

  const handleLoadEarlier = useCallback(async (beforeId: string) => {
    if (!activeId) return;
    const older = await window.electronAPI.getChatMessages(activeId, { before: beforeId, limit: 50 }).catch(() => [] as ChannelMessage[]);
    if (older.length) {
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !ids.has(m.id)), ...prev];
      });
    }
  }, [activeId]);

  const systemMsg = useCallback(async (text: string) => {
    if (!activeId) return;
    try { await window.electronAPI.postChatSystemMessage(activeId, text); }
    catch (e) { console.error('chat system message failed', e); }
  }, [activeId]);

  const executeCommand = useCallback(async (name: string, args: string) => {
    const say = (msg: string) => void systemMsg(msg);
    const api = window.electronAPI;
    switch (name) {
      case 'ajuda':
      case 'help': {
        const lines = CHAT_COMMANDS.map((c) => `\`/${c.name}${c.usage ? ' ' + c.usage : ''}\` — ${t(c.descKey)}`);
        say(`${lang === 'pt' ? 'Comandos disponíveis' : 'Available commands'}:\n\n${lines.join('\n')}`);
        return;
      }
      case 'admin': {
        const sections = ['work', 'dashboard', 'agents', 'teams', 'automations', 'skills', 'governance', 'logs', 'settings', 'advanced'];
        const target = args && sections.includes(args) ? args : undefined;
        onOpenAdmin(target);
        return;
      }
      case 'canal':
      case 'channel': {
        if (!args) { say(t('chat.cmdNeedName')); return; }
        try {
          const ch = await api.createChatChannel({ name: args });
          await reloadChannels();
          setActiveId(ch.id);
          say(`${lang === 'pt' ? 'Canal' : 'Channel'} #${ch.name} ${lang === 'pt' ? 'criado' : 'created'}`);
        } catch (e) { say(`⚠ ${e instanceof Error ? e.message : String(e)}`); }
        return;
      }
      case 'dm': {
        if (!args) { say(t('chat.cmdNeedName')); return; }
        const agent = agents.find((a) => a.name.toLowerCase() === args.toLowerCase())
          ?? agents.find((a) => a.name.toLowerCase().includes(args.toLowerCase()));
        if (!agent) { say(`⚠ ${lang === 'pt' ? 'Agente não encontrado' : 'Agent not found'}: ${args}`); return; }
        try {
          const ch = await api.openAgentDm(agent.id);
          await reloadChannels();
          setActiveId(ch.id);
        } catch (e) { say(`⚠ ${e instanceof Error ? e.message : String(e)}`); }
        return;
      }
      case 'som':
      case 'sound': {
        const on = args === 'on' || args === 'ligar' || args === 'true';
        const off = args === 'off' || args === 'desligar' || args === 'false';
        if (!on && !off) { say(`⚠ /som on|off`); return; }
        await api.updateSettings({ soundEffects: on });
        say(on ? '🔊' : '🔇');
        return;
      }
      case 'auto-aprovar':
      case 'autoapprove': {
        const on = args === 'on' || args === 'ligar';
        const off = args === 'off' || args === 'desligar';
        if (!on && !off) { say(`⚠ /auto-aprovar on|off`); return; }
        await api.updateSettings({ autoApprove: on });
        say(on ? (lang === 'pt' ? 'Auto-aprovação ativada' : 'Auto-approve on') : (lang === 'pt' ? 'Auto-aprovação desativada' : 'Auto-approve off'));
        return;
      }
      case 'tema':
      case 'theme': {
        const map: Record<string, 'light' | 'dark' | 'auto'> = { light: 'light', claro: 'light', dark: 'dark', escuro: 'dark', auto: 'auto' };
        const v = map[args];
        if (!v) { say(`⚠ /tema light|dark|auto`); return; }
        await setTheme(v);
        say(`🎨 ${v}`);
        return;
      }
      case 'idioma':
      case 'lang': {
        const v = args === 'pt' || args === 'en' || args === 'es' ? args : null;
        if (!v) { say(`⚠ /idioma pt|en|es`); return; }
        await api.updateSettings({ language: v });
        setLang(v as 'pt' | 'en' | 'es');
        say(`🌐 ${v}`);
        return;
      }
      case 'persona': {
        if (!args) {
          const list = ASSISTANT_PERSONAS.map((p) => `• \`/persona ${p.id}\` — **${p.name}**: ${p.tagline}`).join('\n');
          say(`${lang === 'pt' ? 'Perfis do assistente' : 'Assistant personas'}:\n\n${list}`);
          return;
        }
        const p = ASSISTANT_PERSONAS.find((x) => x.id === args.toLowerCase() || x.name.toLowerCase() === args.toLowerCase());
        if (!p) { say(`⚠ ${lang === 'pt' ? 'Perfil não encontrado' : 'Persona not found'}: ${args} — ${lang === 'pt' ? 'use /persona sem argumentos para listar' : 'use /persona with no args to list'}`); return; }
        try {
          await api.updateSettings({ assistantPersona: p.id });
          say(`${lang === 'pt' ? 'Perfil do assistente alterado para' : 'Assistant persona set to'} **${p.name}** — ${p.tagline}`);
        } catch {
          say(`⚠ ${lang === 'pt' ? 'Sem permissão para alterar configurações' : 'Not allowed to change settings'}`);
        }
        return;
      }
      default:
        say(`⚠ ${lang === 'pt' ? 'Comando desconhecido' : 'Unknown command'}: /${name} — ${lang === 'pt' ? 'use /ajuda' : 'use /help'}`);
    }
  }, [activeId, agents, lang, onOpenAdmin, reloadChannels, setLang, setTheme, systemMsg, t]);

  const handleSend = useCallback(async (text: string, attachments?: Array<Record<string, unknown>>) => {
    if (!activeId) return;
    const cmd = parseCommand(text);
    if (cmd) { await executeCommand(cmd.name, cmd.args); return; }
    try {
      await window.electronAPI.sendChatMessage(activeId, text, replyTo ? { parentId: replyTo.id, attachments } : { attachments });
      setReplyTo(null);
    } catch (e) {
      console.error('chat send failed', e);
    }
  }, [activeId, executeCommand, replyTo]);

  const handleReact = useCallback((messageId: string, emoji: string) => {
    void window.electronAPI.reactChatMessage(messageId, emoji).catch(() => {});
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--mantine-color-body)', fontFamily: 'inherit' }}>
      <ChannelRail
        channels={channels}
        agents={agents}
        activeId={activeId}
        onSelect={setActiveId}
        onOpenAdmin={onOpenAdmin}
        pendingApprovals={pendingApprovals}
        onChanged={reloadChannels}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 20px', borderBottom: '1px solid var(--mantine-color-default-border)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {activeChannel ? `# ${activeChannel.name}` : ''}
          </span>
          {activeChannel?.topic && (
            <span style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>{activeChannel.topic}</span>
          )}
          <div style={{ flex: 1 }} />
          <button
            data-tour="chat-admin"
            onClick={() => onOpenAdmin()}
            className="km-primary-action"
            style={{
              WebkitAppRegion: 'no-drag',
              padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            } as React.CSSProperties}
          >
            {t('chat.admin')}
          </button>
        </header>
        <MessageFeed
          messages={messages}
          agents={agents}
          teams={teams}
          meId={meId}
          onReact={handleReact}
          onReply={setReplyTo}
          onOpenThread={setThreadParent}
          onRefresh={() => activeId && loadMessages(activeId)}
          onLoadEarlier={handleLoadEarlier}
        />
        <Composer
          agents={agents}
          teams={teams}
          onSend={handleSend}
          disabled={!activeId}
          replyTo={replyTo ? { authorName: replyTo.authorName, snippet: replyTo.body.slice(0, 60) } : null}
          onCancelReply={() => setReplyTo(null)}
        />
      </div>
      {threadParent && activeId && (
        <ThreadPanel
          parent={threadParent}
          channelId={activeId}
          agents={agents}
          teams={teams}
          meId={meId}
          refreshKey={threadKey}
          onClose={() => setThreadParent(null)}
          onChanged={() => activeId && loadMessages(activeId)}
        />
      )}
    </div>
  );
}
