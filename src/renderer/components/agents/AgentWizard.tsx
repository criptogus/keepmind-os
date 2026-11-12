import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Group, Select, SimpleGrid, Stack, Stepper, Text, Textarea, TextInput, Title, UnstyledButton } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import BotAvatar from '../common/BotAvatar';
import { AVATAR_PRESETS, avatarJson, presetAvatarFor } from '../../../shared/avatars';
import { AGENT_TEMPLATES, type AgentTemplate } from '../../lib/agentTemplates';
import { describeTool } from '../../lib/plainLanguage';
import { useLang } from '../../lib/i18n';
import type { Agent, AgentConfig, Skill, ToolConfig } from '../../../shared/types.js';
import { DEFAULT_MODEL } from '../../../shared/models.js';

const toToolConfig = (name: string): ToolConfig => ({ name, type: 'custom', config: {} });

export const BLANK_TEMPLATE: AgentTemplate = {
  id: 'blank',
  name: '',
  group: '',
  role: '',
  tagline: '',
  description: '',
  capabilities: [],
  skillNames: [],
  toolNames: [],
  config: {
    model: DEFAULT_MODEL.openai,
    temperature: 0.7,
    maxTokens: 2048,
    systemPrompt: '',
    tools: [],
    skillIds: [],
  },
};

interface AgentWizardProps {
  onClose: () => void;
  /** Called with the created agent (e.g. to add it to a workflow step). */
  onCreated?: (agent: Agent) => void;
  /** Opens the full manual form for users who want control. */
  onAdvanced?: (template: AgentTemplate) => void;
}

/**
 * Three-step guided agent creation for non-technical users:
 * pick a role → name it (+ optional extra instructions) → review & create.
 * The heavy AgentForm remains available via "advanced mode".
 */
