import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, Group, Select, Slider, Stack, Tabs, Text, Textarea, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import { useModelOptions } from '../../lib/useModelOptions';
import AgentExecutionView from './AgentExecutionView';
import type { AgentConfig, Skill } from '../../../shared/types.js';

interface AgentEditorProps {
  agentId: string;
  onClose: () => void;
}

export default function AgentEditor({ agentId, onClose }: AgentEditorProps) {
  const { selectedAgent, loading, error, updateAgent, deleteAgent, executeAgent, selectAgent } = useAgentStore();
  const [activeTab, setActiveTab] = useState<string | null>('config');
  const [config, setConfig] = useState<AgentConfig | null>(null);
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
    }
  }, [selectedAgent]);

  const handleSave = async () => {
    if (!config) return;
    try {
      await updateAgent(agentId, config);
    } catch (err) {
      console.error('Failed to update agent:', err);
    }
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this agent?')) {
      await deleteAgent(agentId);
      onClose();
    }
  };

  const handleExecute = async () => {
    try {
      const input = JSON.parse(executionInput);
      await executeAgent(agentId, input);
      setActiveTab('executions');
    } catch (err) {
      alert('Invalid JSON input');
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
    return <Text c="dimmed" ta="center" py="xl">Loading agent...</Text>;
  }

  if (!selectedAgent || !config) {
    return <Text c="dimmed" ta="center" py="xl">Agent not found</Text>;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3} size="h5">Edit Agent: {selectedAgent.name}</Title>
        <Group gap="xs">
          <Button variant="default" size="xs" onClick={onClose}>Back</Button>
          <Button variant="default" size="xs" onClick={handleDelete}>Delete</Button>
          <Button size="xs" onClick={handleSave}>Save</Button>
        </Group>
      </Group>

      {error && <Text size="sm" c="dimmed">{error}</Text>}

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="config">Configuration</Tabs.Tab>
          <Tabs.Tab value="executions">Executions</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="config" pt="md">
          <Stack gap="md">
            <Select
              label="Model"
              data={modelGroups}
              value={config.model}
              onChange={(v) => setConfig({ ...config, model: v || config.model })}
              allowDeselect={false}
              searchable
            />

            <Textarea
              label="System prompt"
              minRows={5}
              value={config.systemPrompt}
              onChange={(e) => setConfig({ ...config, systemPrompt: e.currentTarget.value })}
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
            </div>

            {availableSkills.length > 0 && (
              <div>
                <Text size="sm" fw={500} mb={4}>Skills</Text>
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

            <Card withBorder padding="md" radius="md">
              <Stack gap="sm">
                <Text size="sm" fw={600}>Quick execute</Text>
                <Textarea
                  placeholder='{"message": "Hello"}'
                  minRows={4}
                  ff="monospace"
                  size="sm"
                  value={executionInput}
                  onChange={(e) => setExecutionInput(e.currentTarget.value)}
                />
                <Group justify="flex-end">
                  <Button size="xs" onClick={handleExecute}>Execute</Button>
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
