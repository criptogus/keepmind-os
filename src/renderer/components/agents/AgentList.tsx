import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Modal, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import AgentForm from './AgentForm';
import AgentEditor from './AgentEditor';
import { AGENT_TEMPLATES, type AgentTemplate } from '../../lib/agentTemplates';
import { IconAgent } from '../common/icons.js';

export default function AgentList() {
  const { agents, loading, error, fetchAgents, selectAgent, deleteAgent } = useAgentStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this agent?')) {
      await deleteAgent(id);
    }
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">Loading agents...</Text>;
  }

  if (error) {
    return <Text c="dimmed">Error: {error}</Text>;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2} size="h4">Agents</Title>
        <Button size="xs" variant="default" onClick={() => setShowCreateModal(true)}>New Agent</Button>
      </Group>

      {agents.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconAgent />
            <Text fw={500}>No agents yet</Text>
            <Text size="sm" c="dimmed">Create your first agent to get started</Text>
            <Button size="xs" variant="default" mt="xs" onClick={() => setShowCreateModal(true)}>Create Agent</Button>
          </Stack>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {agents.map((agent) => (
            <Card
              key={agent.id}
              withBorder
              padding="md"
              radius="md"
              style={{ cursor: 'pointer' }}
              onClick={() => selectAgent(agent.id)}
            >
              <Stack gap="xs">
                <Text fw={600}>{agent.name}</Text>
                <Text size="sm" c="dimmed" lineClamp={2}>{agent.description}</Text>
                {agent.capabilities.length > 0 && (
                  <Group gap={4}>
                    {agent.capabilities.slice(0, 4).map((cap) => (
                      <Badge key={cap} size="sm" variant="light" color="gray">{cap}</Badge>
                    ))}
                  </Group>
                )}
                <Group justify="space-between" mt="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-3)', paddingTop: 8 }}>
                  <Text size="xs" c="dimmed">Updated {new Date(agent.updatedAt).toLocaleDateString()}</Text>
                  <Group gap={4}>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); setEditingAgentId(agent.id); }}>
                      Edit
                    </Button>
                    <Button
                      size="compact-xs"
                      variant={agent.isShared ? 'light' : 'subtle'}
                      color="dark"
                      title={agent.isShared ? 'Shared with members — click to unshare' : 'Private — click to share with members'}
                      onClick={async (e) => {
                        e.stopPropagation();
                        await window.electronAPI.shareAgent(agent.id, !agent.isShared).catch(() => {});
                        await fetchAgents();
                      }}
                    >
                      {agent.isShared ? 'Shared' : 'Share'}
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={(e) => handleDelete(e, agent.id)}>
                      Delete
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <Modal
        opened={showCreateModal}
        onClose={() => { setShowCreateModal(false); setSelectedTemplate(null); }}
        title={selectedTemplate ? 'Configure Agent' : 'New Agent — choose a template'}
        size="lg"
      >
        {selectedTemplate ? (
          <AgentForm
            template={selectedTemplate}
            onClose={() => { setShowCreateModal(false); setSelectedTemplate(null); }}
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
                  onClick={() => setSelectedTemplate(t)}
                >
                  <Stack gap={4}>
                    <Text fw={600} size="sm">{t.name}</Text>
                    <Text size="xs" c="dimmed">{t.tagline}</Text>
                    {t.skillNames.length > 0 && (
                      <Text size="xs" c="dimmed">Skills: {t.skillNames.join(', ')}</Text>
                    )}
                    {t.toolNames.length > 0 && (
                      <Text size="xs" c="dimmed">{t.toolNames.length} tools</Text>
                    )}
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
            <Button
              variant="default"
              size="xs"
              onClick={() => setSelectedTemplate({ id: 'blank', name: '', role: 'Custom', tagline: '', description: '', capabilities: [], skillNames: [], toolNames: [], config: { model: '', temperature: 0.7, maxTokens: 2048, systemPrompt: '', tools: [], skillIds: [] } })}
            >
              Start from blank
            </Button>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!editingAgentId} onClose={() => setEditingAgentId(null)} title="Edit Agent" size="lg">
        {editingAgentId && <AgentEditor agentId={editingAgentId} onClose={() => setEditingAgentId(null)} />}
      </Modal>
    </Stack>
  );
}
