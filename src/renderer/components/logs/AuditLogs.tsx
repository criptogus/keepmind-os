import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import { IconLogs } from '../common/icons.js';
import type { AuditEntry } from '../../../shared/types.js';

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.electronAPI.getAuditLogs(50);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">Loading audit logs...</Text>;
  }

  if (error) {
    return <Text c="dimmed">Error: {error}</Text>;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2} size="h4">Activity Logs</Title>
        <Button size="xs" variant="default" onClick={loadLogs}>Refresh</Button>
      </Group>

      {logs.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconLogs />
            <Text fw={500}>No audit logs yet</Text>
            <Text size="sm" c="dimmed">Activity will be logged here as agents execute</Text>
          </Stack>
        </Card>
      ) : (
        <Card withBorder padding={0} radius="md">
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Timestamp</Table.Th>
                <Table.Th>Agent</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Input</Table.Th>
                <Table.Th>Output</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {logs.map((log) => (
                <Table.Tr key={log.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Text size="sm" c="dimmed">{new Date(log.timestamp).toLocaleString()}</Text>
                  </Table.Td>
                  <Table.Td><Text size="sm">{log.agentName}</Text></Table.Td>
                  <Table.Td><Badge size="sm" variant="light" color="gray">{log.action}</Badge></Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace" c="dimmed">
                      {JSON.stringify(log.input).substring(0, 60)}
                      {JSON.stringify(log.input).length > 60 && '…'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace" c="dimmed">
                      {JSON.stringify(log.output).substring(0, 60)}
                      {JSON.stringify(log.output).length > 60 && '…'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}
