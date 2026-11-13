import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Stack, Table, Text } from '@mantine/core';
import { IconLogs } from '../common/icons.js';
import { useLang } from '../../lib/i18n';
import LoadFeedback from '../common/LoadFeedback';
import PageHeader from '../common/PageHeader';
import type { AuditEntry, RoutingDecision } from '../../../shared/types.js';

export default function AuditLogs() {
  const { t, lang } = useLang();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [routing, setRouting] = useState<RoutingDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const handleExport = async (format: 'json' | 'html') => {
    setExporting(true);
    setExportMsg(null);
    try {
      const res = format === 'json'
        ? await window.electronAPI.exportAuditReceiptJson()
        : await window.electronAPI.exportAuditReceiptHtml();
      if (res.ok && res.path) {
        setExportMsg(t('logs.receiptSaved').replace('{n}', String(res.entryCount ?? 0)));
      }
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, decisions] = await Promise.all([window.electronAPI.getAuditLogs(50), window.electronAPI.getRoutingDecisions(30)]);
      setLogs(data); setRouting(decisions);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap="md" className="km-enter">
      <PageHeader
        title={t('ph.logs.title')}
        subtitle={t('ph.logs.sub')}
        help={t('ph.logs.help')}
        actions={(
          <Group gap="xs">
            {exportMsg && <Text size="xs" c="dimmed">{exportMsg}</Text>}
            <Button size="xs" variant="default" onClick={() => void handleExport('html')} loading={exporting}>
              {t('logs.exportPdf')}
            </Button>
            <Button size="xs" variant="default" onClick={() => void handleExport('json')} loading={exporting}>
              {t('logs.exportJson')}
            </Button>
            <Button size="xs" variant="default" onClick={loadLogs} loading={loading}>{t('common.refresh')}</Button>
          </Group>
        )}
      />

      <LoadFeedback loading={loading} error={error} retry={() => void loadLogs()} />
      {logs.length === 0 && (loading || error) ? null : logs.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconLogs />
            <Text fw={500}>{t('logs.empty')}</Text>
            <Text size="sm" c="dimmed">{t('logs.emptyHint')}</Text>
          </Stack>
        </Card>
      ) : (
        <Card withBorder padding={0} radius="md">
          <Table.ScrollContainer minWidth={1000}><Table className="km-data-table" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('logs.timestamp')}</Table.Th>
                <Table.Th>{t('logs.agent')}</Table.Th>
                <Table.Th>{t('logs.action')}</Table.Th>
                <Table.Th>{t('logs.input')}</Table.Th>
                <Table.Th>{t('logs.output')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {logs.map((log) => (
                <Table.Tr key={log.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Text size="sm" c="dimmed">{new Date(log.timestamp).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US')}</Text>
                  </Table.Td>
                  <Table.Td><Text size="sm">{log.agentName}</Text></Table.Td>
                  <Table.Td><Text size="xs" title={log.action}>{log.action === 'agent_review' ? (lang === 'pt' ? 'Revisão do agente' : 'Agent review') : log.action.replaceAll('_', ' ')}</Text></Table.Td>
                  <Table.Td>
                    <Payload value={log.input} />
                  </Table.Td>
                  <Table.Td>
                    <Payload value={log.output} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table></Table.ScrollContainer>
        </Card>
      )}

      {routing.length > 0 && (
        <>
          <Text fw={600} size="sm" mt="md">{t('logs.routingTitle')}</Text>
          <Text size="xs" c="dimmed" mb="xs">{t('logs.routingDesc')}</Text>
          <Card withBorder padding={0} radius="md">
            <Table.ScrollContainer minWidth={1000}><Table className="km-data-table" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('logs.timestamp')}</Table.Th>
                  <Table.Th>{t('logs.routingKind')}</Table.Th>
                  <Table.Th>{t('logs.routingSubject')}</Table.Th>
                  <Table.Th>{t('logs.routingPicked')}</Table.Th>
                  <Table.Th>{t('logs.routingReason')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {routing.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <Text size="sm" c="dimmed">{new Date(r.createdAt).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US')}</Text>
                    </Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color="gray">{r.kind}</Badge></Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{r.subject}</Text></Table.Td>
                    <Table.Td><Text size="xs" ff="monospace">{r.decision.join(', ') || '—'}</Text></Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{r.reason ?? '—'}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table></Table.ScrollContainer>
          </Card>
        </>
      )}
    </Stack>
  );
}

function Payload({ value }: { value: unknown }) {
  const content = value == null ? '—' : JSON.stringify(value, null, 2) ?? '—';
  if (content.length < 65) return <Text size="xs" ff="monospace">{content}</Text>;
  return <details className="km-table-details"><summary>{content.replace(/\s+/g, ' ').slice(0, 60)}…</summary><pre>{content}</pre></details>;
}
