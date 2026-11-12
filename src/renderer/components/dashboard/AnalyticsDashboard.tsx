import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Progress, Select, Stack, Text, Textarea, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import { sfxStart } from '../../lib/sfx';
import { useTeamStore } from '../../store/teamStore';
import { useLang } from '../../lib/i18n';
import BotAvatar from '../common/BotAvatar';
import PixelSpinner from '../common/PixelSpinner';
import { avatarForAgent } from '../../../shared/avatars';
import type { AgentExecution } from '../../../shared/types.js';

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
  const { agents, fetchAgents, executeAgent } = useAgentStore();
  const { teams, fetchTeams } = useTeamStore();
  const [executions, setExecutions] = useState(0);
  const [runningExecs, setRunningExecs] = useState<AgentExecution[]>([]);
  const [now, setNow] = useState(Date.now());
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [providerConnected, setProviderConnected] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [secondBrain, setSecondBrain] = useState<{ enabled: boolean; hasToken: boolean } | null>(null);
  const [monthlySpend, setMonthlySpend] = useState<Array<{ agentId: string; agentName: string; costUsd: number; calls: number; monthlyBudgetUsd?: number }>>([]);
  const [askAgentId, setAskAgentId] = useState<string | null>(null);
  const [askText, setAskText] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [tipDismissed, setTipDismissed] = useState(() => {
    try { return localStorage.getItem('km.tipDismissed') === new Date().toDateString(); } catch { return false; }
  });

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
        setRunningExecs(execs.filter((e) => e.status === 'running'));
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
    // Presence strip: refresh running executions + elapsed clock every 5s.
    const poll = setInterval(async () => {
      try {
        const execs = await window.electronAPI.getAgentExecutions();
        setRunningExecs(execs.filter((e) => e.status === 'running'));
        setNow(Date.now());
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(poll);
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

  const handleAsk = async () => {
    if (!askAgentId || !askText.trim() || asking) return;
    setAsking(true);
    setAskError('');
    try {
      // Plain text becomes {message}; valid JSON is sent as-is.
      let input: Record<string, unknown>;
      try {
        const parsed = JSON.parse(askText);
        input = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { message: askText };
      } catch {
        input = { message: askText };
      }
      await executeAgent(askAgentId, input);
      sfxStart();
      setAskText('');
      // Refresh presence strip immediately.
      try {
        const execs = await window.electronAPI.getAgentExecutions();
        setRunningExecs(execs.filter((e) => e.status === 'running'));
      } catch { /* next poll catches it */ }
    } catch (err) {
      setAskError(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  };

  // One tip per day, deterministic rotation.
  const tipIndex = Math.floor(Date.now() / 86400000) % 8;
  const dismissTip = () => {
    setTipDismissed(true);
    try { localStorage.setItem('km.tipDismissed', new Date().toDateString()); } catch { /* ignore */ }
  };

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

      {agents.length > 0 && (
        <Card withBorder padding="lg" radius="md">
          <Stack gap="sm">
            <Text fw={600} size="sm">{t('dash2.askAgent')}</Text>
            <Group align="flex-end" gap="sm" wrap="nowrap">
              <Select
                style={{ width: 220, flexShrink: 0 }}
                placeholder={t('dash2.pickAgent')}
                data={agents.map((a) => ({ value: a.id, label: a.name }))}
                value={askAgentId}
                onChange={setAskAgentId}
                searchable
              />
              <Textarea
                style={{ flex: 1 }}
                placeholder={t('dash2.askAgentPh')}
                minRows={1}
                autosize
                maxRows={4}
                value={askText}
                onChange={(e) => setAskText(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleAsk(); }}
              />
              <Button onClick={() => void handleAsk()} loading={asking} disabled={!askAgentId || !askText.trim()}>
                {t('dash2.askAgentBtn')}
              </Button>
            </Group>
            {askError && <Text size="xs" c="red">{askError}</Text>}
            <Text size="xs" c="dimmed">{t('dash2.askAgentHint')}</Text>
          </Stack>
        </Card>
      )}

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

      {runningExecs.length > 0 && (
        <Card withBorder padding="md" radius="md" className="km-enter">
          <Stack gap="xs">
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">{t('dash2.workingNow')}</Text>
            {runningExecs.map((exec) => {
              const agent = agents.find((a) => a.id === exec.agentId);
              const elapsed = exec.startedAt ? Math.max(0, Math.floor((now - new Date(exec.startedAt).getTime()) / 1000)) : 0;
              const mm = Math.floor(elapsed / 60);
              const ss = String(elapsed % 60).padStart(2, '0');
              return (
                <Group key={exec.id} gap="sm" wrap="nowrap">
                  {agent ? <BotAvatar definition={avatarForAgent(agent)} mood="thinking" size={28} /> : <PixelSpinner size={16} />}
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} lineClamp={1}>{agent?.name ?? t('dash2.unknownAgent')}</Text>
                    <Text size="xs" c="dimmed">{mm > 0 ? `${mm}m ${ss}s` : `${ss}s`} · {exec.progress}%</Text>
                  </div>
                </Group>
              );
            })}
          </Stack>
        </Card>
      )}

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

      {!tipDismissed && (
        <Card withBorder padding="md" radius="md" style={{ borderStyle: 'dashed' }}>
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <span
                aria-hidden="true"
                style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                  border: '1.5px solid #111', color: '#111',
                  fontSize: 13, fontWeight: 700, lineHeight: '21px', textAlign: 'center',
                }}
              >
                i
              </span>
              <div>
                <Text size="xs" fw={600} tt="uppercase" c="dimmed">{t('dash2.tip')}</Text>
                <Text size="sm">{t(`dash2.tips.${tipIndex}`)}</Text>
              </div>
            </Group>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={dismissTip}>
              {t('dash2.tip.dismiss')}
            </Button>
          </Group>
        </Card>
      )}
    </Stack>
  );
}
