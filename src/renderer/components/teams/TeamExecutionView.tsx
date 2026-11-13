import React, { useState } from 'react';
import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useTeamStore } from '../../store/teamStore';
import type { Team } from '../../../shared/types.js';
import { useLang } from '../../lib/i18n';

interface TeamExecutionViewProps {
  team: Team;
}

export default function TeamExecutionView({ team }: TeamExecutionViewProps) {
  const { t } = useLang();
  const { executeTeam, loading, error } = useTeamStore();
  const [input, setInput] = useState('{}');
  const [result, setResult] = useState<{
    teamId: string;
    status: 'completed' | 'failed' | 'partial';
    results: Array<{
      agentId: string;
      agentName: string;
      status: 'completed' | 'failed';
      output?: Record<string, unknown>;
      error?: string;
    }>;
    duration: number;
  } | null>(null);

  const handleExecute = async () => {
    try {
      const parsedInput = JSON.parse(input);
      const executionResult = await executeTeam(team.id, parsedInput);
      setResult(executionResult);
    } catch (err) {
      alert(t('ae.invalidJson'));
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3} size="h5">{t('tex.executeTeam')}: {team.name}</Title>
        <Button size="xs" onClick={handleExecute} loading={loading}>{t('tex.executeTeam')}</Button>
      </Group>

      {error && <Text size="sm" c="dimmed">{error}</Text>}

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text size="sm" fw={600}>{t('tex.input')}</Text>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"message": "Hello team"}'
            style={{
              width: '100%',
              minHeight: 120,
              padding: 12,
              borderRadius: 6,
              border: '1px solid var(--mantine-color-gray-4)',
              fontSize: 13,
              fontFamily: 'monospace',
              resize: 'vertical',
              backgroundColor: '#fff',
              color: 'var(--mantine-color-dark-8)',
            }}
          />
        </Stack>
      </Card>

      {result && (
        <>
          <Stack gap="sm">
            {result.results.map((r, index) => (
              <Card key={index} withBorder padding="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>{r.agentName}</Text>
                    <Text size="xs" c="dimmed">{r.status}</Text>
                  </Group>
                  {r.output && (
                    <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-default-hover)' }}>
                      <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {JSON.stringify(r.output, null, 2)}
                      </Text>
                    </Card>
                  )}
                  {r.error && (
                    <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-default-hover)' }}>
                      <Text size="xs" ff="monospace">{r.error}</Text>
                    </Card>
                  )}
                </Stack>
              </Card>
            ))}
          </Stack>
          <Text size="sm" c="dimmed">
            {t('tex.duration')}: {result.duration}ms | {t('common.status')}: {result.status}
          </Text>
        </>
      )}
    </Stack>
  );
}
