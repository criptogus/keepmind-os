import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, Group, NumberInput, Select, Slider, Stack, Tabs, Text, Textarea, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import { useModelOptions } from '../../lib/useModelOptions';
import AgentExecutionView from './AgentExecutionView';
import type { AgentConfig, Skill } from '../../../shared/types.js';
import { useLang } from '../../lib/i18n';
import { AVATAR_PRESETS, avatarForAgent, avatarJson, parseAvatarDefinition, presetAvatarFor } from '../../../shared/avatars';
import BotAvatar from '../common/BotAvatar';
import AgentSelect from '../common/AgentSelect';
import { sfxStart } from '../../lib/sfx';

interface AgentEditorProps {
  agentId: string;
  onClose: () => void;
}

export default function AgentEditor({ agentId, onClose }: AgentEditorProps) {
  const { t, lang } = useLang();
  const { selectedAgent, loading, error, updateAgent, deleteAgent, executeAgent, simulateAgent, selectAgent, agents } = useAgentStore();
  const [activeTab, setActiveTab] = useState<string | null>('config');
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [avatarSel, setAvatarSel] = useState('auto');
  const [managerId, setManagerId] = useState<string | null>(null);
  const [executionInput, setExecutionInput] = useState('{}');
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const { groups: modelGroups } = useModelOptions();

  useEffect(() => {
    selectAgent(agentId);
    window.electronAPI.getSkills().then(setAvailableSkills).catch(() => {});
  }, [agentId, selectAgent]);

  useEffect(() => {
    if (selectedAgent) {
      setConfig(selectedAgent.config);
      // Match the stored avatar JSON against presets; unknown/custom → 'auto' preview of stored def.
      const stored = parseAvatarDefinition(selectedAgent.avatar);
      const match = stored ? AVATAR_PRESETS.find((p) => JSON.stringify(p) === JSON.stringify(stored)) : undefined;
      setAvatarSel(match?.id ?? (stored ? '__custom' : 'auto'));
      setManagerId(selectedAgent.managerId ?? null);
    }
  }, [selectedAgent]);

  const handleSave = async () => {
    if (!config) return;
    try {
      const avatar =
        avatarSel === 'auto' ? null
        : avatarSel === '__custom' ? selectedAgent?.avatar ?? null
        : avatarJson(AVATAR_PRESETS.find((p) => p.id === avatarSel) ?? avatarForAgent(selectedAgent!));
      await updateAgent(agentId, { ...config, avatar, managerId });
    } catch (err) {
      console.error('Failed to update agent:', err);
    }
  };

  const handleDelete = async () => {
    if (confirm(t('agents.deleteConfirm'))) {
      await deleteAgent(agentId);
      onClose();
    }
  };

  const handleExecute = async (dryRun = false) => {
    try {
      const input = JSON.parse(executionInput);
      if (dryRun) {
        await simulateAgent(agentId, input);
      } else {
        await executeAgent(agentId, input);
        sfxStart();
      }
      setActiveTab('executions');
    } catch (err) {
      alert(t('ae.invalidJson'));
    }
  };

  const toggleSkill = (id: string) => {
    if (!config) return;
    const current = config.skillIds || [];
    setConfig({
      ...config,
      skillIds: current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    });
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">{t('ae.loading')}</Text>;
  }

  if (!selectedAgent || !config) {
    return <Text c="dimmed" ta="center" py="xl">{t('ae.notFound')}</Text>;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3} size="h5">{t('agents.edit')}: {selectedAgent.name}</Title>
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={onClose}>{t('common.back')}</Button>
          <Button variant="default" size="xs" onClick={handleDelete}>{t('common.delete')}</Button>
          <Button size="xs" onClick={handleSave}>{t('common.save')}</Button>
        </Group>
      </Group>

      {error && <Text size="sm" c="dimmed">{error}</Text>}

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="config">{t('ae.tabConfig')}</Tabs.Tab>
          <Tabs.Tab value="executions">{t('ae.tabExecutions')}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="config" pt="md">
          <Stack gap="md">
            <Select
              label={t('af.model')}
              data={modelGroups}
              value={config.model}
              onChange={(v) => setConfig({ ...config, model: v || config.model })}
              allowDeselect={false}
              searchable
            />

            <Group gap="sm" align="flex-end" wrap="nowrap">
              <Select
                style={{ flex: 1 }}
                label={t('af.avatar')}
                description={t('af.avatarDesc')}
                data={[
                  { value: 'auto', label: t('af.avatarAuto') },
                  ...(avatarSel === '__custom' ? [{ value: '__custom', label: `${t('af.avatar')} (custom)` }] : []),
                  ...AVATAR_PRESETS.map((p) => ({ value: p.id, label: p.name })),
                ]}
                value={avatarSel}
                onChange={(v) => setAvatarSel(v || 'auto')}
                allowDeselect={false}
              />
              <BotAvatar
                definition={
                  avatarSel === 'auto' ? presetAvatarFor(selectedAgent.id)
                  : avatarSel === '__custom' ? avatarForAgent(selectedAgent)
                  : (AVATAR_PRESETS.find((p) => p.id === avatarSel) ?? avatarForAgent(selectedAgent))
                }
                size={44}
              />
            </Group>

            <AgentSelect
              label={t('af.manager')}
              description={t('af.managerDesc')}
              placeholder={t('af.managerNone')}
              clearable
              agents={agents.filter((a) => a.id !== agentId)}
              value={managerId}
              onChange={setManagerId}
              searchable
            />

            <Textarea
              label={t('af.systemPrompt')}
              minRows={5}
              value={config.systemPrompt}
              onChange={(e) => setConfig({ ...config, systemPrompt: e.currentTarget.value })}
            />

            <div>
              <Text size="sm" fw={500}>{t('af.temperature')}: {config.temperature}</Text>
              <Slider
                min={0}
                max={2}
                step={0.1}
                value={config.temperature}
                onChange={(v) => setConfig({ ...config, temperature: v })}
                mb="xs"
              />
            </div>

            <div>
              <Text size="sm" fw={500}>{t('af.maxTokens')}: {config.maxTokens}</Text>
              <Slider
                min={256}
                max={4096}
                step={256}
                value={config.maxTokens}
                onChange={(v) => setConfig({ ...config, maxTokens: v })}
                mb="xs"
              />
            </div>

            <NumberInput
              label={t('af.monthlyBudget')}
              description={t('af.monthlyBudgetDesc')}
              placeholder={t('af.monthlyBudgetPh')}
              min={0}
              step={5}
              prefix="$"
              value={config.monthlyBudgetUsd ?? ''}
              onChange={(v) => setConfig({ ...config, monthlyBudgetUsd: v === '' ? undefined : Number(v) })}
            />

            <NumberInput label={lang === 'pt' ? 'Máximo de pedidos por mês' : 'Maximum requests per month'} min={1} max={100000} value={config.monthlyRunCap ?? 1000} onChange={v => setConfig({ ...config, monthlyRunCap: v === '' ? undefined : Number(v) })} />
            <NumberInput label={lang === 'pt' ? 'Tempo máximo por pedido (segundos)' : 'Request timeout (seconds)'} min={1} max={3600} value={config.executionTimeoutSeconds ?? 300} onChange={v => setConfig({ ...config, executionTimeoutSeconds: Number(v) })} />

            {availableSkills.length > 0 && (
              <div>
                <Text size="sm" fw={500} mb={4}>{t('nav.skills')}</Text>
                <Stack gap={4}>
                  {availableSkills.map((skill) => (
                    <Checkbox
                      key={skill.id}
                      size="sm"
                      label={
                        <Text size="sm">
                          <Text span fw={600}>{skill.name}</Text>
                          {skill.description ? ` — ${skill.description}` : ''}
                          {skill.toolNames.length > 0 ? ` (${skill.toolNames.length} ${t('agents.tools')})` : ''}
                        </Text>
                      }
                      checked={(config.skillIds || []).includes(skill.id)}
                      onChange={() => toggleSkill(skill.id)}
                    />
                  ))}
                </Stack>
              </div>
            )}

            <Card withBorder padding="md" radius="md">
              <Stack gap="sm">
                <Text size="sm" fw={600}>{t('ae.quickExecute')}</Text>
                <Textarea
                  placeholder='{"message": "Hello"}'
                  minRows={4}
                  ff="monospace"
                  size="sm"
                  value={executionInput}
                  onChange={(e) => setExecutionInput(e.currentTarget.value)}
                />
                <Group justify="flex-end" gap="xs">
                  <Button size="xs" variant="default" onClick={() => handleExecute(true)} title={t('agents.simulateHint')}>
                    {t('agents.simulate')}
                  </Button>
                  <Button size="xs" onClick={() => handleExecute(false)}>{t('agents.run')}</Button>
                </Group>
              </Stack>
            </Card>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="executions" pt="md">
          <AgentExecutionView agentId={agentId} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
