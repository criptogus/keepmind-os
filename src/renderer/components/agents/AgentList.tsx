import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Modal, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import AgentForm from './AgentForm';
import AgentEditor from './AgentEditor';
import { AGENT_TEMPLATES, type AgentTemplate } from '../../lib/agentTemplates';
import { useLang } from '../../lib/i18n';
import { IconAgent } from '../common/icons.js';

export default function AgentList() {
  const { t } = useLang();
  const { agents, loading, error, fetchAgents, selectAgent, deleteAgent } = useAgentStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm(t('agents.deleteConfirm'))) {
      await deleteAgent(id);
    }
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">{t('agents.loading')}</Text>;
  }

  if (error) {
    return <Text c="dimmed">{t('common.error')}: {error}</Text>;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2} size="h4">{t('agents.title')}</Title>
        <Button size="xs" variant="default" onClick={() => setShowCreateModal(true)}>{t('agents.new')}</Button>
      </Group>

      {agents.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconAgent />
            <Text fw={500}>{t('agents.empty')}</Text>
            <Text size="sm" c="dimmed">{t('agents.emptyHint')}</Text>
            <Button size="xs" variant="default" mt="xs" onClick={() => setShowCreateModal(true)}>{t('agents.createAgent')}</Button>
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
                  <Text size="xs" c="dimmed">{t('agents.updated')} {new Date(agent.updatedAt).toLocaleDateString()}</Text>
                  <Group gap={4}>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); setEditingAgentId(agent.id); }}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="compact-xs"
                      variant={agent.isShared ? 'light' : 'subtle'}
                      color="dark"
                      title={agent.isShared ? t('agents.sharedHint') : t('agents.privateHint')}
                      onClick={async (e) => {
                        e.stopPropagation();
                        await window.electronAPI.shareAgent(agent.id, !agent.isShared).catch(() => {});
                        await fetchAgents();
                      }}
                    >
                      {agent.isShared ? t('agents.shared') : t('agents.share')}
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={(e) => handleDelete(e, agent.id)}>
                      {t('common.delete')}
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
        title={selectedTemplate ? t('agents.configure') : t('agents.chooseTemplate')}
        size="xl"
      >
        {selectedTemplate ? (
          <AgentForm
            template={selectedTemplate}
            onClose={() => { setShowCreateModal(false); setSelectedTemplate(null); }}
          />
        ) : (
          <Stack gap="md">
            {Object.entries(
              AGENT_TEMPLATES.reduce<Record<string, AgentTemplate[]>>((acc, t) => {
                (acc[t.group] ||= []).push(t);
                return acc;
              }, {})
            ).map(([group, templates]) => (
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
                      onClick={() => setSelectedTemplate(tpl)}
                    >
                      <Stack gap={4}>
                        <Text fw={600} size="sm">{tpl.name}</Text>
                        <Text size="xs" c="dimmed">{tpl.tagline}</Text>
                        {tpl.skillNames.length > 0 && (
                          <Text size="xs" c="dimmed">{t('nav.skills')}: {tpl.skillNames.join(', ')}</Text>
                        )}
                        {tpl.toolNames.length > 0 && (
                          <Text size="xs" c="dimmed">{tpl.toolNames.length} {t('agents.tools')}</Text>
                        )}
                      </Stack>
                    </Card>
                  ))}
                </SimpleGrid>
              </div>
            ))}
            <Button
              variant="default"
              size="xs"
              onClick={() => setSelectedTemplate({ id: 'blank', name: '', group: '', role: 'Custom', tagline: '', description: '', capabilities: [], skillNames: [], toolNames: [], config: { model: '', temperature: 0.7, maxTokens: 2048, systemPrompt: '', tools: [], skillIds: [] } })}
            >
              {t('agents.startBlank')}
            </Button>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!editingAgentId} onClose={() => setEditingAgentId(null)} title={t('agents.edit')} size="lg">
        {editingAgentId && <AgentEditor agentId={editingAgentId} onClose={() => setEditingAgentId(null)} />}
      </Modal>
    </Stack>
  );
}
