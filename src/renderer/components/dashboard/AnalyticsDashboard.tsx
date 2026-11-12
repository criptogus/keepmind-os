import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Progress, Stack, Text, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import { useTeamStore } from '../../store/teamStore';
import { useLang } from '../../lib/i18n';

interface Props {
  onNavigate?: (section: string) => void;
}

interface ConnectionStatus {
  key: 'provider' | 'whatsapp' | 'brain';
  label: string;
  ok: boolean;
}

export default function AnalyticsDashboard({ onNavigate }: Props) {
  const { t } = useLang();
  const { agents, fetchAgents } = useAgentStore();
  const { teams, fetchTeams } = useTeamStore();
  const [executions, setExecutions] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [providerConnected, setProviderConnected] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [secondBrain, setSecondBrain] = useState<{ enabled: boolean; hasToken: boolean } | null>(null);
  const [monthlySpend, setMonthlySpend] = useState<Array<{ agentId: string; agentName: string; costUsd: number; calls: number; monthlyBudgetUsd?: number }>>([]);

  useEffect(() => {
    const load = async () => {
      await Promise.all([fetchAgents(), fetchTeams()]);
      try {
        const [openai, anthropic] = await Promise.all([
          window.electronAPI.oauthIsAuthenticated('openai'),
          window.electronAPI.oauthIsAuthenticated('anthropic'),
        ]);
        setProviderConnected(openai || anthropic);
      } catch { /* oauth status unavailable */ }
      try {
        const wa = await window.electronAPI.whatsappGetStatus();
        setWhatsappConnected(wa.status === 'connected');
      } catch { /* whatsapp status unavailable */ }
      try {
        const state = await window.electronAPI.getGovernanceState();
        setPendingApprovals(state.pendingApprovals.length);
      } catch { /* governance unavailable */ }
      try {
        const execs = await window.electronAPI.getAgentExecutions();
        setExecutions(execs.length);
      } catch { /* executions unavailable */ }
      try {
        const company = await window.electronAPI.getCompany();
        setCompanyName(company.name);
      } catch { /* company unavailable */ }
      try {
        const sb = await window.electronAPI.secondBrainGetConfig();
        setSecondBrain(sb);
      } catch { /* second brain unavailable */ }
      try {
        setMonthlySpend(await window.electronAPI.getMonthlySpend());
      } catch { /* usage ledger unavailable */ }
    };
    load();
  }, [fetchAgents, fetchTeams]);

  const checklist = [
    { label: t('dash.step.provider'), done: providerConnected, target: 'advanced' },
    { label: t('dash.step.agent'), done: agents.length > 0, target: 'agents' },
    { label: t('dash.step.team'), done: teams.length > 0, target: 'teams' },
    { label: t('dash.step.run'), done: executions > 0, target: 'agents' },
    { label: t('dash.step.brain'), done: !!secondBrain?.enabled && !!secondBrain?.hasToken, target: 'advanced' },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const progress = Math.round((doneCount / checklist.length) * 100);

  const recentAgents = [...agents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const stats = [
    { label: t('nav.agents'), value: agents.length },
    { label: t('nav.teams'), value: teams.length },
    { label: t('dash.executions'), value: executions },
    { label: t('dash.approvals'), value: pendingApprovals, warn: pendingApprovals > 0 },
  ];

  const connections: ConnectionStatus[] = [
    { key: 'provider', label: t('dash2.intProvider'), ok: providerConnected },
    { key: 'whatsapp', label: t('dash2.intWhatsapp'), ok: whatsappConnected },
    { key: 'brain', label: t('dash2.intBrain'), ok: !!secondBrain?.enabled && !!secondBrain?.hasToken },
  ];
  const allConnected = connections.every((c) => c.ok);

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={1}>{t('dash.title')}</Title>
          <Text c="dimmed" size="sm">
            {companyName ? `${companyName} — ` : ''}{t('dash.subtitle')}
          </Text>
        </div>
        <Group gap="sm">
          <Button variant="default" onClick={() => onNavigate?.('advanced')}>{t('dash.connectProvider')}</Button>
          <Button onClick={() => onNavigate?.('agents')}>{t('agents.new')}</Button>
        </Group>
      </Group>

      {pendingApprovals > 0 && (
        <Card withBorder padding="lg" radius="md" style={{ borderColor: 'var(--mantine-color-dark-4)' }}>
          <Group justify="space-between">
            <Group gap="sm">
              <Badge color="dark" variant="filled">{pendingApprovals}</Badge>
              <div>
                <Text fw={600}>{t('dash2.attention')}</Text>
                <Text size="sm" c="dimmed">
                  {pendingApprovals} {t('dash2.approvalsWaiting')}
                </Text>
              </div>
            </Group>
            <Button size="sm" onClick={() => onNavigate?.('governance')}>{t('dash2.reviewNow')}</Button>
          </Group>
        </Card>
      )}

      <Card withBorder padding="lg" radius="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600} size="sm">{t('dash2.integrations')}</Text>
          {allConnected && <Text size="xs" c="dimmed">{t('dash2.allGood')}</Text>}
        </Group>
        <Group gap="md" wrap="wrap">
          {connections.map((c) => (
            <Group key={c.key} gap={8} wrap="nowrap">
              <span
                style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: c.ok ? '#2f9e44' : 'var(--mantine-color-gray-5)',
                }}
              />
              <Text size="sm">{c.label}</Text>
              {!c.ok && (
                <Button size="compact-xs" variant="subtle" onClick={() => onNavigate?.('advanced')}>
                  {t('dash2.connect')}
                </Button>
              )}
            </Group>
          ))}
        </Group>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {stats.map((s) => (
          <Card key={s.label} withBorder padding="lg" radius="md">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">{s.label}</Text>
              <span style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>{s.value}</span>
            </Stack>
          </Card>
        ))}
      </div>

      {monthlySpend.length > 0 && (
        <Card withBorder padding="lg" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600} size="sm">{t('dash2.aiSpend')}</Text>
              <Text size="xs" c="dimmed">{t('dash2.aiSpendHint')}</Text>
            </Group>
            {monthlySpend.map((s) => {
              const pct = s.monthlyBudgetUsd && s.monthlyBudgetUsd > 0
                ? Math.min(100, Math.round((s.costUsd / s.monthlyBudgetUsd) * 100))
                : null;
              const over = pct !== null && pct >= 100;
              return (
                <div key={s.agentId}>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm">{s.agentName}</Text>
                    <Text size="xs" c={over ? 'red' : 'dimmed'}>
                      ${s.costUsd.toFixed(2)}{s.monthlyBudgetUsd ? ` / $${s.monthlyBudgetUsd.toFixed(2)}` : ''} · {s.calls} {t('dash2.calls')}
                    </Text>
                  </Group>
                  {pct !== null && <Progress value={pct} color={over ? 'red' : pct > 80 ? 'yellow' : 'dark'} size="sm" />}
                </div>
              );
            })}
          </Stack>
        </Card>
      )}

      <Card withBorder padding="lg" radius="md">
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={3}>{t('dash.gettingStarted')}</Title>
            <Badge color="dark" variant="light">
              {doneCount}/{checklist.length}
            </Badge>
          </Group>
          <Progress value={progress} />
          {checklist.map((item) => (
            <div
              key={item.label}
              onClick={() => !item.done && onNavigate?.(item.target)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 8,
                cursor: item.done ? 'default' : 'pointer',
              }}
              onMouseEnter={(e) => { if (!item.done) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--mantine-color-gray-1)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              <Badge size="sm" color={item.done ? 'dark' : 'gray'} variant="light">
                {item.done ? t('common.done') : t('dash.todo')}
              </Badge>
              <Text size="sm" c={item.done ? 'dimmed' : undefined}>{item.label}</Text>
            </div>
          ))}
        </Stack>
      </Card>

      <Stack gap="sm">
        <Title order={3}>{t('dash.recentAgents')}</Title>
        {recentAgents.length === 0 ? (
          <Card withBorder padding="xl" radius="md">
            <Stack align="center" gap="sm">
              <Text c="dimmed">{t('dash.noAgents')}</Text>
              <Text size="sm" c="dimmed">{t('dash.noAgentsHint')}</Text>
              <Button onClick={() => onNavigate?.('agents')}>{t('dash.firstAgent')}</Button>
            </Stack>
          </Card>
        ) : (
          recentAgents.map((agent) => (
            <div key={agent.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--mantine-color-gray-3)', backgroundColor: 'var(--mantine-color-body)' }}>
              <Text size="sm" fw={500}>{agent.name}</Text>
              <Group gap="sm">
                <Badge size="sm" color="gray" variant="light">{agent.config.model}</Badge>
                <Text size="xs" c="dimmed">{new Date(agent.createdAt).toLocaleDateString()}</Text>
              </Group>
            </div>
          ))
        )}
      </Stack>
    </Stack>
  );
}
