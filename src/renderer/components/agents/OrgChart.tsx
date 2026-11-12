import React, { useMemo } from 'react';
import { Card, Group, Stack, Text } from '@mantine/core';
import BotAvatar from '../common/BotAvatar';
import { avatarForAgent } from '../../../shared/avatars';
import { useLang } from '../../lib/i18n';
import type { Agent } from '../../../shared/types';

interface OrgChartProps {
  agents: Agent[];
  onSelect?: (agent: Agent) => void;
}

/**
 * Reporting hierarchy: agents with no manager sit at the top, each
 * managerId nests its reports underneath. Cycles are impossible via the
 * IPC validation, but the visited set keeps rendering safe regardless.
 */
export default function OrgChart({ agents, onSelect }: OrgChartProps) {
  const { t } = useLang();
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const childrenOf = useMemo(() => {
    const map = new Map<string | undefined, Agent[]>();
    for (const a of agents) {
      const key = a.managerId && byId.has(a.managerId) ? a.managerId : undefined;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((x, y) => x.name.localeCompare(y.name));
    return map;
  }, [agents, byId]);

  const renderNode = (agent: Agent, depth: number, trail: Set<string>): React.ReactNode => {
    if (trail.has(agent.id)) return null;
    const next = new Set(trail).add(agent.id);
    const kids = childrenOf.get(agent.id) ?? [];
    const manager = agent.managerId ? byId.get(agent.managerId) : undefined;
    return (
      <div key={agent.id}>
        <Card
          withBorder
          padding="xs"
          radius="sm"
          style={{ cursor: onSelect ? 'pointer' : 'default', borderLeft: depth > 0 ? '3px solid var(--mantine-color-gray-4)' : undefined }}
          onClick={() => onSelect?.(agent)}
        >
          <Group gap="sm" wrap="nowrap">
            <BotAvatar definition={avatarForAgent(agent)} size={30} showBadge={false} />
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} lineClamp={1}>{agent.name}</Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {manager ? `${t('org.reportsTo')} ${manager.name}` : t('org.topLevel')}
                {agent.description ? ` · ${agent.description}` : ''}
              </Text>
            </div>
          </Group>
        </Card>
        {kids.length > 0 && (
          <div style={{ marginLeft: 22, marginTop: 6, paddingLeft: 14, borderLeft: '1px solid var(--mantine-color-gray-3)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {kids.map((k) => renderNode(k, depth + 1, next))}
          </div>
        )}
      </div>
    );
  };

  const roots = childrenOf.get(undefined) ?? [];
  return (
    <Stack gap="sm">
      {roots.length === 0 && <Text size="sm" c="dimmed">{t('org.empty')}</Text>}
      {roots.map((a) => renderNode(a, 0, new Set()))}
    </Stack>
  );
}
