import React, { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Collapse, CopyButton, Group, Stack, Switch, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useGovernanceStore } from '../../store/governanceStore';
import { useAgentStore } from '../../store/agentStore';
import { useLang } from '../../lib/i18n';
import { describeApproval } from '../../lib/plainLanguage';
import { IconShield } from '../common/icons.js';
import PageHeader from '../common/PageHeader';
import BotAvatar from '../common/BotAvatar';
import PixelSpinner from '../common/PixelSpinner';
import { avatarForAgent } from '../../../shared/avatars';
import { sfxAttention, sfxDone, sfxError } from '../../lib/sfx';
import type { Agent } from '../../../shared/types.js';

const SENSITIVE_TOOLS = new Set(['shell_exec', 'file_write', 'whatsapp_send_message', 'composio_execute', 'secondbrain_remember']);
/** Mirrors APPROVAL_TIMEOUT_MS in main.ts — the gate auto-rejects after this. */
const APPROVAL_TTL_MS = 24 * 60 * 60_000;

export default function ApprovalQueue() {
  const { t, lang } = useLang();
  const { pendingApprovals, loading, error, fetchPendingApprovals, approveAction, rejectAction } = useGovernanceStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [now, setNow] = useState(Date.now());
  const [remote, setRemote] = useState<{ enabled: boolean; url: string | null } | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  const refreshRemote = () => {
    window.electronAPI.getRemoteApprovalsStatus()
      .then(setRemote)
      .catch(() => {});
  };

  useEffect(() => {
    fetchPendingApprovals();
    refreshRemote();
    void window.electronAPI.getAgents().then(setAgents).catch(() => {});
    const interval = setInterval(() => {
      fetchPendingApprovals();
      setNow(Date.now());
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchPendingApprovals]);

  // Soft chime when a *new* approval arrives (not on first paint).
  useEffect(() => {
    const fresh = pendingApprovals.filter((a) => !seenIds.current.has(a.id));
    if (seenIds.current.size > 0 && fresh.length > 0) sfxAttention();
    for (const a of pendingApprovals) seenIds.current.add(a.id);
  }, [pendingApprovals]);

  const agentFor = (id: string) => agents.find((a) => a.id === id);

  const expiryLabel = (createdAt: string): string | null => {
    const left = APPROVAL_TTL_MS - (now - new Date(createdAt).getTime());
    if (left <= 0) return t('ap2.expired');
    const s = Math.ceil(left / 1000);
    return s >= 60 ? `${t('ap2.expiresIn')} ${Math.ceil(s / 60)}min` : `${t('ap2.expiresIn')} ${s}s`;
  };

  const handleApprove = async (id: string) => {
    await approveAction(id);
    sfxDone();
  };

  const handleReject = async (id: string) => {
    const reason = prompt(t('ap.rejectReason'));
    if (reason) {
      await rejectAction(id, reason);
      sfxError();
    }
  };

  if (loading && pendingApprovals.length === 0) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <PixelSpinner size={24} />
        <Text c="dimmed">{t('ap.loading')}</Text>
      </Stack>
    );
  }

  if (error) {
    return <Text c="dimmed">{t('common.error')}: {error}</Text>;
  }

  return (
    <Stack gap="md">
      <PageHeader
        title={t('ap.title')}
        subtitle={t('ph.gov.sub')}
        help={t('ph.gov.help')}

      />
      <RemoteApprovalsCard
        remote={remote}
        busy={remoteBusy}
        onToggle={async (enabled) => {
          setRemoteBusy(true);
          try {
            const res = await window.electronAPI.setRemoteApprovalsEnabled(enabled);
            setRemote({ enabled, url: res.url });
          } finally {
            setRemoteBusy(false);
          }
        }}
        onRegenerate={async () => {
          setRemoteBusy(true);
          try {
            const res = await window.electronAPI.regenerateRemoteApprovalsLink();
            setRemote((r) => ({ enabled: r?.enabled ?? false, url: res.url }));
          } finally {
            setRemoteBusy(false);
          }
        }}
      />

      {pendingApprovals.length > 0 && (
        <Badge size="sm" variant="light" color="gray" w="fit-content">{pendingApprovals.length} {t('common.pending')}</Badge>
      )}

      {pendingApprovals.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconShield />
            <Text fw={500}>{t('ap.empty')}</Text>
            <Text size="sm" c="dimmed">{t('ap.emptyHint')}</Text>
          </Stack>
        </Card>
      ) : (
        pendingApprovals.map((approval) => {
          const desc = describeApproval(approval, lang === 'pt' ? 'pt' : 'en');
          const tool = (approval.context as { tool?: string } | undefined)?.tool || '';
          const isOpen = !!expanded[approval.id];
          const agent = agentFor(approval.agentId);
          const expiry = expiryLabel(approval.createdAt);
          return (
            <Card key={approval.id} withBorder padding="lg" radius="md" className="km-enter">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Group gap="xs">
                    {agent && <BotAvatar definition={avatarForAgent(agent)} mood="thinking" size={28} />}
                    <Text size="xs" c="dimmed">{new Date(approval.createdAt).toLocaleString()}</Text>
                    {expiry && <Text size="xs" c="dimmed">· {expiry}</Text>}
                  </Group>
                  <Group gap="xs">
                    <Badge size="xs" variant="light" color="dark">{t('ap2.waitingYou')}</Badge>
                    {SENSITIVE_TOOLS.has(tool) && (
                      <Badge size="xs" variant="light" color="gray">{t('gov.sensitive')}</Badge>
                    )}
                  </Group>
                </Group>
                <div>
                  <Text size="lg" fw={600}>
                    {approval.agentName} {t('ap2.agentWants')} {desc.action}
                    {desc.target && <> {t('ap2.for')} <Text span fw={600} ff="monospace" size="sm">{desc.target}</Text></>}
                  </Text>
                  {typeof approval.context.decisionReason === 'string' && <Text size="sm" c="dimmed">{approval.context.decisionReason}</Text>}
                  {desc.payload && (
                    <Card withBorder padding="sm" radius="sm" mt={8} style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {desc.payload}
                      </Text>
                    </Card>
                  )}
                </div>
                {SENSITIVE_TOOLS.has(tool) && (
                  <Text size="xs" c="dimmed">{t('ap2.sensitiveHint')}</Text>
                )}
                <UnstyledButton onClick={() => setExpanded((s) => ({ ...s, [approval.id]: !isOpen }))}>
                  <Text size="xs" c="dimmed" td="underline">
                    {isOpen ? t('ap2.hideDetails') : t('ap2.details')}
                  </Text>
                </UnstyledButton>
                <Collapse in={isOpen}>
                  <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                    <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {JSON.stringify(approval.context, null, 2)}
                    </Text>
                  </Card>
                </Collapse>
                <Group justify="flex-end" gap="sm">
                  <Button size="sm" variant="default" onClick={() => handleApprove(approval.id)}>{t('common.approve')}</Button>
                  <Button size="sm" variant="default" color="red" onClick={() => handleReject(approval.id)}>{t('common.reject')}</Button>
                </Group>
              </Stack>
            </Card>
          );
        })
      )}
    </Stack>
  );
}

