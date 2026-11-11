import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { useGovernanceStore } from '../../store/governanceStore';
import { useAgentStore } from '../../store/agentStore';
import { useTeamStore } from '../../store/teamStore';
import { v4 as uuidv4 } from 'uuid';
import type { GovernanceRule, RuleCondition, RuleAction } from '../../../shared/types.js';

const emptyRule: Partial<GovernanceRule> = {
  name: '',
  type: 'approval_required',
  scope: 'global',
  condition: { field: 'action', operator: 'contains', value: '' },
  action: { type: 'require_approval' },
  enabled: true,
};

export default function GovernanceRules() {
  const { rules, loading, error, fetchRules, setRule, deleteRule } = useGovernanceStore();
  const { agents } = useAgentStore();
  const { teams } = useTeamStore();

  const [newRule, setNewRule] = useState<Partial<GovernanceRule>>(emptyRule);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleAddRule = async () => {
    if (!newRule.name) return;

    const rule: GovernanceRule = {
      id: uuidv4(),
      name: newRule.name!,
      type: newRule.type as any,
      scope: newRule.scope as any,
      scopeId: newRule.scopeId,
      condition: newRule.condition as RuleCondition,
      action: newRule.action as RuleAction,
      enabled: newRule.enabled ?? true,
    };

    await setRule(rule);
    setNewRule(emptyRule);
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (confirm('Are you sure you want to delete this rule?')) {
      await deleteRule(ruleId);
    }
  };

  const getScopeName = (scope: string, scopeId?: string) => {
    if (!scopeId) return 'Global';
    if (scope === 'agent') {
      const agent = agents.find(a => a.id === scopeId);
      return agent?.name || 'Unknown Agent';
    }
    if (scope === 'team') {
      const team = teams.find(t => t.id === scopeId);
      return team?.name || 'Unknown Team';
    }
    return scopeId;
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">Loading rules...</Text>;
  }

  const scopeOptions = newRule.scope === 'agent'
    ? agents.map((a) => ({ value: a.id, label: a.name }))
    : teams.map((t) => ({ value: t.id, label: t.name }));

  return (
    <Stack gap="md">
      <Title order={2} size="h4">Governance Rules</Title>

      {error && <Text size="sm" c="dimmed">{error}</Text>}

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Add new rule</Text>
          <TextInput
            label="Rule name"
            placeholder="e.g., Require approval for file deletion"
            value={newRule.name || ''}
            onChange={(e) => setNewRule({ ...newRule, name: e.currentTarget.value })}
          />
          <Select
            label="Rule type"
            data={[
              { value: 'approval_required', label: 'Approval Required' },
              { value: 'rate_limit', label: 'Rate Limit' },
              { value: 'resource_constraint', label: 'Resource Constraint' },
              { value: 'content_filter', label: 'Content Filter' },
            ]}
            value={newRule.type}
            onChange={(v) => setNewRule({ ...newRule, type: (v || 'approval_required') as any })}
            allowDeselect={false}
          />
          <Select
            label="Scope"
            data={[
              { value: 'global', label: 'Global' },
              { value: 'agent', label: 'Agent' },
              { value: 'team', label: 'Team' },
            ]}
            value={newRule.scope}
            onChange={(v) => setNewRule({ ...newRule, scope: (v || 'global') as any, scopeId: undefined })}
            allowDeselect={false}
          />
          {newRule.scope !== 'global' && (
            <Select
              label={newRule.scope === 'agent' ? 'Select agent' : 'Select team'}
              data={scopeOptions}
              value={newRule.scopeId || null}
              onChange={(v) => setNewRule({ ...newRule, scopeId: v || undefined })}
              placeholder="Select..."
            />
          )}
          <Select
            label="Condition field"
            data={[
              { value: 'action', label: 'Action' },
              { value: 'input', label: 'Input' },
              { value: 'output', label: 'Output' },
              { value: 'agent', label: 'Agent' },
            ]}
            value={newRule.condition?.field || 'action'}
            onChange={(v) => setNewRule({
              ...newRule,
              condition: { ...newRule.condition!, field: v || 'action' } as RuleCondition,
            })}
            allowDeselect={false}
          />
          <Select
            label="Condition operator"
            data={[
              { value: 'equals', label: 'Equals' },
              { value: 'contains', label: 'Contains' },
              { value: 'greater_than', label: 'Greater Than' },
              { value: 'less_than', label: 'Less Than' },
              { value: 'regex', label: 'Regex' },
            ]}
            value={newRule.condition?.operator || 'contains'}
            onChange={(v) => setNewRule({
              ...newRule,
              condition: { ...newRule.condition!, operator: (v || 'contains') as any } as RuleCondition,
            })}
            allowDeselect={false}
          />
          <TextInput
            label="Condition value"
            placeholder="e.g., delete, send, execute"
            value={String(newRule.condition?.value || '')}
            onChange={(e) => setNewRule({
              ...newRule,
              condition: { ...newRule.condition!, value: e.currentTarget.value } as RuleCondition,
            })}
          />
          <Select
            label="Action type"
            data={[
              { value: 'block', label: 'Block' },
              { value: 'require_approval', label: 'Require Approval' },
              { value: 'limit', label: 'Limit' },
              { value: 'warn', label: 'Warn' },
            ]}
            value={newRule.action?.type || 'require_approval'}
            onChange={(v) => setNewRule({
              ...newRule,
              action: { ...newRule.action!, type: (v || 'require_approval') as any } as RuleAction,
            })}
            allowDeselect={false}
          />
          <Group justify="flex-end">
            <Button size="xs" onClick={handleAddRule} disabled={!newRule.name}>Add rule</Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Existing rules</Text>
          {rules.length === 0 ? (
            <Text size="sm" c="dimmed">No governance rules configured</Text>
          ) : (
            rules.map((rule) => (
              <Card key={rule.id} withBorder padding="sm" radius="sm">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Group gap="xs">
                      <Text size="sm" fw={600}>{rule.name}</Text>
                      <Badge size="sm" variant="light" color="gray">{rule.enabled ? 'enabled' : 'disabled'}</Badge>
                    </Group>
                    <Text size="xs" c="dimmed" mt={4}>
                      {rule.type} · {rule.scope} ({getScopeName(rule.scope, rule.scopeId)})
                    </Text>
                    <Text size="xs" c="dimmed">
                      {rule.condition.field} {rule.condition.operator} {String(rule.condition.value)} → {rule.action.type}
                    </Text>
                  </div>
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={() => handleDeleteRule(rule.id)}>
                    Delete
                  </Button>
                </Group>
              </Card>
            ))
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
