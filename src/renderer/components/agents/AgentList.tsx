import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Modal, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import AgentForm from './AgentForm';
import AgentWizard from './AgentWizard';
import AgentEditor from './AgentEditor';
import type { AgentTemplate } from '../../lib/agentTemplates';
import { useLang } from '../../lib/i18n';
import PageHeader from '../common/PageHeader';
import BotAvatar from '../common/BotAvatar';
import { avatarForAgent } from '../../../shared/avatars';
import type { AvatarMotion } from 'open-bot-avatar';
import PixelSpinner from '../common/PixelSpinner';
import OrgChart from './OrgChart';
import { IconAgent } from '../common/icons.js';

export default function AgentList() {
  const { t } = useLang();
  const { agents, executions, loading, error, fetchAgents, selectAgent, deleteAgent } = useAgentStore();
  const [createMode, setCreateMode] = useState<'wizard' | 'advanced' | null>(null);
  const [advancedTemplate, setAdvancedTemplate] = useState<AgentTemplate | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'org'>('list');

  useEffect(() => {
    fetchAgents();
    void useAgentStore.getState().fetchExecutions();
  }, [fetchAgents]);

  /** Avatar mood mirrors real execution state: thinking while running,
   *  happy briefly after a success, idle otherwise. */
  const moodFor = (agentId: string): AvatarMotion => {
    const execs = executions.filter((e) => e.agentId === agentId);
    if (execs.some((e) => e.status === 'running')) return 'thinking';
    const last = execs[0];
    if (last?.status === 'completed' && Date.now() - new Date(last.completedAt ?? last.startedAt ?? 0).getTime() < 30_000) {
      return 'happy';
    }
    return 'idle';
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm(t('agents.deleteConfirm'))) {
      await deleteAgent(id);
    }
  };

  const isRunning = (agentId: string) => executions.some((e) => e.agentId === agentId && e.status === 'running');

  if (loading) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <PixelSpinner size={24} />
        <Text c="dimmed">{t('agents.loading')}</Text>
      </Stack>
    );
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
        actions={
          <Group gap="xs">
            {agents.length > 1 && (
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => setView(v as 'list' | 'org')}
                data={[
                  { value: 'list', label: t('agents.viewList') },
                  { value: 'org', label: t('agents.viewOrg') },
                ]}
              />
            )}
            <Button data-tour="agents-new" size="xs" variant="default" onClick={() => setCreateMode('wizard')}>{t('agents.new')}</Button>
          </Group>
        }
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
      ) : view === 'org' ? (
        <OrgChart agents={agents} onSelect={(a) => selectAgent(a.id)} />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {agents.map((agent) => (
            <Card
              key={agent.id}
              withBorder
              padding="md"
              radius="md"
              className="km-enter"
              style={{ cursor: 'pointer' }}
              onClick={() => selectAgent(agent.id)}
            >
              <Stack gap="xs">
                <Group gap="sm" wrap="nowrap">
                  <BotAvatar definition={avatarForAgent(agent)} mood={moodFor(agent.id)} size={44} />
                  <div>
                    <Text fw={600}>{agent.name}</Text>
                    {isRunning(agent.id) && (
                      <Group gap={4} wrap="nowrap">
                        <PixelSpinner size={14} />
                        <Text size="xs" c="dimmed">{t('agents.working')}</Text>
                      </Group>
                    )}
                  </div>
                </Group>
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
