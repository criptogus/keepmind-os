import React, { useEffect } from 'react';
import { Button, Card, Group, Select, Slider, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { useSettingsStore } from '../../store/settingsStore';
import { useModelOptions } from '../../lib/useModelOptions';
import { DEFAULT_MODEL } from '../../../shared/models.js';

export default function SettingsPanel() {
  const { settings, loading, error, fetchSettings, updateSettings } = useSettingsStore();
  const { groups: modelGroups, updatedAt, refreshing, refresh } = useModelOptions();

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleChange = (key: keyof typeof settings, value: unknown) => {
    updateSettings({ [key]: value });
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">Loading settings...</Text>;
  }

  return (
    <Stack gap="md" maw={640}>
      <Title order={2} size="h4">Settings</Title>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Appearance</Text>
          <Select
            label="Theme"
            data={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'auto', label: 'Auto' },
            ]}
            value={settings.theme}
            onChange={(v) => handleChange('theme', v)}
            allowDeselect={false}
          />
          <Select
            label="Language"
            data={[
              { value: 'en', label: 'English' },
              { value: 'pt', label: 'Português' },
              { value: 'es', label: 'Español' },
            ]}
            value={settings.language}
            onChange={(v) => handleChange('language', v)}
            allowDeselect={false}
          />
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Governance</Text>
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={500}>Auto-approve actions</Text>
              <Text size="xs" c="dimmed">Disabling manual approval reduces security oversight</Text>
            </div>
            <Switch
              checked={settings.autoApprove}
              onChange={(e) => handleChange('autoApprove', e.currentTarget.checked)}
            />
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Execution</Text>
          <Group align="flex-end" gap="xs">
            <Select
              label="Default model"
              description={updatedAt ? `Catalog updated ${new Date(updatedAt).toLocaleString()}` : 'Using bundled catalog'}
              style={{ flex: 1 }}
              data={modelGroups}
              value={settings.defaultModel || DEFAULT_MODEL.openai}
              onChange={(v) => handleChange('defaultModel', v)}
              allowDeselect={false}
              searchable
            />
            <Button variant="default" onClick={() => void refresh()} loading={refreshing}>
              Refresh models
            </Button>
          </Group>
          <div>
            <Text size="sm" fw={500}>Max concurrent executions: {settings.maxConcurrentExecutions}</Text>
            <Slider
              min={1}
              max={10}
              step={1}
              value={settings.maxConcurrentExecutions}
              onChange={(v) => handleChange('maxConcurrentExecutions', v)}
              mb="xs"
            />
          </div>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Data retention</Text>
          <div>
            <Text size="sm" fw={500}>Audit log retention (days): {settings.auditRetentionDays}</Text>
            <Slider
              min={7}
              max={90}
              step={1}
              value={settings.auditRetentionDays}
              onChange={(v) => handleChange('auditRetentionDays', v)}
              mb="xs"
            />
            <Text size="xs" c="dimmed">Logs older than this will be automatically deleted</Text>
          </div>
        </Stack>
      </Card>

      {error && (
        <Text size="sm" c="dimmed">Error: {error}</Text>
      )}
    </Stack>
  );
}
