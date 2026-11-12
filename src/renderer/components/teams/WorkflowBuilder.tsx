import React, { useState } from 'react';
import { Button, Card, Group, Modal, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { v4 as uuidv4 } from 'uuid';
import type { Agent, Workflow, WorkflowStep } from '../../../shared/types.js';
import { useAgentStore } from '../../store/agentStore';
import AgentForm from '../agents/AgentForm';
import { AGENT_TEMPLATES, type AgentTemplate } from '../../lib/agentTemplates';

interface WorkflowBuilderProps {
  workflow: Workflow;
  agents: Array<{ id: string; name: string }>;
  onChange: (workflow: Workflow) => void;
  /** Called after an agent is created inside the flow (e.g. to attach it to the team). */
  onAgentCreated?: (agent: Agent) => void | Promise<void>;
}

export default function WorkflowBuilder({ workflow, agents, onChange, onAgentCreated }: WorkflowBuilderProps) {
  const [newStepAgentId, setNewStepAgentId] = useState('');
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [pickedTemplate, setPickedTemplate] = useState<AgentTemplate | null>(null);
  const { fetchAgents } = useAgentStore();

  const addStepForAgent = (agentId: string) => {
    const newStep: WorkflowStep = { id: uuidv4(), agentId, inputs: {} };
    onChange({ ...workflow, steps: [...workflow.steps, newStep] });
  };

  const handleAgentCreated = async (agent: Agent) => {
    await onAgentCreated?.(agent);
    await fetchAgents();
    addStepForAgent(agent.id);
    setShowAgentPicker(false);
    setPickedTemplate(null);
  };

  const addStep = () => {
    if (!newStepAgentId) return;
    const newStep: WorkflowStep = { id: uuidv4(), agentId: newStepAgentId, inputs: {} };
    onChange({ ...workflow, steps: [...workflow.steps, newStep] });
    setNewStepAgentId('');
  };

  const updateStep = (stepId: string, updates: Partial<WorkflowStep>) => {
    onChange({
      ...workflow,
      steps: workflow.steps.map(step => step.id === stepId ? { ...step, ...updates } : step),
    });
  };

  const deleteStep = (stepId: string) => {
    onChange({ ...workflow, steps: workflow.steps.filter(step => step.id !== stepId) });
  };

  const moveStep = (fromIndex: number, toIndex: number) => {
    const steps = [...workflow.steps];
    const [removed] = steps.splice(fromIndex, 1);
    steps.splice(toIndex, 0, removed);
    onChange({ ...workflow, steps });
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4} size="h5">Workflow Builder</Title>
        <Group gap="xs">
          <Text size="sm" fw={500}>Execution Mode:</Text>
          <Select
            size="xs"
            value={workflow.executionMode}
            onChange={(v) => onChange({ ...workflow, executionMode: (v || 'sequential') as Workflow['executionMode'] })}
            data={[
              { value: 'sequential', label: 'Sequential' },
              { value: 'parallel', label: 'Parallel' },
              { value: 'conditional', label: 'Conditional' },
            ]}
            allowDeselect={false}
            style={{ width: 160 }}
          />
        </Group>
      </Group>

      <Stack gap="sm">
        {workflow.steps.length === 0 ? (
          <Card withBorder padding="lg" radius="md" style={{ borderStyle: 'dashed', backgroundColor: 'var(--mantine-color-gray-0)' }}>
            <Text size="sm" c="dimmed" ta="center">No steps added yet</Text>
          </Card>
        ) : (
          workflow.steps.map((step, index) => (
            <Card key={step.id} withBorder padding="md" radius="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Group gap="xs">
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%',
                      backgroundColor: '#111', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 600,
                    }}>
                      {index + 1}
                    </div>
                    <Text size="sm" fw={500}>Step {index + 1}</Text>
                  </Group>
                  <Group gap="xs">
                    {index > 0 && (
                      <Button size="compact-xs" variant="default" onClick={() => moveStep(index, index - 1)}>↑</Button>
                    )}
                    {index < workflow.steps.length - 1 && (
                      <Button size="compact-xs" variant="default" onClick={() => moveStep(index, index + 1)}>↓</Button>
                    )}
                    <Button size="compact-xs" variant="default" onClick={() => deleteStep(step.id)}>Delete</Button>
                  </Group>
                </Group>

                <Select
                  label="Agent"
                  size="sm"
                  value={step.agentId}
                  onChange={(v) => updateStep(step.id, { agentId: v || step.agentId })}
                  data={agents.map(agent => ({ value: agent.id, label: agent.name }))}
                  allowDeselect={false}
                />

                <div>
                  <Text size="sm" fw={500} mb={4}>Input (JSON)</Text>
                  <textarea
                    value={JSON.stringify(step.inputs, null, 2)}
                    onChange={(e) => {
                      try {
                        updateStep(step.id, { inputs: JSON.parse(e.target.value) });
                      } catch (err) {
                        // Invalid JSON, ignore
                      }
                    }}
                    style={{
                      width: '100%',
                      minHeight: 80,
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--mantine-color-gray-4)',
                      fontSize: 13,
                      fontFamily: 'monospace',
                      resize: 'vertical',
                      backgroundColor: '#fff',
                      color: 'var(--mantine-color-dark-8)',
                    }}
                  />
                </div>

                {workflow.executionMode === 'conditional' && (
                  <div>
                    <Text size="sm" fw={500} mb={4}>Condition</Text>
                    <input
                      type="text"
                      value={step.condition || ''}
                      onChange={(e) => updateStep(step.id, { condition: e.target.value })}
                      placeholder="e.g., input.success === true"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--mantine-color-gray-4)',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        backgroundColor: '#fff',
                        color: 'var(--mantine-color-dark-8)',
                      }}
                    />
                  </div>
                )}
              </Stack>
            </Card>
          ))
        )}
      </Stack>

      <Group gap="xs">
        <Select
          placeholder="Select agent to add..."
          data={agents.map(agent => ({ value: agent.id, label: agent.name }))}
          value={newStepAgentId || null}
          onChange={(v) => setNewStepAgentId(v || '')}
          searchable
          style={{ flex: 1 }}
        />
        <Button size="sm" onClick={addStep} disabled={!newStepAgentId}>Add Step</Button>
        <Button size="sm" variant="default" onClick={() => { setPickedTemplate(null); setShowAgentPicker(true); }}>
          + New agent
        </Button>
      </Group>

      <Modal
        opened={showAgentPicker}
        onClose={() => { setShowAgentPicker(false); setPickedTemplate(null); }}
        title={pickedTemplate ? 'Configure agent for this step' : 'New thematic agent'}
        size="lg"
      >
        {pickedTemplate ? (
          <AgentForm
            template={pickedTemplate}
            onClose={() => { setShowAgentPicker(false); setPickedTemplate(null); }}
            onCreated={handleAgentCreated}
          />
        ) : (
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              {AGENT_TEMPLATES.map((t) => (
                <Card
                  key={t.id}
                  withBorder
                  padding="md"
                  radius="md"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setPickedTemplate(t)}
                >
                  <Stack gap={4}>
                    <Text fw={600} size="sm">{t.name}</Text>
                    <Text size="xs" c="dimmed">{t.tagline}</Text>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
            <Button
              variant="default"
              size="xs"
              onClick={() => setPickedTemplate({ id: 'blank', name: '', group: '', role: 'Custom', tagline: '', description: '', capabilities: [], skillNames: [], toolNames: [], config: { model: '', temperature: 0.7, maxTokens: 2048, systemPrompt: '', tools: [], skillIds: [] } })}
            >
              Start from blank
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
