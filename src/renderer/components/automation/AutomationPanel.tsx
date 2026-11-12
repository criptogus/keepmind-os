import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Group, NumberInput, Select, Stack, Switch, Text, TextInput,
  Textarea, Title,
} from '@mantine/core';
import PageHeader from '../common/PageHeader';
import AgentSelect from '../common/AgentSelect';
import BotAvatar from '../common/BotAvatar';
import { avatarForAgent } from '../../../shared/avatars';
import { useLang } from '../../lib/i18n';
import type { Agent, AgentTrigger } from '../../../shared/types';

interface NewTrigger {
  name: string;
  agentId: string;
  kind: 'interval' | 'daily' | 'webhook';
  intervalMinutes: number;
  timeOfDay: string;
  prompt: string;
}

const EMPTY: NewTrigger = { name: '', agentId: '', kind: 'interval', intervalMinutes: 60, timeOfDay: '09:00', prompt: '' };

function scheduleText(tr: AgentTrigger, t: (k: string) => string): string {
  if (tr.kind === 'interval') return `${t('adv2.every')} ${tr.intervalMinutes}min`;
  if (tr.kind === 'daily') return `${t('adv2.dailyAt')} ${tr.timeOfDay}`;
  return t('adv2.webhookTrigger');
}

/**
 * Automations: scheduled agent runs (interval / daily / webhook).
 * Each card shows which agent runs, when, and what it was asked to do.
 */
export default function AutomationPanel() {
  const { t } = useLang();
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState<NewTrigger>(EMPTY);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    const [tr, ag] = await Promise.all([
      window.electronAPI.triggersList().catch(() => [] as AgentTrigger[]),
      window.electronAPI.getAgents().catch(() => [] as Agent[]),
    ]);
    setTriggers(tr);
    setAgents(ag);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const agentById = new Map(agents.map((a) => [a.id, a]));

  const create = async () => {
    setCreating(true);
    try {
      await window.electronAPI.triggersCreate({
        agentId: form.agentId,
        name: form.name.trim(),
        kind: form.kind,
        intervalMinutes: form.kind === 'interval' ? form.intervalMinutes : undefined,
        timeOfDay: form.kind === 'daily' ? form.timeOfDay : undefined,
        prompt: form.prompt.trim(),
        enabled: true,
      });
      setForm(EMPTY);
      await reload();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Stack gap="lg">
      <PageHeader
        title={t('auto.title')}
        subtitle={t('auto.subtitle')}
        help={t('auto.help')}
      />

      {triggers.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Text size="sm" c="dimmed" ta="center">{t('auto.empty')}</Text>
        </Card>
      ) : (
        <Stack gap="sm">
          {triggers.map((tr) => {
            const agent = agentById.get(tr.agentId);
            return (
              <Card key={tr.id} withBorder padding="md" radius="md" className="km-enter">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                    {agent && <BotAvatar definition={avatarForAgent(agent)} size={36} mood={tr.enabled ? 'idle' : 'idle'} />}
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600}>{tr.name}</Text>
                      <Text size="xs" c="dimmed">
                        {agent ? agent.name : '—'} · {scheduleText(tr, t)}
                        {tr.lastRunAt ? ` · ${t('adv2.lastRun')} ${new Date(tr.lastRunAt).toLocaleString()}` : ''}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={2} mt={2}>{tr.prompt}</Text>
                      {tr.kind === 'webhook' && tr.webhookToken && (
                        <Text size="xs" ff="monospace" c="dimmed" style={{ wordBreak: 'break-all' }}>
                          POST http://127.0.0.1:47821/webhook/{tr.webhookToken}
                        </Text>
                      )}
                    </div>
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    <Switch
                      size="sm"
                      checked={tr.enabled}
                      onChange={(e) => {
                        void window.electronAPI.triggersUpdate(tr.id, { enabled: e.currentTarget.checked }).then(reload);
                      }}
                    />
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="gray"
                      onClick={async () => {
                        await window.electronAPI.triggersDelete(tr.id);
                        await reload();
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                  </Group>
                </Group>
              </Card>
            );
          })}
        </Stack>
      )}

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">{t('auto.new')}</Title>
        <Stack gap="xs">
          <TextInput
            size="sm"
            placeholder={t('auto.namePh')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <AgentSelect
            size="sm"
            placeholder={t('common.agent')}
            agents={agents}
            value={form.agentId || null}
            onChange={(v) => setForm({ ...form, agentId: v || '' })}
            searchable
          />
          <Group gap="xs" align="flex-end">
            <Select
              size="sm"
              value={form.kind}
              onChange={(v) => setForm({ ...form, kind: (v || 'interval') as NewTrigger['kind'] })}
              data={[
                { value: 'interval', label: t('adv2.triggerKind.interval') },
                { value: 'daily', label: t('adv2.triggerKind.daily') },
                { value: 'webhook', label: t('adv2.triggerKind.webhook') },
              ]}
              allowDeselect={false}
              style={{ width: 170 }}
            />
            {form.kind === 'interval' && (
              <NumberInput
                size="sm"
                min={1}
                max={10080}
                value={form.intervalMinutes}
                onChange={(v) => setForm({ ...form, intervalMinutes: Number(v) || 60 })}
                style={{ width: 120 }}
              />
            )}
            {form.kind === 'daily' && (
              <TextInput
                size="sm"
                type="time"
                value={form.timeOfDay}
                onChange={(e) => setForm({ ...form, timeOfDay: e.currentTarget.value })}
                style={{ width: 120 }}
              />
            )}
          </Group>
          <Textarea
            size="sm"
            placeholder={t('adv2.taskPromptPh')}
            minRows={2}
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.currentTarget.value })}
          />
          <Group justify="flex-end">
            <Button
              size="sm"
              loading={creating}
              disabled={!form.name.trim() || !form.agentId || !form.prompt.trim()}
              onClick={() => void create()}
            >
              {t('adv2.addTrigger')}
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
