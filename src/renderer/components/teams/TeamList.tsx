import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Modal, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useTeamStore } from '../../store/teamStore';
import { useAgentStore } from '../../store/agentStore';
import TeamEditor from './TeamEditor';
import { IconTeam } from '../common/icons.js';

export default function TeamList() {
  const { teams, loading, error, fetchTeams, selectTeam, deleteTeam, createTeam } = useTeamStore();
  const { agents } = useAgentStore();
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isCreating, setCreating2] = useState(false);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this team?')) {
      await deleteTeam(id);
    }
  };

  const getAgentName = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    return agent?.name || 'Unknown Agent';
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">Loading teams...</Text>;
  }

  if (error) {
    return <Text c="dimmed">Error: {error}</Text>;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2} size="h4">Teams</Title>
        <Button size="xs" variant="default" onClick={() => setCreating(true)}>New Team</Button>
      </Group>

      {teams.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconTeam />
            <Text fw={500}>No teams yet</Text>
            <Text size="sm" c="dimmed">Create a team to coordinate multiple agents</Text>
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
              style={{ cursor: 'pointer' }}
              onClick={() => selectTeam(team.id)}
            >
              <Stack gap="xs">
                <Text fw={600} size="lg">{team.name}</Text>
                {team.description && <Text size="sm" c="dimmed" lineClamp={2}>{team.description}</Text>}
                <Text size="xs" fw={600} tt="uppercase" c="dimmed" mt={4}>
                  Agents ({team.agentIds.length})
                </Text>
                <Group gap={6}>
                  {team.agentIds.length > 0 ? (
                    team.agentIds.map((agentId) => (
                      <Badge key={agentId} size="sm" variant="light" color="gray">{getAgentName(agentId)}</Badge>
                    ))
                  ) : (
                    <Text size="sm" c="dimmed">No agents assigned</Text>
                  )}
                </Group>
                <Group justify="space-between" mt="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-3)', paddingTop: 8 }}>
                  <Text size="xs" c="dimmed">Updated {new Date(team.updatedAt).toLocaleDateString()}</Text>
                  <Group gap={4}>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); setEditingTeamId(team.id); }}>
                      Edit
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={(e) => handleDelete(e, team.id)}>
                      Delete
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <Modal opened={!!editingTeamId} onClose={() => setEditingTeamId(null)} title="Edit Team" size="lg">
        {editingTeamId && <TeamEditor teamId={editingTeamId} onClose={() => setEditingTeamId(null)} />}
      </Modal>

      <Modal opened={creating} onClose={() => setCreating(false)} title="New Team" size="md">
        <Stack gap="md">
          <TextInput
            label="Team name"
            placeholder="e.g. Marketing Squad"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
          />
          <Textarea
            label="Description"
            placeholder="What does this team do?"
            minRows={3}
            value={newDesc}
            onChange={(e) => setNewDesc(e.currentTarget.value)}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={() => setCreating(false)}>Cancel</Button>
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
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
