import { skillLabel } from '../../lib/skillLanguage';
import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Group, NumberInput, Select, Slider, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import { useModelOptions } from '../../lib/useModelOptions';
import type { AgentTemplate } from '../../lib/agentTemplates';
import { DEFAULT_MODEL } from '../../../shared/models.js';
import type { Agent, AgentConfig, Skill, ToolConfig } from '../../../shared/types.js';
import { AVATAR_PRESETS, avatarJson, presetAvatarFor } from '../../../shared/avatars';
import BotAvatar from '../common/BotAvatar';
import AgentSelect from '../common/AgentSelect';
import { useLang } from '../../lib/i18n';

interface ToolInfo {
  name: string;
  description: string;
}

const toToolConfig = (name: string): ToolConfig => ({ name, type: 'custom', config: {} });

interface AgentFormProps {
  onClose: () => void;
  template?: AgentTemplate | null;
  /** Called with the created agent (e.g. to add it to a workflow step). */
  onCreated?: (agent: Agent) => void;
}

export default function AgentForm({ onClose, template, onCreated }: AgentFormProps) {
  const { t, lang } = useLang();
  const { createAgent, loading, error, agents } = useAgentStore();
  const { groups: modelGroups } = useModelOptions();
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [config, setConfig] = useState<AgentConfig>(() => {
    const base = template?.config ?? {
      model: DEFAULT_MODEL.openai,
      temperature: 0.7,
      maxTokens: 2048,
      systemPrompt: '',
      tools: [],
      skillIds: [],
    };
    return {
      ...base,
      model: base.model || DEFAULT_MODEL.openai,
      skillIds: [],
      tools: template?.toolNames?.length ? template.toolNames.map(toToolConfig) : base.tools || [],
    };
  });
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [registryTools, setRegistryTools] = useState<ToolInfo[]>([]);
  const [avatarId, setAvatarId] = useState('auto');
  const [budgetUsd, setBudgetUsd] = useState<number | string>('');
  const [managerId, setManagerId] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.listSkillTools?.().then(setRegistryTools).catch(() => {});
    window.electronAPI.getSkills()
      .then((skills) => {
        setAvailableSkills(skills);
        // Pre-assign template skills by name (ids are generated).
        if (template?.skillNames?.length) {
          const ids = skills
            .filter((s) => template.skillNames.includes(s.name))
            .map((s) => s.id);
          if (ids.length) setConfig((c) => ({ ...c, skillIds: ids }));
        }
      })
      .catch(() => {});
  }, [template]);

  const toggleSkill = (id: string) => {
    const current = config.skillIds || [];
    setConfig({
      ...config,
      skillIds: current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    });
  };

  const hasTool = (name: string) => (config.tools || []).some((t) => t.name === name);

  const toggleTool = (name: string) => {
    const current = config.tools || [];
    setConfig({
      ...config,
      tools: hasTool(name) ? current.filter((t) => t.name !== name) : [...current, toToolConfig(name)],
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const agent = await createAgent({
        ...config,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        capabilities: template?.capabilities,
        avatar: avatarId === 'auto' ? undefined : avatarJson(AVATAR_PRESETS.find((p) => p.id === avatarId) ?? presetAvatarFor(name || 'agent')),
        monthlyBudgetUsd: budgetUsd === '' ? undefined : Number(budgetUsd),
        managerId: managerId || undefined,
      });
      onCreated?.(agent);
      onClose();
    } catch (err) {
      console.error('Failed to create agent:', err);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="md">
        <Title order={3} size="h5">{template ? `${t('common.create')}: ${template.role}` : t('af.newTitle')}</Title>
        {template && (
          <Text size="sm" c="dimmed">{template.tagline}</Text>
        )}

        <TextInput
          label={t('common.name')}
          placeholder={t('af.namePh')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />

        <TextInput
          label={t('common.description')}
          placeholder={t('af.descPh')}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />

        <Select
          label={t('af.model')}
          data={modelGroups}
          value={config.model}
          onChange={(v) => setConfig({ ...config, model: v || DEFAULT_MODEL.openai })}
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
              ...AVATAR_PRESETS.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={avatarId}
            onChange={(v) => setAvatarId(v || 'auto')}
            allowDeselect={false}
          />
          <BotAvatar
            definition={avatarId === 'auto' ? presetAvatarFor(name || 'agent') : (AVATAR_PRESETS.find((p) => p.id === avatarId) ?? presetAvatarFor('agent'))}
            size={44}
          />
        </Group>

        <NumberInput
          label={t('af.monthlyBudget')}
          description={t('af.monthlyBudgetDesc')}
          placeholder={t('af.monthlyBudgetPh')}
          min={0}
          step={5}
          prefix="$"
          value={budgetUsd}
          onChange={setBudgetUsd}
        />

        {agents.length > 0 && (
          <AgentSelect
            label={t('af.manager')}
            description={t('af.managerDesc')}
            placeholder={t('af.managerNone')}
            clearable
            agents={agents}
            value={managerId}
            onChange={setManagerId}
            searchable
          />
        )}

        <Textarea
          label={t('af.systemPrompt')}
          description={t('af.systemPromptDesc')}
          minRows={5}
          value={config.systemPrompt}
          onChange={(e) => setConfig({ ...config, systemPrompt: e.currentTarget.value })}
          placeholder={t('af.systemPromptPh')}
          required
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
          <Text size="xs" c="dimmed">{t('af.tempHint')}</Text>
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
          <Text size="xs" c="dimmed">{t('af.maxTokensHint')}</Text>
        </div>

        {registryTools.length > 0 && (
          <div>
            <Text size="sm" fw={500} mb={4}>{t('skills.toolsLabel')}</Text>
            <Text size="xs" c="dimmed" mb={8}>
              {t('af.toolsDesc')}
            </Text>
            <Stack gap={4}>
              {registryTools.map((t) => (
                <Checkbox
                  key={t.name}
                  size="sm"
                  label={
                    <Text size="sm">
                      <Text span ff="monospace" size="xs">{t.name}</Text>
                      {' — '}{t.description}
                    </Text>
                  }
                  checked={hasTool(t.name)}
                  onChange={() => toggleTool(t.name)}
                />
              ))}
            </Stack>
          </div>
        )}

        {availableSkills.length > 0 && (
          <div>
            <Text size="sm" fw={500} mb={4}>{t('nav.skills')}</Text>
            <Text size="xs" c="dimmed" mb={8}>
              {t('af.skillsDesc')}
            </Text>
            <Stack gap={4}>
              {availableSkills.map((skill) => (
                <Checkbox
                  key={skill.id}
                  size="sm"
                  label={
                    <Text size="sm">
                      <Text span fw={600}>{skillLabel(skill, lang).name}</Text>
                      {skill.description ? ` — ${skillLabel(skill, lang).description}` : ''}
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

        {error && <Text size="sm" c="dimmed">{error}</Text>}

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={loading}>{t('common.cancel')}</Button>
          <Button type="submit" loading={loading}>{loading ? t('af.creating') : t('agents.createAgent')}</Button>
        </Group>
      </Stack>
    </form>
  );
}
