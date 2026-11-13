import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import LoadFeedback from '../common/LoadFeedback';
import { useLang } from '../../lib/i18n';

type Summary = Awaited<ReturnType<typeof window.electronAPI.governanceSummary>>;

const CATEGORY_COLORS: Record<string, string> = {
  approvals: 'lime', exports: 'gray', integrations: 'lime', agents: 'gray', access: 'gray', admin: 'gray',
};

function categoryLabel(cat: string, t: (k: string) => string): string {
  return t(`govsum.cat.${cat}`) || cat;
}

export default function GovernanceOverview() {
  const { t, lang } = useLang();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const load = () => {
    setError(null); setLoading(true);
    void window.electronAPI.governanceSummary().then(setData)
      .catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  };
  useEffect(load, []);
  if (!data) return <LoadFeedback loading={!error} error={error} retry={load} />;

  const catEntries = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]);
  const failedExecs = data.execByStatus.failed || 0;

  return (
    <Stack gap="md" className="km-enter">
      <Group justify="flex-end"><Button size="xs" variant="default" loading={loading} onClick={load}>{t('common.refresh')}</Button></Group>
      <LoadFeedback loading={loading} error={error} retry={load} />
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Card withBorder padding="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase">{t('govsum.auditEntries')}</Text>
          <Text size="xl" fw={700}>{data.totalEntries}</Text>
        </Card>
        <Card withBorder padding="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase">{t('govsum.agentRuns')}</Text>
          <Text size="xl" fw={700}>{data.totalExecutions}</Text>
          {failedExecs > 0 && <Text size="xs" c="red">{failedExecs} {t('govsum.failed')}</Text>}
        </Card>
        <Card withBorder padding="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase">{t('govsum.approvals')}</Text>
          <Group gap="xs">
            <Badge color="yellow" variant="light">{data.approvals.pending} {t('govsum.pending')}</Badge>
            <Badge color="lime" variant="light">{data.approvals.approved}</Badge>
            <Badge color="red" variant="light">{data.approvals.rejected}</Badge>
          </Group>
        </Card>
        <Card withBorder padding="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase">{t('govsum.channels')}</Text>
          <Text size="sm" fw={500}>
            {Object.entries(data.execByChannel).map(([ch, n]) => `${n} ${ch}`).join(' · ') || '—'}
          </Text>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder padding="md" radius="md">
          <Text fw={600} size="sm" mb="xs">{t('govsum.byCategory')}</Text>
          <Table.ScrollContainer minWidth={320}><Table className="km-data-table" highlightOnHover>
            <Table.Tbody>
              {catEntries.map(([cat, count]) => (
                <Table.Tr key={cat}>
                  <Table.Td>
                    <Badge color={CATEGORY_COLORS[cat] || 'gray'} variant="light">{categoryLabel(cat, t)}</Badge>
                  </Table.Td>
                  <Table.Td ta="right" fw={600}>{count}</Table.Td>
                </Table.Tr>
              ))}
              {catEntries.length === 0 && (
                <Table.Tr><Table.Td><Text size="sm" c="dimmed">{t('govsum.empty')}</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table></Table.ScrollContainer>
        </Card>

        <Card withBorder padding="md" radius="md">
          <Text fw={600} size="sm" mb="xs">{t('govsum.byUser')}</Text>
          <Table.ScrollContainer minWidth={320}><Table className="km-data-table" highlightOnHover>
            <Table.Tbody>
              {data.byUser.map((u) => (
                <Table.Tr key={u.userId}>
                  <Table.Td><Text size="sm" ff="monospace">{u.userId}</Text></Table.Td>
                  <Table.Td ta="right" fw={600}>{u.count}</Table.Td>
                </Table.Tr>
              ))}
              {data.byUser.length === 0 && (
                <Table.Tr><Table.Td><Text size="sm" c="dimmed">{t('govsum.empty')}</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table></Table.ScrollContainer>
        </Card>
      </SimpleGrid>

      {data.topTools.length > 0 && (
        <Card withBorder padding="md" radius="md">
          <Text fw={600} size="sm" mb="xs">{t('govsum.topTools')}</Text>
          <Group gap="xs" wrap="wrap">
            {data.topTools.map((tool) => (
              <Badge key={tool.name} variant="light" color="lime" size="lg" radius="sm">
                {tool.name} <Text span ff="monospace" fw={700}>×{tool.count}</Text>
              </Badge>
            ))}
          </Group>
        </Card>
      )}

      <Card withBorder padding="md" radius="md">
        <Text fw={600} size="sm" mb="xs">{t('govsum.recentActivity')}</Text>
        <Table.ScrollContainer minWidth={320}><Table className="km-data-table" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('govsum.when')}</Table.Th>
              <Table.Th>{t('govsum.who')}</Table.Th>
              <Table.Th>{t('govsum.actor')}</Table.Th>
              <Table.Th>{t('govsum.action')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.recent.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td><Text size="xs" c="dimmed">{new Date(r.timestamp).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US')}</Text></Table.Td>
                <Table.Td><Text size="sm" ff="monospace">{r.userId}</Text></Table.Td>
                <Table.Td><Text size="sm">{r.agentName}</Text></Table.Td>
                <Table.Td>
                  <Badge color={CATEGORY_COLORS[r.category] || 'gray'} variant="light" size="sm">
                    {r.action}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
            {data.recent.length === 0 && (
              <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed" ta="center">{t('govsum.empty')}</Text></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table></Table.ScrollContainer>
      </Card>
    </Stack>
  );
}
