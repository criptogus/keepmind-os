import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Group, Select, Slider, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import { useModelOptions } from '../../lib/useModelOptions';
import type { AgentTemplate } from '../../lib/agentTemplates';
import { DEFAULT_MODEL } from '../../../shared/models.js';
import type { Agent, AgentConfig, Skill, ToolConfig } from '../../../shared/types.js';

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
  const { createAgent, loading, error } = useAgentStore();
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
        <Title order={3} size="h5">{template ? `Create: ${template.role}` : 'Create New Agent'}</Title>
        {template && (
          <Text size="sm" c="dimmed">{template.tagline}</Text>
        )}

        <TextInput
          label="Name"
          placeholder="Agent name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />

        <TextInput
          label="Description"
          placeholder="Short description shown in the agents list"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />

        <Select
          label="Model"
          data={modelGroups}
          value={config.model}
          onChange={(v) => setConfig({ ...config, model: v || DEFAULT_MODEL.openai })}
          allowDeselect={false}
          searchable
        />

        <Textarea
          label="System prompt"
          description="Defines the agent's role, capabilities, and constraints."
          minRows={5}
          value={config.systemPrompt}
          onChange={(e) => setConfig({ ...config, systemPrompt: e.currentTarget.value })}
          placeholder="Describe the agent's role, capabilities, and constraints..."
          required
        />

        <div>
          <Text size="sm" fw={500}>Temperature: {config.temperature}</Text>
          <Slider
            min={0}
            max={2}
            step={0.1}
            value={config.temperature}
            onChange={(v) => setConfig({ ...config, temperature: v })}
            mb="xs"
          />
          <Text size="xs" c="dimmed">Lower values are more deterministic, higher values more creative.</Text>
        </div>

        <div>
          <Text size="sm" fw={500}>Max tokens: {config.maxTokens}</Text>
          <Slider
            min={256}
            max={4096}
            step={256}
            value={config.maxTokens}
            onChange={(v) => setConfig({ ...config, maxTokens: v })}
            mb="xs"
          />
          <Text size="xs" c="dimmed">Maximum length of the agent's response.</Text>
        </div>

        {registryTools.length > 0 && (
          <div>
            <Text size="sm" fw={500} mb={4}>Tools</Text>
            <Text size="xs" c="dimmed" mb={8}>
              Direct tool access for this agent. Sensitive tools still require approval in Governance.
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
            <Text size="sm" fw={500} mb={4}>Skills</Text>
            <Text size="xs" c="dimmed" mb={8}>
              Skills inject specialized instructions and tool access into this agent.
            </Text>
            <Stack gap={4}>
              {availableSkills.map((skill) => (
                <Checkbox
                  key={skill.id}
                  size="sm"
                  label={
                    <Text size="sm">
                      <Text span fw={600}>{skill.name}</Text>
                      {skill.description ? ` — ${skill.description}` : ''}
                      {skill.toolNames.length > 0 ? ` (${skill.toolNames.length} tools)` : ''}
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
          <Button variant="default" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="submit" loading={loading}>{loading ? 'Creating...' : 'Create Agent'}</Button>
        </Group>
      </Stack>
    </form>
  );
}
