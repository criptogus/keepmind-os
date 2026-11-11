import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import type { AgentExecution } from '../../../shared/types.js';
import { IconBolt } from '../common/icons.js';

interface AgentExecutionViewProps {
  agentId: string;
}

interface LiveExecution {
  executionId: string;
  text: string;
  tools: Array<{ name: string; result?: string; error?: string }>;
  done: boolean;
}

export default function AgentExecutionView({ agentId }: AgentExecutionViewProps) {
  const { executions, loading, error, fetchExecutions, cancelExecution } = useAgentStore();
  const [live, setLive] = useState<LiveExecution | null>(null);

  useEffect(() => {
    fetchExecutions(agentId);
    const interval = setInterval(() => fetchExecutions(agentId), 3000);
    const unsubscribe = window.electronAPI.onAgentEvent((event) => {
      setLive((prev) => {
        const base = prev && prev.executionId === event.executionId
          ? prev
          : { executionId: event.executionId, text: '', tools: [], done: false };
        if (event.type === 'chunk' && typeof event.data === 'string') {
          return { ...base, text: base.text + event.data };
        }
        if (event.type === 'tool_call') {
          const name = (event.data as { name?: string })?.name || 'tool';
          return { ...base, tools: [...base.tools, { name }] };
        }
        if (event.type === 'tool_result') {
          const d = event.data as { name?: string; result?: string; error?: string };
          const tools = [...base.tools];
          for (let i = tools.length - 1; i >= 0; i--) {
            if (tools[i].name === d?.name && tools[i].result === undefined && tools[i].error === undefined) {
              tools[i] = { ...tools[i], result: d.result, error: d.error };
              break;
            }
          }
          return { ...base, tools };
        }
        if (event.type === 'done' || event.type === 'error') {
          return { ...base, done: true };
        }
        return base;
      });
    });
    return () => { clearInterval(interval); unsubscribe(); };
  }, [agentId, fetchExecutions]);

  const handleCancel = async (executionId: string) => {
    await cancelExecution(executionId);
  };

  const agentExecutions = executions.filter(e => e.agentId === agentId);

  if (loading && agentExecutions.length === 0 && !live) {
    return <Text c="dimmed" ta="center" py="xl">Loading executions...</Text>;
  }

  if (error) {
    return <Text c="dimmed">Error: {error}</Text>;
  }

  if (agentExecutions.length === 0 && !live) {
    return (
      <Card withBorder padding="xl" radius="md">
        <Stack align="center" gap="sm">
          <IconBolt />
          <Text fw={500}>No executions yet</Text>
          <Text size="sm" c="dimmed">Execute this agent to see execution history</Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3} size="h5">Execution History</Title>
        <Button size="xs" variant="default" onClick={() => fetchExecutions(agentId)}>Refresh</Button>
      </Group>

      {live && !live.done && (
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Group gap="xs">
              <Badge size="sm" variant="light" color="gray">streaming</Badge>
            </Group>
            {live.tools.length > 0 && (
              <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                <Text size="xs" fw={600} mb={4}>Tool calls</Text>
                {live.tools.map((t, i) => (
                  <Text key={i} size="xs" ff="monospace" c="dimmed">
                    → {t.name}
                    {t.result !== undefined && `\n   ${t.result.slice(0, 300)}`}
                    {t.error && `\n   error: ${t.error}`}
                  </Text>
                ))}
              </Card>
            )}
            {live.text && (
              <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{live.text}</Text>
              </Card>
            )}
          </Stack>
        </Card>
      )}

      {agentExecutions.map((execution) => (
        <Card key={execution.id} withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Badge size="sm" variant="light" color="gray">{execution.status}</Badge>
              <Text size="xs" c="dimmed">
                {execution.startedAt ? new Date(execution.startedAt).toLocaleString() : 'Not started'}
              </Text>
            </Group>

            {execution.status === 'running' && (
              <div style={{ height: 4, backgroundColor: 'var(--mantine-color-gray-3)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${execution.progress}%`, backgroundColor: '#111', transition: 'width 0.3s ease' }} />
              </div>
            )}

            <div>
              <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={4}>Input</Text>
              <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(execution.input, null, 2)}
                </Text>
              </Card>
            </div>

            {execution.output && (
              <div>
                <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={4}>Output</Text>
                <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)', maxHeight: 200, overflow: 'auto' }}>
                  <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {typeof execution.output === 'string'
                      ? execution.output
                      : JSON.stringify(execution.output, null, 2)}
                  </Text>
                </Card>
              </div>
            )}

            {execution.error && (
              <div>
                <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={4}>Error</Text>
                <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                  <Text size="xs" ff="monospace">{execution.error}</Text>
                </Card>
              </div>
            )}

            {execution.status === 'running' && (
              <Group justify="flex-end">
                <Button size="compact-xs" variant="default" onClick={() => handleCancel(execution.id)}>Cancel</Button>
              </Group>
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
