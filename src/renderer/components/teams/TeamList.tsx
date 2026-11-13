import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Modal, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useTeamStore } from '../../store/teamStore';
import { useAgentStore } from '../../store/agentStore';
import TeamEditor from './TeamEditor';
import { NICHE_PACKS } from '../../lib/nichePacks';
import { installNichePack } from '../../lib/installPack';
import { useAppMode } from '../../lib/useAppMode';
import { useLang } from '../../lib/i18n';
import PageHeader from '../common/PageHeader';
import PixelSpinner from '../common/PixelSpinner';
import BotAvatar from '../common/BotAvatar';
import { avatarForAgent } from '../../../shared/avatars';
import { IconTeam } from '../common/icons.js';

export default function TeamList() {
  const { t } = useLang();
  const { teams, loading, error, fetchTeams, selectTeam, deleteTeam, createTeam } = useTeamStore();
  const { agents } = useAgentStore();
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isCreating, setCreating2] = useState(false);
  const { mode: appMode } = useAppMode();

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm(t('teams.deleteConfirm'))) {
      await deleteTeam(id);
    }
  };

  const getAgent = (agentId: string) => agents.find(a => a.id === agentId);
  const getAgentName = (agentId: string) => getAgent(agentId)?.name || t('teams.unknownAgent');

  if (loading) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <PixelSpinner size={24} />
        <Text c="dimmed">{t('teams.loading')}</Text>
      </Stack>
    );
  }

  if (error) {
    return <Text c="dimmed">{t('common.error')}: {error}</Text>;
  }

  return (
    <Stack gap="md">
      <PageHeader
        title={t('ph.teams.title')}
        subtitle={t('ph.teams.sub')}
        help={t('ph.teams.help')}
        actions={
          <Group gap="xs">
            <Button size="xs" variant="default" onClick={() => setTemplatesOpen(true)}>{t('teams.templates')}</Button>
            <Button size="xs" onClick={() => setCreating(true)}>{t('teams.new')}</Button>
          </Group>
        }
      />

      {teams.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconTeam />
            <Text fw={500}>{t('teams.empty')}</Text>
            <Text size="sm" c="dimmed">{t('teams.emptyHint')}</Text>
          </Stack>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {teams.map((team) => (
            <Card
              key={team.id}
              withBorder
              padding="md"
              radius="md"
              className="km-enter km-hoverable"
              onClick={() => selectTeam(team.id)}
            >
              <Stack gap="xs">
                <Text fw={600} size="lg">{team.name}</Text>
                {team.description && <Text size="sm" c="dimmed" lineClamp={2}>{team.description}</Text>}
                <Text size="xs" fw={600} tt="uppercase" c="dimmed" mt={4}>
                  {t('teams.agents')} ({team.agentIds.length})
                </Text>
                <Group gap={6}>
                  {team.agentIds.length > 0 ? (
                    team.agentIds.map((agentId) => {
                      const agent = getAgent(agentId);
                      return (
                        <Group key={agentId} gap={4} wrap="nowrap" title={getAgentName(agentId)}>
                          {agent && <BotAvatar definition={avatarForAgent(agent)} size={22} />}
                          <Text size="xs" c="dimmed">{getAgentName(agentId)}</Text>
                        </Group>
                      );
                    })
                  ) : (
                    <Text size="sm" c="dimmed">{t('teams.noAgents')}</Text>
                  )}
                </Group>
                <Group justify="space-between" mt="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-3)', paddingTop: 8 }}>
                  <Text size="xs" c="dimmed">{t('teams.updated')} {new Date(team.updatedAt).toLocaleDateString()}</Text>
                  <Group gap={4}>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); setEditingTeamId(team.id); }}>
                      {t('common.edit')}
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={(e) => handleDelete(e, team.id)}>
                      {t('common.delete')}
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <Modal opened={!!editingTeamId} onClose={() => setEditingTeamId(null)} title={t('teams.editTitle')} size="lg">
        {editingTeamId && <TeamEditor teamId={editingTeamId} onClose={() => setEditingTeamId(null)} />}
      </Modal>

      <Modal opened={creating} onClose={() => setCreating(false)} title={t('teams.new')} size="md">
        <Stack gap="md">
          <TextInput
            label={t('teams.nameLabel')}
            placeholder={t('teams.namePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
          />
          <Textarea
            label={t('common.description')}
            placeholder={t('teams.descPlaceholder')}
            minRows={3}
            value={newDesc}
            onChange={(e) => setNewDesc(e.currentTarget.value)}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={() => setCreating(false)}>{t('common.cancel')}</Button>
            <Button
              size="xs"
              loading={isCreating}
              disabled={!newName.trim()}
              onClick={async () => {
                setCreating2(true);
                try {
                  await createTeam({ name: newName.trim(), description: newDesc.trim() });
                  setCreating(false);
                  setNewName('');
                  setNewDesc('');
                  await fetchTeams();
                } finally {
                  setCreating2(false);
                }
              }}
            >
              {t('common.create')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={templatesOpen} onClose={() => setTemplatesOpen(false)} title={t('teams.templatesTitle')} size="lg">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">{t('teams.templatesHint')}</Text>
          {NICHE_PACKS.filter((p) => appMode !== 'personal' || p.audience !== 'corporate').map((pack) => (
            <Card key={pack.id} withBorder padding="md" radius="md" className="km-enter km-hoverable">
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                <Stack gap={4} style={{ minWidth: 0 }}>
                  <Group gap="xs">
                    <Badge size="xs" variant="filled" color="dark">{t('wiz.packBadge')}</Badge>
                    <Text fw={600} size="sm">{pack.name}</Text>
                  </Group>
                  <Text size="xs" c="dimmed">{pack.tagline}</Text>
                  <Text size="xs" c="dimmed">
                    {pack.agents.length} {t('wiz.packAgents')} · {pack.agents.map((a) => a.name).join(', ')}
                  </Text>
                  <Text size="xs" c="dimmed">{t('wiz.packTeam')}: {pack.teamName}</Text>
                </Stack>
                <Button
                  size="compact-sm"
                  loading={installingId === pack.id}
                  disabled={installingId !== null && installingId !== pack.id}
                  onClick={async () => {
                    setInstallingId(pack.id);
                    try {
                      await installNichePack(pack);
                      void useAgentStore.getState().fetchAgents();
                      await fetchTeams();
                      setTemplatesOpen(false);
                    } finally {
                      setInstallingId(null);
                    }
                  }}
                >
                  {t('wiz.installPack')}
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
      </Modal>
    </Stack>
  );
}
