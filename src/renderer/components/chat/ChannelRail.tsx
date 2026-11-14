import React, { useState } from 'react';
import { Modal, Button, TextInput, Checkbox, Group, Text, ActionIcon } from '@mantine/core';
import type { Agent, ChatChannelView } from '../../../shared/types.js';
import BotAvatar from '../common/BotAvatar.js';
import { avatarForAgent, presetAvatarFor } from '../../../shared/avatars.js';
import { useLang } from '../../lib/i18n.js';

interface ChannelRailProps {
  channels: ChatChannelView[];
  agents: Agent[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenAdmin: () => void;
  pendingApprovals: number;
  onChanged: () => void;
}

export default function ChannelRail({ channels, agents: allAgents, activeId, onSelect, onOpenAdmin, pendingApprovals, onChanged }: ChannelRailProps) {
  const { t } = useLang();
  const [createOpen, setCreateOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<ChatChannelView | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteFor, setDeleteFor] = useState<ChatChannelView | null>(null);

  const openCreate = async () => {
    setCreateOpen(true);
    setName('');
    setSelected(new Set());
    const list = await window.electronAPI.getAgents().catch(() => [] as Agent[]);
    setAgents(list);
  };

  const create = async () => {
    if (!name.trim()) return;
    await window.electronAPI.createChatChannel({ name: name.trim(), agentIds: [...selected] });
    setCreateOpen(false);
    onChanged();
  };

  const channelGroups = {
    channels: channels.filter((c) => c.kind === 'channel'),
    dms: channels.filter((c) => c.kind === 'dm'),
  };
  const dmAgentIds = new Set(channelGroups.dms.map((c) => c.agentId));
  const agentsWithoutDm = allAgents.filter((a) => !dmAgentIds.has(a.id));

  const openDm = async (agentId: string) => {
    const ch = await window.electronAPI.openAgentDm(agentId);
    onChanged();
    onSelect(ch.id);
  };

  const renderItem = (ch: ChatChannelView) => {
    const isActive = ch.id === activeId;
    const isApprovals = ch.name === 'approvals';
    const isDm = ch.kind === 'dm';
    const agent = ch.agents[0];
    return (
      <div
        key={ch.id}
        onClick={() => onSelect(ch.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
          borderRadius: 8, cursor: 'pointer', fontSize: 14,
          backgroundColor: isActive ? 'var(--mantine-color-default-hover)' : 'transparent',
          fontWeight: isActive ? 600 : 400,
          position: 'relative',
          boxShadow: isActive ? 'inset 3px 0 var(--km-lime, #c4ff3d)' : 'none',
        }}
        onContextMenu={(e) => { e.preventDefault(); setMenuFor(menuFor === ch.id ? null : ch.id); }}
      >
        {isDm && agent ? (
          <BotAvatar definition={avatarForAgent({ id: agent.id, avatar: agent.avatar ?? undefined })} size={20} showBadge={false} />
        ) : isDm ? (
          <BotAvatar definition={presetAvatarFor(ch.agentId ?? ch.id)} size={20} showBadge={false} />
        ) : null}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isDm ? agent?.name ?? ch.name : `# ${ch.name}`}
        </span>
        {isApprovals && pendingApprovals > 0 && (
          <span style={{
            minWidth: 18, height: 18, borderRadius: 9, backgroundColor: 'var(--km-lime, #c4ff3d)', color: '#111',
            fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
          }}>{pendingApprovals}</span>
        )}
        {!isActive && ch.unread > 0 && (
          <span style={{
            minWidth: 18, height: 18, borderRadius: 9, backgroundColor: 'var(--km-lime, #c4ff3d)', color: '#111',
            fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
          }}>{ch.unread > 99 ? '99+' : ch.unread}</span>
        )}
        {menuFor === ch.id && !isDm && ch.name !== 'geral' && ch.name !== 'approvals' && (
          <span style={{ position: 'absolute', right: 4, top: 4, display: 'flex', gap: 4 }}>
            <ActionIcon size="xs" variant="subtle" color="gray" onClick={(e) => {
              e.stopPropagation();
              setRenameFor(ch); setRenameValue(ch.name); setMenuFor(null);
            }}>✎</ActionIcon>
            <ActionIcon size="xs" variant="subtle" color="red" onClick={(e) => {
              e.stopPropagation();
              setDeleteFor(ch); setMenuFor(null);
            }}>✕</ActionIcon>
          </span>
        )}
      </div>
    );
  };