export default function AgentWizard({ onClose, onCreated, onAdvanced }: AgentWizardProps) {
  const { t, lang } = useLang();
  const { createAgent, loading, error } = useAgentStore();
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const [avatarId, setAvatarId] = useState('auto');
  const [name, setName] = useState('');
  const [extra, setExtra] = useState('');
  const [skillIds, setSkillIds] = useState<string[]>([]);

  useEffect(() => {
    if (!template?.skillNames?.length) { setSkillIds([]); return; }
    window.electronAPI.getSkills()
      .then((skills: Skill[]) => {
        setSkillIds(skills.filter((s) => template.skillNames.includes(s.name)).map((s) => s.id));
      })
      .catch(() => setSkillIds([]));
  }, [template]);

  const grouped = useMemo(() => {
    const acc: Record<string, AgentTemplate[]> = {};
    for (const tpl of AGENT_TEMPLATES) (acc[tpl.group] ||= []).push(tpl);
    return Object.entries(acc);
  }, []);

  const buildConfig = (): AgentConfig => {
    const base = template?.config ?? BLANK_TEMPLATE.config;
    const prompt = extra.trim()
      ? `${base.systemPrompt}\n\nAdditional instructions from the owner:\n${extra.trim()}`
      : base.systemPrompt;
    return {
      ...base,
      model: base.model || DEFAULT_MODEL.openai,
      systemPrompt: prompt,
      skillIds,
      tools: template?.toolNames?.length ? template.toolNames.map(toToolConfig) : base.tools || [],
    };
  };

  const canDo = useMemo(() => {
    if (!template) return [] as string[];
    const items = [...new Set(template.toolNames.map((n) => describeTool(n, lang === 'pt' ? 'pt' : 'en')))];
    for (const s of template.skillNames) items.push(s);
    return items;
  }, [template, lang]);

  const avatarDef = avatarId === 'auto'
    ? presetAvatarFor(`tpl:${template?.id ?? 'blank'}:${name || 'agent'}`)
    : (AVATAR_PRESETS.find((p) => p.id === avatarId) ?? presetAvatarFor('agent'));

  const handleCreate = async () => {
    try {
      const agent = await createAgent({
        ...buildConfig(),
        name: name.trim() || template?.name || undefined,
        description: template?.description || undefined,
        capabilities: template?.capabilities,
        avatar: avatarJson(avatarDef),
      });
      onCreated?.(agent);
      onClose();
    } catch (err) {
      console.error('Failed to create agent:', err);
    }
  };

  const pickTemplate = (tpl: AgentTemplate) => {
    setTemplate(tpl);
    setName(tpl.name);
    setStep(1);
  };

  return (
    <Stack gap="md">
      <div>
        <Title order={3} size="h5">{t('wiz.title')}</Title>
        <Text size="sm" c="dimmed">
          {step === 0 && t('wiz.step1hint')}
          {step === 1 && t('wiz.step2hint')}
          {step === 2 && template?.tagline}
        </Text>
      </div>

      <Stepper active={step} size="sm">
        <Stepper.Step label={t('wiz.step1')} />
        <Stepper.Step label={t('wiz.step2')} />
        <Stepper.Step label={t('wiz.step3')} />
      </Stepper>

      {step === 0 && (
        <Stack gap="md" style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: 4 }}>
          {grouped.map(([group, templates]) => (
            <div key={group}>
              <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={6}>{group}</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {templates.map((tpl) => (
                  <Card
                    key={tpl.id}
                    withBorder
                    padding="md"
                    radius="md"
                    style={{ cursor: 'pointer' }}
                    onClick={() => pickTemplate(tpl)}
                  >
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <BotAvatar definition={presetAvatarFor(`tpl:${tpl.id}`)} size={40} />
                      <Stack gap={4} style={{ minWidth: 0 }}>
                        <Text fw={600} size="sm">{tpl.name}</Text>
                        <Text size="xs" c="dimmed">{tpl.tagline}</Text>
                        {tpl.skillNames.length > 0 && (
                          <Text size="xs" c="dimmed">{t('nav.skills')}: {tpl.skillNames.join(', ')}</Text>
                        )}
                      </Stack>
                    </Group>
                  </Card>
                ))}
              </SimpleGrid>
            </div>
          ))}
          <Card
            withBorder
            padding="md"
            radius="md"
            style={{ cursor: 'pointer', borderStyle: 'dashed' }}
            onClick={() => pickTemplate(BLANK_TEMPLATE)}
          >
            <Text size="sm" fw={500} ta="center" c="dimmed">{t('wiz.blank')}</Text>
          </Card>
        </Stack>
      )}

      {step === 1 && (
        <Stack gap="md">
          {template && template.id !== 'blank' && (
            <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Text size="sm" fw={600}>{template.name}</Text>
              <Text size="xs" c="dimmed">{template.description}</Text>
            </Card>
          )}
          <TextInput
            label={t('common.name')}
            placeholder={t('wiz.namePh')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Textarea
            label={t('wiz.extraLabel')}
            description={t('wiz.extraHint')}
            minRows={3}
            value={extra}
            onChange={(e) => setExtra(e.currentTarget.value)}
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
            <BotAvatar definition={avatarDef} size={44} />
          </Group>
        </Stack>
      )}

      {step === 2 && template && (
        <Stack gap="md">
          <Card withBorder padding="md" radius="md">
            <Stack gap="xs">
              <Group gap="xs"><BotAvatar definition={avatarDef} size={28} /><Text size="sm"><Text span c="dimmed">{t('common.name')}: </Text><Text span fw={600}>{name.trim() || template.name || '—'}</Text></Text></Group>
              {template.id !== 'blank' && (
                <Text size="sm"><Text span c="dimmed">{t('wiz.role')}: </Text>{template.role}</Text>
              )}
              <Text size="sm"><Text span c="dimmed">{t('wiz.model')}: </Text><Text span ff="monospace" size="xs">{buildConfig().model}</Text></Text>
            </Stack>
          </Card>
          <div>
            <Text size="sm" fw={500} mb={6}>{t('wiz.canDo')}</Text>
            {canDo.length === 0 ? (
              <Text size="sm" c="dimmed">{t('common.none')}</Text>
            ) : (
              <Group gap={6}>
                {canDo.map((c) => <Badge key={c} size="sm" variant="light" color="gray">{c}</Badge>)}
              </Group>
            )}
          </div>
          {extra.trim() && (
            <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Text size="xs" fw={600} mb={4}>{t('wiz.instructions')}</Text>
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>{extra.trim()}</Text>
            </Card>
          )}
          {error && <Text size="sm" c="dimmed">{error}</Text>}
        </Stack>
      )}

      <Group justify="space-between">
        <Group gap="xs">
          {step > 0 && (
            <Button variant="default" size="xs" onClick={() => setStep(step - 1)} disabled={loading}>
              {t('common.back')}
            </Button>
          )}
          {onAdvanced && template && (
            <UnstyledButton onClick={() => onAdvanced(template)}>
              <Text size="xs" c="dimmed" td="underline">{t('wiz.advanced')}</Text>
            </UnstyledButton>
          )}
        </Group>
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={onClose} disabled={loading}>{t('common.cancel')}</Button>
          {step < 2 ? (
            <Button
              size="xs"
              disabled={step === 1 && !name.trim() && !template?.name}
              onClick={() => setStep(step + 1)}
            >
              {t('common.next')}
            </Button>
          ) : (
            <Button size="xs" onClick={handleCreate} loading={loading}>
              {t('wiz.create')}
            </Button>
          )}
        </Group>
      </Group>
    </Stack>
  );
}
