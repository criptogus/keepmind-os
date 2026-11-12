import React, { useEffect } from 'react';
import { Button, Card, Group, Select, Slider, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useSettingsStore } from '../../store/settingsStore';
import { useModelOptions } from '../../lib/useModelOptions';
import { DEFAULT_MODEL } from '../../../shared/models.js';
import { useLang, type Lang } from '../../lib/i18n';
import PageHeader from '../common/PageHeader';

export default function SettingsPanel() {
  const { lang, setLang, t } = useLang();
  const { settings, loading, error, fetchSettings, updateSettings } = useSettingsStore();
  const { groups: modelGroups, updatedAt, refreshing, refresh } = useModelOptions();

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleChange = (key: keyof typeof settings, value: unknown) => {
    updateSettings({ [key]: value });
  };

  if (loading) {
    return <Text c="dimmed" ta="center" py="xl">{t('settings.loading')}</Text>;
  }

  return (
    <Stack gap="md" maw={640}>
      <PageHeader title={t('ph.settings.title')} subtitle={t('ph.settings.sub')} />

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>{t('settings.appearance')}</Text>
          <Select
            label={t('settings.theme')}
            data={[
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dark', label: t('settings.theme.dark') },
              { value: 'auto', label: t('settings.theme.auto') },
            ]}
            value={settings.theme}
            onChange={(v) => handleChange('theme', v)}
            allowDeselect={false}
          />
          <Select
            label={t('settings.language')}
            data={[
              { value: 'en', label: 'English' },
              { value: 'pt', label: t('settings.portugues') },
              { value: 'es', label: 'Español' },
            ]}
            value={settings.language}
            onChange={(v) => { handleChange('language', v); setLang((v || 'pt') as Lang); }}
            allowDeselect={false}
          />
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>{t('settings.governance')}</Text>
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={500}>{t('settings.autoApprove')}</Text>
              <Text size="xs" c="dimmed">{t('settings.autoApproveHint')}</Text>
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
          <Text fw={600}>{t('settings.execution')}</Text>
          <Group align="flex-end" gap="xs">
            <Select
              label={t('settings.defaultModel')}
              description={updatedAt ? `${t('settings.catalogUpdated')} ${new Date(updatedAt).toLocaleString()}` : t('settings.bundledCatalog')}
              style={{ flex: 1 }}
              data={modelGroups}
              value={settings.defaultModel || DEFAULT_MODEL.openai}
              onChange={(v) => handleChange('defaultModel', v)}
              allowDeselect={false}
              searchable
            />
            <Button variant="default" onClick={() => void refresh()} loading={refreshing}>
              {t('settings.refreshModels')}
            </Button>
          </Group>
          <div>
            <Text size="sm" fw={500}>{t('settings.maxConcurrent')}: {settings.maxConcurrentExecutions}</Text>
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
          <Text fw={600}>{t('settings.retention')}</Text>
          <div>
            <Text size="sm" fw={500}>{t('settings.auditDays')}: {settings.auditRetentionDays}</Text>
            <Slider
              min={7}
              max={90}
              step={1}
              value={settings.auditRetentionDays}
              onChange={(v) => handleChange('auditRetentionDays', v)}
              mb="xs"
            />
            <Text size="xs" c="dimmed">{t('settings.auditHint')}</Text>
          </div>
        </Stack>
      </Card>

      {error && (
        <Text size="sm" c="dimmed">{t('settings.error')}: {error}</Text>
      )}
    </Stack>
  );
}
