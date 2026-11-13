import React, { useEffect } from 'react';
import { Button, Card, Checkbox, Group, Select, Slider, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useSettingsStore } from '../../store/settingsStore';
import { useModelOptions } from '../../lib/useModelOptions';
import { DEFAULT_MODEL } from '../../../shared/models.js';
import { useLang, type Lang } from '../../lib/i18n';
import PageHeader from '../common/PageHeader';
import { setSfxEnabled, setSfxEvent, type SfxEvent } from '../../lib/sfx';
import { useAppMode } from '../../lib/useAppMode';

export default function SettingsPanel() {
  const { lang, setLang, t } = useLang();
  const { settings, loading, error, fetchSettings, updateSettings } = useSettingsStore();
  const { groups: modelGroups, updatedAt, refreshing, refresh } = useModelOptions();
  const { mode: appMode, setMode: setAppMode } = useAppMode();

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const SFX_EVENTS: SfxEvent[] = ['attention', 'done', 'error', 'start'];
  const soundEvents = new Set((settings.soundEvents || 'attention,done,error,start').split(',').filter(Boolean));

  useEffect(() => {
    setSfxEnabled(settings.soundEffects === true);
    for (const ev of SFX_EVENTS) setSfxEvent(ev, soundEvents.has(ev));
  }, [settings.soundEffects, settings.soundEvents]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Select
            label={t('settings.mode')}
            description={t('settings.modeDesc')}
            data={[
              { value: 'personal', label: t('ob.modePersonal') },
              { value: 'corporate', label: t('ob.modeCorporate') },
            ]}
            value={appMode === 'unset' ? null : appMode}
            placeholder={t('mode.bannerTitle')}
            onChange={(v) => { if (v === 'personal' || v === 'corporate') void setAppMode(v); }}
            allowDeselect={false}
          />
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>{t('settings.governance')}</Text>
          <Text size="sm">{t('settings.autonomyPolicy')}</Text>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="sm" fw={500}>{t('settings.sound')}</Text>
              <Text size="xs" c="dimmed">{t('settings.soundHint')}</Text>
            </div>
            <Switch
              checked={settings.soundEffects === true}
              onChange={(e) => handleChange('soundEffects', e.currentTarget.checked)}
            />
          </Group>
          {settings.soundEffects === true && (
            <Stack gap={4} pl="md">
              {SFX_EVENTS.map((ev) => (
                <Checkbox
                  key={ev}
                  size="sm"
                  label={t(`settings.sfx.${ev}`)}
                  checked={soundEvents.has(ev)}
                  onChange={(e) => {
                    const next = new Set(soundEvents);
                    if (e.currentTarget.checked) next.add(ev); else next.delete(ev);
                    handleChange('soundEvents', [...next].join(','));
                  }}
                />
              ))}
            </Stack>
          )}
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
      <details className="km-details"><summary>{lang === 'pt' ? 'Opções avançadas de memória' : 'Advanced memory options'}</summary>
      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>{lang === 'pt' ? 'Memória semântica local' : 'Local semantic memory'}</Text>
          <Switch label={lang === 'pt' ? 'Combinar busca por palavras e significado' : 'Combine keyword and semantic search'} checked={settings.memorySemanticSearch === true} onChange={e => handleChange('memorySemanticSearch', e.currentTarget.checked)} />
          <TextInput label="Embedding model" value={settings.memoryEmbeddingModel || 'nomic-embed-text'} onChange={e => handleChange('memoryEmbeddingModel', e.currentTarget.value)} />
          <Text size="xs" c="dimmed">{lang === 'pt' ? 'Opcional: requer um servidor local compatível com OpenAI na porta 11434 e o modelo instalado. Indexa até 32 memórias por busca. Se indisponível, usa palavras-chave. Nenhum modelo é baixado automaticamente.' : 'Optional: requires a local OpenAI-compatible server on port 11434 with the model installed. Indexes up to 32 memories per search. Falls back to keywords if unavailable. No automatic model downloads.'}</Text>
        </Stack>
      </Card>
      </details>
    </Stack>
  );
}