function RemoteApprovalsCard({
  remote,
  busy,
  onToggle,
  onRegenerate,
}: {
  remote: { enabled: boolean; url: string | null } | null;
  busy: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onRegenerate: () => Promise<void>;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const enabled = remote?.enabled === true;

  return (
    <Card withBorder padding="sm" radius="md">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" fw={500}>{t('ap2.remoteTitle')}</Text>
          {enabled && <Badge size="xs" variant="light" color="green">{t('ap2.remoteOn')}</Badge>}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {enabled && remote?.url && (
            <Button size="compact-xs" variant="subtle" onClick={() => setOpen((o) => !o)}>
              {open ? t('ap2.remoteHide') : t('ap2.remoteShow')}
            </Button>
          )}
          <Switch
            size="sm"
            checked={enabled}
            disabled={busy || remote === null}
            onChange={(e) => void onToggle(e.currentTarget.checked)}
            aria-label={t('ap2.remoteTitle')}
          />
        </Group>
      </Group>
      {enabled && open && remote?.url && (
        <Stack gap="xs" mt="sm">
          <Text size="xs" c="dimmed">{t('ap2.remoteHint')}</Text>
          <Group gap="xs" wrap="nowrap">
            <TextInput size="xs" value={remote.url} readOnly style={{ flex: 1 }} ff="monospace" />
            <CopyButton value={remote.url} timeout={1500}>
              {({ copied, copy }) => (
                <Button size="compact-xs" variant="default" onClick={copy}>
                  {copied ? t('ap2.remoteCopied') : t('ap2.remoteCopy')}
                </Button>
              )}
            </CopyButton>
            <Button size="compact-xs" variant="subtle" color="gray" loading={busy} onClick={() => void onRegenerate()}>
              {t('ap2.remoteRotate')}
            </Button>
          </Group>
        </Stack>
      )}
    </Card>
  );
}
