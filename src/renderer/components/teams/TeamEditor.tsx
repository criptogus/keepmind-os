import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Select, Stack, Tabs, Text, Textarea, Title } from '@mantine/core';
import { useTeamStore } from '../../store/teamStore';
import { useAgentStore } from '../../store/agentStore';
import WorkflowBuilder from './WorkflowBuilder';
import TeamExecutionView from './TeamExecutionView';
import type { Team, Workflow } from '../../../shared/types.js';

interface TeamEditorProps {
  teamId: string;
  onClose: () => void;
}

export default function TeamEditor({ teamId, onClose }: TeamEditorProps) {
  const { selectedTeam, loading, error, updateTeam, deleteTeam, addAgentToTeam, removeAgentFromTeam, selectTeam } = useTeamStore();
  const { agents } = useAgentStore();
  const [activeTab, setActiveTab] = useState<string | null>('config');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');

  useEffect(() => {
    selectTeam(teamId);
  }, [teamId, selectTeam]);

  useEffect(() => {
    if (selectedTeam) {
      setName(selectedTeam.name);
      setDescription(selectedTeam.description);
      setWorkflow(selectedTeam.workflow);
    }
  }, [selectedTeam]);

  const handleSave = async () => {
    if (!selectedTeam) return;
    try {
      await updateTeam(teamId, {
        name,
        description,
        workflow: workflow || undefined,
      });
    } catch (err) {
      console.error('Failed to update team:', err);
    }
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this team?')) {
      await deleteTeam(teamId);
      onClose();
    }
  };

  const handleAddAgent = async () => {
    if (!selectedAgentId) return;
    await addAgentToTeam(teamId, selectedAgentId);
    setSelectedAgentId('');
  };

  const handleRemoveAgent = async (agentId: string) => {
    await removeAgentFromTeam(teamId, agentId);
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">Loading team...</Text>;
  }

  if (!selectedTeam) {
    return <Text c="dimmed" ta="center" py="xl">Team not found</Text>;
  }

  const availableAgents = agents.filter(a => !selectedTeam.agentIds.includes(a.id));

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3} size="h5">Edit Team: {selectedTeam.name}</Title>
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
          <Tabs.Tab value="workflow" disabled={!workflow}>Workflow</Tabs.Tab>
          <Tabs.Tab value="execute">Execute</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="config" pt="md">
          <Stack gap="md">
            <TextInput_ label="Team Name" value={name} onChange={(v) => setName(v)} />
            <Textarea
              label="Description"
              minRows={3}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />

            <Card withBorder padding="md" radius="md">
              <Stack gap="sm">
                <Text size="sm" fw={600}>Assigned Agents</Text>
                <Group gap="xs">
                  {selectedTeam.agentIds.length === 0 && <Text size="sm" c="dimmed">No agents assigned</Text>}
                  {selectedTeam.agentIds.map(agentId => {
                    const agent = agents.find(a => a.id === agentId);
                    return agent ? (
                      <Badge key={agentId} variant="light" size="lg" rightSection={
                        <Text
                          span
                          style={{ cursor: 'pointer' }}
                          onClick={() => handleRemoveAgent(agentId)}
                        >×</Text>
                      }>
                        {agent.name}
                      </Badge>
                    ) : null;
                  })}
                </Group>

                {availableAgents.length > 0 && (
                  <Group gap="xs">
                    <Select
                      placeholder="Add agent..."
                      data={availableAgents.map(a => ({ value: a.id, label: a.name }))}
                      value={selectedAgentId || null}
                      onChange={(v) => setSelectedAgentId(v || '')}
                      searchable
                      style={{ flex: 1 }}
                    />
                    <Button size="xs" onClick={handleAddAgent} disabled={!selectedAgentId}>Add</Button>
                  </Group>
                )}
              </Stack>
            </Card>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="workflow" pt="md">
          {workflow && (
            <WorkflowBuilder
              workflow={workflow}
              agents={selectedTeam.agentIds.map(id => {
                const agent = agents.find(a => a.id === id);
                return agent || { id, name: 'Unknown' };
              })}
              onChange={setWorkflow}
            />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="execute" pt="md">
          <TeamExecutionView team={selectedTeam} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function TextInput_({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Text size="sm" fw={500} mb={4}>{label}</Text>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid var(--mantine-color-gray-4)',
          fontSize: 14,
          fontFamily: 'inherit',
          backgroundColor: '#fff',
          color: 'var(--mantine-color-dark-8)',
        }}
      />
    </div>
  );
}