  return (
    <aside style={{
      width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column',
      backgroundColor: 'var(--mantine-color-body)', borderRight: '1px solid var(--mantine-color-default-border)',
      height: '100vh',
    }}>
      <div style={{ padding: '14px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>KeepMind OS</span>
        <ActionIcon size="sm" variant="subtle" color="gray" onClick={openCreate} aria-label={t('chat.newChannel')}>+</ActionIcon>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--mantine-color-dimmed)', padding: '10px 8px 4px', letterSpacing: '0.04em' }}>{t('chat.channels')}</div>
        {channelGroups.channels.map(renderItem)}
        {channelGroups.dms.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--mantine-color-dimmed)', padding: '14px 8px 4px', letterSpacing: '0.04em' }}>{t('chat.dms')}</div>
            {channelGroups.dms.map(renderItem)}
          </>
        )}
        {agentsWithoutDm.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--mantine-color-dimmed)', padding: '14px 8px 4px', letterSpacing: '0.04em' }}>{t('nav.agents')}</div>
            {agentsWithoutDm.map((a) => (
              <div
                key={a.id}
                onClick={() => void openDm(a.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}
              >
                <BotAvatar definition={avatarForAgent(a)} size={20} showBadge={false} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--mantine-color-default-border)', fontSize: 11, color: 'var(--mantine-color-dimmed)' }}>
        <button
          onClick={onOpenAdmin}
          style={{
            width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid var(--mantine-color-default-border)',
            background: 'transparent', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            color: 'var(--mantine-color-dark-6)', marginBottom: 8,
          }}
        >
          {t('chat.admin')} ⚙
        </button>
        <Text size="xs" c="dimmed">{t('nav.poweredBy')} ZeroAgency.ai</Text>
      </div>

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title={t('chat.newChannel')} centered>
        <TextInput
          label={t('chat.channelName')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="projeto-x"
          mb="sm"
        />
        <Text size="sm" fw={600} mb={6}>{t('chat.members')}</Text>
        <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {agents.map((a) => (
            <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer' }}>
              <Checkbox
                checked={selected.has(a.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.currentTarget.checked) next.add(a.id); else next.delete(a.id);
                  setSelected(next);
                }}
              />
              <BotAvatar definition={avatarForAgent(a)} size={20} showBadge={false} />
              <span style={{ fontSize: 14 }}>{a.name}</span>
            </label>
          ))}
          {agents.length === 0 && <Text size="sm" c="dimmed">{t('chat.empty')}</Text>}
        </div>
        <Group justify="flex-end">
          <Button variant="subtle" onClick={() => setCreateOpen(false)}>{t('chat.cancel')}</Button>
          <Button onClick={create} disabled={!name.trim()}>{t('chat.create')}</Button>
        </Group>
      </Modal>

      <Modal opened={!!renameFor} onClose={() => setRenameFor(null)} title={t('chat.rename')} centered>
        <TextInput value={renameValue} onChange={(e) => setRenameValue(e.currentTarget.value)} />
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={() => setRenameFor(null)}>{t('chat.cancel')}</Button>
          <Button onClick={async () => {
            if (renameFor && renameValue.trim()) {
              await window.electronAPI.renameChatChannel(renameFor.id, renameValue.trim());
              onChanged();
            }
            setRenameFor(null);
          }}>{t('chat.rename')}</Button>
        </Group>
      </Modal>

      <Modal opened={!!deleteFor} onClose={() => setDeleteFor(null)} title={t('chat.deleteChannel')} centered>
        <Text size="sm" mb="md">{t('chat.deleteChannel')}: #{deleteFor?.name}?</Text>
        <Group justify="flex-end">
          <Button variant="subtle" onClick={() => setDeleteFor(null)}>{t('chat.cancel')}</Button>
          <Button color="red" onClick={async () => {
            if (deleteFor) { await window.electronAPI.deleteChatChannel(deleteFor.id); onChanged(); }
            setDeleteFor(null);
          }}>{t('chat.deleteChannel')}</Button>
        </Group>
      </Modal>
    </aside>
  );
}
