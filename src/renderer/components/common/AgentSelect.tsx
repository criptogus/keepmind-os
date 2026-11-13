import React from 'react';
import { Group, Select, type SelectProps } from '@mantine/core';
import BotAvatar from './BotAvatar';
import { avatarForAgent } from '../../../shared/avatars';
import type { Agent } from '../../../shared/types';

interface AgentSelectProps extends Omit<SelectProps, 'data'> {
  agents: Agent[];
}

/**
 * Agent picker that shows each agent's bot avatar in the dropdown,
 * so users recognize agents visually instead of reading plain names.
 */
export default function AgentSelect({ agents, ...props }: AgentSelectProps) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  return (
    <Select
      {...props}
      data={agents.map((a) => ({ value: a.id, label: a.name }))}
      renderOption={({ option }) => {
        const agent = byId.get(option.value);
        return (
          <Group gap="xs" wrap="nowrap">
            {agent && <BotAvatar definition={avatarForAgent(agent)} name={agent.name} size={22} showBadge={false} />}
            <span>{option.label}</span>
          </Group>
        );
      }}
    />
  );
}
