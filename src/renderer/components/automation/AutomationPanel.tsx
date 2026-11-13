import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Group, MultiSelect, NumberInput, Select, Stack, Switch, Text,
  TextInput, Textarea, Title,
} from '@mantine/core';
import PageHeader from '../common/PageHeader';
import AgentSelect from '../common/AgentSelect';
import BotAvatar from '../common/BotAvatar';
import { avatarForAgent } from '../../../shared/avatars';
import { useLang } from '../../lib/i18n';
import type { Agent, AgentTrigger } from '../../../shared/types';

interface NewTrigger {
  autonomy: 'draft' | 'run';
  name: string;
  agentId: string;
  kind: 'interval' | 'daily' | 'webhook';
  intervalMinutes: number;
  timeOfDay: string;
  daysOfWeek: number[];
  prompt: string;
}

const EMPTY: NewTrigger = {
  name: '', agentId: '', kind: 'interval', intervalMinutes: 60, autonomy: 'run',
  timeOfDay: '09:00', daysOfWeek: [], prompt: '',
};

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAY_KEYS = ['wd.sun', 'wd.mon', 'wd.tue', 'wd.wed', 'wd.thu', 'wd.fri', 'wd.sat'];

interface AutomationPreset {
  id: string;
  nameKey: string;
  descKey: string;
  promptKey: string;
  kind: NewTrigger['kind'];
  intervalMinutes?: number;
  timeOfDay?: string;
  daysOfWeek?: number[];
}

const PRESETS: AutomationPreset[] = [
  {
    id: 'morning-briefing', nameKey: 'auto.preset.briefing.name', descKey: 'auto.preset.briefing.desc',
    promptKey: 'auto.preset.briefing.prompt', kind: 'daily', timeOfDay: '08:00',
  },
  {
    id: 'weekly-report', nameKey: 'auto.preset.weekly.name', descKey: 'auto.preset.weekly.desc',
    promptKey: 'auto.preset.weekly.prompt', kind: 'daily', timeOfDay: '09:00', daysOfWeek: [1],
  },
  {
    id: 'site-daily-log', nameKey: 'auto.preset.site.name', descKey: 'auto.preset.site.desc',
    promptKey: 'auto.preset.site.prompt', kind: 'daily', timeOfDay: '18:00',
  },
  {
    id: 'whatsapp-triage', nameKey: 'auto.preset.wa.name', descKey: 'auto.preset.wa.desc',
    promptKey: 'auto.preset.wa.prompt', kind: 'interval', intervalMinutes: 30,
  },
  {
    id: 'lead-followup', nameKey: 'auto.preset.leads.name', descKey: 'auto.preset.leads.desc',
    promptKey: 'auto.preset.leads.prompt', kind: 'daily', timeOfDay: '10:00', daysOfWeek: [1, 2, 3, 4, 5],
  },
];

function daysLabel(days: number[] | undefined, t: (k: string) => string): string {
  if (!days || days.length === 0 || days.length === 7) return '';
  const sorted = [...days].sort((a, b) => a - b);
  const abbrev = sorted.map((d) => t(WEEKDAY_KEYS[d])).join(',');
  return `${abbrev} `;
}

function scheduleText(tr: AgentTrigger, t: (k: string) => string): string {
  if (tr.kind === 'interval') {
    const m = tr.intervalMinutes ?? 60;
    if (m % 1440 === 0) return `${t('auto.everyDays')} ${m / 1440}d`;
    if (m % 60 === 0) return `${t('auto.everyHours')} ${m / 60}h`;
    return `${t('adv2.every')} ${m}min`;
  }
  if (tr.kind === 'daily') {
    return `${daysLabel(tr.daysOfWeek, t)}${t('adv2.dailyAt')} ${tr.timeOfDay || '09:00'}`;
  }
  return t('adv2.webhookTrigger');
}

/** Next fire time for a schedule, mirroring TriggerManager.isDue semantics. */
function nextRunAt(tr: AgentTrigger, now: Date): Date | null {
  if (tr.kind === 'webhook') return null;
  if (tr.kind === 'interval') {
    const minutes = tr.intervalMinutes ?? 60;
    const base = tr.lastRunAt ? new Date(tr.lastRunAt).getTime() : now.getTime();
    return new Date(base + minutes * 60_000);
  }
  const [h, m] = (tr.timeOfDay || '09:00').split(':').map(Number);
  const days = tr.daysOfWeek?.filter((d) => d >= 0 && d <= 6);
  for (let i = 0; i < 8; i++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + i);
    candidate.setHours(h || 0, m || 0, 0, 0);
    if (candidate <= now) continue;
    if (days && days.length > 0 && days.length < 7 && !days.includes(candidate.getDay())) continue;
    return candidate;
  }
  return null;
}

