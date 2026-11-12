import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Modal, SimpleGrid, Stack, Text } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import AgentForm from './AgentForm';
import AgentWizard from './AgentWizard';
import AgentEditor from './AgentEditor';
import type { AgentTemplate } from '../../lib/agentTemplates';
import { useLang } from '../../lib/i18n';
import PageHeader from '../common/PageHeader';
import { IconAgent } from '../common/icons.js';

export default function AgentList() {
  const { t } = useLang();
  const { agents, loading, error, fetchAgents, selectAgent, deleteAgent } = useAgentStore();
  const [createMode, setCreateMode] = useState<'wizard' | 'advanced' | null>(null);
  const [advancedTemplate, setAdvancedTemplate] = useState<AgentTemplate | null>(null);
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
      <PageHeader
        title={t('ph.agents.title')}
        subtitle={t('ph.agents.sub')}
        help={t('ph.agents.help')}
        actions={<Button data-tour="agents-new" size="xs" variant="default" onClick={() => setCreateMode('wizard')}>{t('agents.new')}</Button>}
      />

      {agents.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconAgent />
            <Text fw={500}>{t('agents.empty')}</Text>
            <Text size="sm" c="dimmed">{t('agents.emptyHint')}</Text>
            <Button size="xs" variant="default" mt="xs" onClick={() => setCreateMode('wizard')}>{t('agents.createAgent')}</Button>
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
        opened={createMode !== null}
        onClose={() => { setCreateMode(null); setAdvancedTemplate(null); }}
        title={createMode === 'advanced' ? t('wiz.advanced') : t('wiz.title')}
        size="xl"
      >
        {createMode === 'advanced' ? (
          <AgentForm
            template={advancedTemplate}
            onClose={() => { setCreateMode(null); setAdvancedTemplate(null); }}
          />
        ) : (
          <AgentWizard
            onClose={() => setCreateMode(null)}
            onAdvanced={(tpl) => { setAdvancedTemplate(tpl); setCreateMode('advanced'); }}
          />
        )}
      </Modal>

      <Modal opened={!!editingAgentId} onClose={() => setEditingAgentId(null)} title={t('agents.edit')} size="lg">
        {editingAgentId && <AgentEditor agentId={editingAgentId} onClose={() => setEditingAgentId(null)} />}
      </Modal>
    </Stack>
  );
}
