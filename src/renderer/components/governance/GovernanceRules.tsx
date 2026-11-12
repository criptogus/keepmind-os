import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useGovernanceStore } from '../../store/governanceStore';
import { useAgentStore } from '../../store/agentStore';
import { useTeamStore } from '../../store/teamStore';
import { v4 as uuidv4 } from 'uuid';
import type { GovernanceRule, RuleCondition, RuleAction } from '../../../shared/types.js';
import { useLang } from '../../lib/i18n';
import PageHeader from '../common/PageHeader';

const emptyRule: Partial<GovernanceRule> = {
  name: '',
  type: 'approval_required',
  scope: 'global',
  condition: { field: 'action', operator: 'contains', value: '' },
  action: { type: 'require_approval' },
  enabled: true,
};

export default function GovernanceRules() {
  const { t } = useLang();
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
    if (confirm(t('govr.deleteConfirm'))) {
      await deleteRule(ruleId);
    }
  };

  const getScopeName = (scope: string, scopeId?: string) => {
    if (!scopeId) return t('govr.global');
    if (scope === 'agent') {
      const agent = agents.find(a => a.id === scopeId);
      return agent?.name || t('teams.unknownAgent');
    }
    if (scope === 'team') {
      const team = teams.find(t => t.id === scopeId);
      return team?.name || t('govr.unknownTeam');
    }
    return scopeId;
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">{t('govr.loading')}</Text>;
  }

  const scopeOptions = newRule.scope === 'agent'
    ? agents.map((a) => ({ value: a.id, label: a.name }))
    : teams.map((t) => ({ value: t.id, label: t.name }));

  return (
    <Stack gap="md">
      <PageHeader title={t('govr.title')} subtitle={t('ph.gov.sub')} help={t('ph.gov.help')} />

      {error && <Text size="sm" c="dimmed">{error}</Text>}

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>{t('govr.addTitle')}</Text>
          <TextInput
            label={t('govr.ruleName')}
            placeholder={t('govr.ruleNamePh')}
            value={newRule.name || ''}
            onChange={(e) => setNewRule({ ...newRule, name: e.currentTarget.value })}
          />
          <Select
            label={t('govr.ruleType')}
            data={[
              { value: 'approval_required', label: t('govr.type.approval') },
              { value: 'rate_limit', label: t('govr.type.rate') },
              { value: 'resource_constraint', label: t('govr.type.resource') },
              { value: 'content_filter', label: t('govr.type.content') },
            ]}
            value={newRule.type}
            onChange={(v) => setNewRule({ ...newRule, type: (v || 'approval_required') as any })}
            allowDeselect={false}
          />
          <Select
            label={t('govr.scope')}
            data={[
              { value: 'global', label: t('govr.scope.global') },
              { value: 'agent', label: t('govr.scope.agent') },
              { value: 'team', label: t('govr.scope.team') },
            ]}
            value={newRule.scope}
            onChange={(v) => setNewRule({ ...newRule, scope: (v || 'global') as any, scopeId: undefined })}
            allowDeselect={false}
          />
          {newRule.scope !== 'global' && (
            <Select
              label={newRule.scope === 'agent' ? t('govr.selectAgent') : t('govr.selectTeam')}
              data={scopeOptions}
              value={newRule.scopeId || null}
              onChange={(v) => setNewRule({ ...newRule, scopeId: v || undefined })}
              placeholder={t('govr.selectPh')}
            />
          )}
          <Select
            label={t('govr.condField')}
            data={[
              { value: 'action', label: t('govr.field.action') },
              { value: 'input', label: t('govr.field.input') },
              { value: 'output', label: t('govr.field.output') },
              { value: 'agent', label: t('govr.field.agent') },
            ]}
            value={newRule.condition?.field || 'action'}
            onChange={(v) => setNewRule({
              ...newRule,
              condition: { ...newRule.condition!, field: v || 'action' } as RuleCondition,
            })}
            allowDeselect={false}
          />
          <Select
            label={t('govr.condOp')}
            data={[
              { value: 'equals', label: t('govr.op.equals') },
              { value: 'contains', label: t('govr.op.contains') },
              { value: 'greater_than', label: t('govr.op.gt') },
              { value: 'less_than', label: t('govr.op.lt') },
              { value: 'regex', label: t('govr.op.regex') },
            ]}
            value={newRule.condition?.operator || 'contains'}
            onChange={(v) => setNewRule({
              ...newRule,
              condition: { ...newRule.condition!, operator: (v || 'contains') as any } as RuleCondition,
            })}
            allowDeselect={false}
          />
          <TextInput
            label={t('govr.condValue')}
            placeholder={t('govr.condValuePh')}
            value={String(newRule.condition?.value || '')}
            onChange={(e) => setNewRule({
              ...newRule,
              condition: { ...newRule.condition!, value: e.currentTarget.value } as RuleCondition,
            })}
          />
          <Select
            label={t('govr.actionType')}
            data={[
              { value: 'block', label: t('govr.act.block') },
              { value: 'require_approval', label: t('govr.act.approval') },
              { value: 'limit', label: t('govr.act.limit') },
              { value: 'warn', label: t('govr.act.warn') },
            ]}
            value={newRule.action?.type || 'require_approval'}
            onChange={(v) => setNewRule({
              ...newRule,
              action: { ...newRule.action!, type: (v || 'require_approval') as any } as RuleAction,
            })}
            allowDeselect={false}
          />
          <Group justify="flex-end">
            <Button size="xs" onClick={handleAddRule} disabled={!newRule.name}>{t('govr.addRule')}</Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>{t('govr.existing')}</Text>
          {rules.length === 0 ? (
            <Text size="sm" c="dimmed">{t('govr.none')}</Text>
          ) : (
            rules.map((rule) => (
              <Card key={rule.id} withBorder padding="sm" radius="sm">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Group gap="xs">
                      <Text size="sm" fw={600}>{rule.name}</Text>
                      <Badge size="sm" variant="light" color="gray">{rule.enabled ? t('govr.enabled') : t('govr.disabled')}</Badge>
                    </Group>
                    <Text size="xs" c="dimmed" mt={4}>
                      {rule.type} · {rule.scope} ({getScopeName(rule.scope, rule.scopeId)})
                    </Text>
                    <Text size="xs" c="dimmed">
                      {rule.condition.field} {rule.condition.operator} {String(rule.condition.value)} → {rule.action.type}
                    </Text>
                  </div>
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={() => handleDeleteRule(rule.id)}>
                    {t('common.delete')}
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
