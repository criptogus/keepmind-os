import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Collapse, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useGovernanceStore } from '../../store/governanceStore';
import { useLang } from '../../lib/i18n';
import { describeApproval } from '../../lib/plainLanguage';
import { IconShield } from '../common/icons.js';
import PageHeader from '../common/PageHeader';

const SENSITIVE_TOOLS = new Set(['shell_exec', 'file_write', 'whatsapp_send_message', 'composio_execute', 'secondbrain_remember']);

export default function ApprovalQueue() {
  const { t, lang } = useLang();
  const { pendingApprovals, loading, error, fetchPendingApprovals, approveAction, rejectAction } = useGovernanceStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchPendingApprovals();
    const interval = setInterval(fetchPendingApprovals, 5000);
    return () => clearInterval(interval);
  }, [fetchPendingApprovals]);

  const handleApprove = async (id: string) => {
    await approveAction(id);
  };

  const handleReject = async (id: string) => {
    const reason = prompt(t('ap.rejectReason'));
    if (reason) {
      await rejectAction(id, reason);
    }
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">{t('ap.loading')}</Text>;
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
        actions={pendingApprovals.length > 1 ? (
          <Button
            size="xs"
            variant="default"
            onClick={async () => {
              for (const a of pendingApprovals) {
                await approveAction(a.id);
              }
            }}
          >
            {t('ap.approveAll')}
          </Button>
        ) : undefined}
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
          return (
            <Card key={approval.id} withBorder padding="lg" radius="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">{new Date(approval.createdAt).toLocaleString()}</Text>
                  {SENSITIVE_TOOLS.has(tool) && (
                    <Badge size="xs" variant="light" color="dark">{t('gov.sensitive')}</Badge>
                  )}
                </Group>
                <div>
                  <Text size="lg" fw={600}>
                    {approval.agentName} {t('ap2.agentWants')} {desc.action}
                    {desc.target && <> {t('ap2.for')} <Text span fw={600} ff="monospace" size="sm">{desc.target}</Text></>}
                  </Text>
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
