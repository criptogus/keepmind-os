import React, { useEffect } from 'react';
import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useGovernanceStore } from '../../store/governanceStore';
import { IconShield } from '../common/icons.js';

export default function ApprovalQueue() {
  const { pendingApprovals, loading, error, fetchPendingApprovals, approveAction, rejectAction } = useGovernanceStore();

  useEffect(() => {
    fetchPendingApprovals();
    const interval = setInterval(fetchPendingApprovals, 5000);
    return () => clearInterval(interval);
  }, [fetchPendingApprovals]);

  const handleApprove = async (id: string) => {
    await approveAction(id);
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Reason for rejection:');
    if (reason) {
      await rejectAction(id, reason);
    }
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">Loading approvals...</Text>;
  }

  if (error) {
    return <Text c="dimmed">Error: {error}</Text>;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="sm">
          <Title order={2} size="h4">Pending Approvals</Title>
          {pendingApprovals.length > 0 && (
            <Badge size="sm" variant="light" color="gray">{pendingApprovals.length} pending</Badge>
          )}
        </Group>
        {pendingApprovals.length > 1 && (
          <Button
            size="xs"
            variant="default"
            onClick={async () => {
              for (const a of pendingApprovals) {
                await approveAction(a.id);
              }
            }}
          >
            Approve all
          </Button>
        )}
      </Group>

      {pendingApprovals.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <IconShield />
            <Text fw={500}>No pending approvals</Text>
            <Text size="sm" c="dimmed">All actions have been reviewed</Text>
          </Stack>
        </Card>
      ) : (
        pendingApprovals.map((approval) => (
          <Card key={approval.id} withBorder padding="md" radius="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Badge size="sm" variant="light" color="gray">{approval.type}</Badge>
                <Text size="xs" c="dimmed">{new Date(approval.createdAt).toLocaleString()}</Text>
              </Group>
              <div>
                <Text size="sm" fw={600}>{approval.agentName}</Text>
                <Text size="sm" c="dimmed">{approval.action}</Text>
              </div>
              <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(approval.context, null, 2)}
                </Text>
              </Card>
              <Group justify="flex-end" gap="xs">
                <Button size="xs" variant="default" onClick={() => handleApprove(approval.id)}>Approve</Button>
                <Button size="xs" variant="default" onClick={() => handleReject(approval.id)}>Reject</Button>
              </Group>
            </Stack>
          </Card>
        ))
      )}
    </Stack>
  );
}