function formatNext(date: Date, t: (k: string) => string): string {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `${t('auto.today')} ${time}`;
  if (isTomorrow) return `${t('auto.tomorrow')} ${time}`;
  return date.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Automations: scheduled agent runs (interval / daily(+weekdays) / webhook).
 * Preset suggestions pre-fill the form; each card shows agent, schedule,
 * next run and last run in plain language.
 */
export default function AutomationPanel() {
  const { t, lang } = useLang();
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState<NewTrigger>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [pickedPreset, setPickedPreset] = useState<string | null>(null);

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
  const weekdayOptions = useMemo(
    () => WEEKDAYS.map((d) => ({ value: String(d), label: t(WEEKDAY_KEYS[d]) })),
    [t]
  );

  const applyPreset = (p: AutomationPreset) => {
    setPickedPreset(p.id);
    setForm({
      ...EMPTY,
      name: t(p.nameKey),
      prompt: t(p.promptKey),
      kind: p.kind,
      intervalMinutes: p.intervalMinutes ?? 60,
      timeOfDay: p.timeOfDay ?? '09:00',
      daysOfWeek: p.daysOfWeek ?? [],
    });
  };

  const create = async () => {
    setCreating(true);
    try {
      await window.electronAPI.triggersCreate({
        agentId: form.agentId,
        name: form.name.trim(),
        kind: form.kind,
        intervalMinutes: form.kind === 'interval' ? form.intervalMinutes : undefined,
        timeOfDay: form.kind === 'daily' ? form.timeOfDay : undefined,
        daysOfWeek: form.kind === 'daily' && form.daysOfWeek.length > 0 && form.daysOfWeek.length < 7
          ? form.daysOfWeek
          : undefined,
        prompt: form.prompt.trim(),
        autonomy: form.autonomy,
        enabled: true,
      });
      setForm(EMPTY);
      setPickedPreset(null);
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

      {agents.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Text size="sm" c="dimmed" ta="center">{t('auto.needAgent')}</Text>
        </Card>
      ) : (
        <>
          <div>
            <Text size="sm" fw={600} mb={4}>{t('auto.suggestTitle')}</Text>
            <Text size="xs" c="dimmed" mb="sm">{t('auto.suggestHelp')}</Text>
            <Group gap="xs" wrap="wrap">
              {PRESETS.map((p) => (
                <Button
                  key={p.id}
                  size="compact-sm"
                  variant={pickedPreset === p.id ? 'filled' : 'light'}
                  onClick={() => applyPreset(p)}
                >
                  {t(p.nameKey)}
                </Button>
              ))}
            </Group>
          </div>

          {triggers.length === 0 ? (
            <Card withBorder padding="xl" radius="md">
              <Text size="sm" c="dimmed" ta="center">{t('auto.empty')}</Text>
            </Card>
          ) : (
            <Stack gap="sm">
              {triggers.map((tr) => {
                const agent = agentById.get(tr.agentId);
                const next = tr.enabled ? nextRunAt(tr, new Date()) : null;
                return (
                  <Card key={tr.id} withBorder padding="md" radius="md" className="km-enter">
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                        {agent && <BotAvatar definition={avatarForAgent(agent)} name={agent.name} size={36} mood={tr.enabled ? 'idle' : 'idle'} />}
                        <div style={{ minWidth: 0 }}>
                          <Text size="sm" fw={600}>{tr.name}</Text>
                          <Text size="xs" c="dimmed">
                            {agent ? agent.name : '—'} · {scheduleText(tr, t)}
                            {tr.kind !== 'webhook' && tr.enabled && next && ` · ${t('auto.nextRun')} ${formatNext(next, t)}`}
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
        </>
      )}

      {agents.length > 0 && (
        <Card withBorder padding="md" radius="md">
          <Title order={3} size="h5" mb="md">{pickedPreset ? t('auto.configure') : t('auto.new')}</Title>
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
            <Select label={lang === 'pt' ? 'Autonomia' : 'Autonomy'} value={form.autonomy} onChange={v => setForm({ ...form, autonomy: v === 'run' ? 'run' : 'draft' })} data={[{value:'draft',label:lang === 'pt' ? 'Criar tarefa para eu iniciar' : 'Create a task for me to start'},{value:'run',label:lang === 'pt' ? 'Executar e entregar automaticamente' : 'Run and deliver automatically'}]} />
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
                <Group gap={4}>
                  {[30, 60, 240, 720, 1440].map((m) => (
                    <Button
                      key={m}
                      size="compact-xs"
                      variant={form.intervalMinutes === m ? 'filled' : 'light'}
                      onClick={() => setForm({ ...form, intervalMinutes: m })}
                    >
                      {m < 60 ? `${m}min` : m < 1440 ? `${m / 60}h` : `${m / 1440}d`}
                    </Button>
                  ))}
                  <NumberInput
                    size="sm"
                    min={1}
                    max={10080}
                    value={form.intervalMinutes}
                    onChange={(v) => setForm({ ...form, intervalMinutes: Number(v) || 60 })}
                    style={{ width: 90 }}
                    aria-label={t('auto.customMin')}
                  />
                </Group>
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
            {form.kind === 'daily' && (
              <MultiSelect
                size="sm"
                placeholder={t('auto.daysPh')}
                data={weekdayOptions}
                value={form.daysOfWeek.map(String)}
                onChange={(vals) => setForm({ ...form, daysOfWeek: vals.map(Number).sort((a, b) => a - b) })}
                clearable
              />
            )}
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
      )}
    </Stack>
  );
}

