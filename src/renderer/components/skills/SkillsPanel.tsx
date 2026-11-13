import SuperAgentSkillPanel from './SuperAgentSkillPanel';
import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, Group, Modal, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import type { Skill } from '../../../shared/types';
import { useLang } from '../../lib/i18n';
import PageHeader from '../common/PageHeader';

interface ToolInfo {
  name: string;
  description: string;
}

export default function SkillsPanel() {
  const { t } = useLang();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', prompt: '', toolNames: [] as string[] });
  const [improving, setImproving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{ skills: Array<{ name: string; description: string; prompt: string; toolNames: string[]; source: string; sourceRef?: string; files?: string[]; ignored?: string[] }>; skipped: Array<{ name: string; reason: string }> } | null>(null);
  const [importSel, setImportSel] = useState(0);
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketItems, setMarketItems] = useState<Array<{ id: string; name: string; description: string; source: string; tags: string[]; audience: string; version: string; featured?: boolean; installed: boolean; installedCount: number }>>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketQuery, setMarketQuery] = useState('');
  const [marketBusy, setMarketBusy] = useState<string | null>(null);

  const load = async () => {
    const [s, t] = await Promise.all([window.electronAPI.getSkills(), window.electronAPI.listSkillTools()]);
    setSkills(s);
    setTools(t);
  };

  useEffect(() => { void load(); }, []);

  const openMarketplace = async () => {
    setMarketOpen(true);
    setMarketLoading(true);
    try {
      setMarketItems(await window.electronAPI.listSkillMarketplace());
    } catch { setMarketItems([]); }
    finally { setMarketLoading(false); }
  };

  const installFromMarket = async (id: string) => {
    setMarketBusy(id);
    setError('');
    try {
      const draft = await window.electronAPI.installSkillFromMarketplace(id);
      for (const s of draft.skills) {
        await window.electronAPI.createSkill({
          name: s.name,
          description: s.description,
          prompt: s.prompt,
          toolNames: s.toolNames.filter((n) => tools.some((t) => t.name === n)),
          source: s.source,
          sourceRef: s.sourceRef,
          version: 1,
        });
      }
      setMarketItems((items) => items.map((m) => (m.id === id ? { ...m, installed: true, installedCount: m.installedCount + draft.skills.length } : m)));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('skills.importFailed'));
    } finally {
      setMarketBusy(null);
    }
  };

  const importFolder = async () => {
    setImporting(true);
    setError('');
    try {
      const draft = await window.electronAPI.importSkillFromFolder();
      if (draft.canceled) return;
      if (!draft.skills.length) throw new Error(t('skills.importFailed'));
      setImportOpen(true);
      setImportPreview(draft);
      setImportSel(0);
      setImportUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('skills.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const openNew = () => {
    setIsNew(true);
    setEditing(null);
    setForm({ name: '', description: '', prompt: '', toolNames: [] });
  };

  const openEdit = (skill: Skill) => {
    setIsNew(false);
    setEditing(skill);
    setForm({ name: skill.name, description: skill.description, prompt: skill.prompt, toolNames: skill.toolNames });
  };

  const save = async () => {
    if (!form.name.trim() || !form.prompt.trim()) {
      setError(t('skills.required'));
      return;
    }
    setError('');
    if (isNew) {
      await window.electronAPI.createSkill(form);
    } else if (editing) {
      await window.electronAPI.updateSkill(editing.id, form);
    }
    setEditing(null);
    setIsNew(false);
    await load();
  };

  const improve = async (skill: Skill) => {
    setImproving(skill.id);
    setError('');
    try {
      const res = await window.electronAPI.improveSkill(skill.id);
      setForm({ ...form, prompt: res.improvedPrompt });
      setEditing(skill);
      setIsNew(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('skills.improveFailed'));
    } finally {
      setImproving(null);
    }
  };

  const modalOpen = editing !== null || isNew;

  return (
    <Stack gap="md">
      <PageHeader
        title={t('ph.skills.title')}
        subtitle={t('ph.skills.sub')}
        help={t('ph.skills.help')}
        actions={
          <Group gap="xs">
            <Button size="xs" variant="default" onClick={() => void openMarketplace()}>{t('skills.marketplace')}</Button>
            <Button size="xs" variant="default" onClick={() => void importFolder()} loading={importing}>{t('skills.importFolder')}</Button>
            <Button size="xs" variant="default" onClick={() => { setImportOpen(true); setImportPreview(null); setImportSel(0); setImportUrl(''); }}>{t('skills.importGithub')}</Button>
            <Button size="xs" variant="default" onClick={openNew}>{t('skills.new')}</Button>
          </Group>
        }
      />

      <SuperAgentSkillPanel onInstalled={load} />

      {error && <Text size="sm" c="dimmed">{error}</Text>}

      {skills.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Text size="sm" c="dimmed" ta="center">{t('skills.empty2')}</Text>
        </Card>
      ) : (
        skills.map((skill) => (
          <Card key={skill.id} withBorder padding="md" radius="md" className="km-enter">
            <Group justify="space-between" align="flex-start">
              <div style={{ flex: 1 }}>
                <Group gap="xs">
                  <Text fw={600}>{skill.name}</Text>
                  {skill.toolNames.length > 0 && (
                    <Badge size="sm" variant="light" color="gray">{skill.toolNames.length} {t('agents.tools')}</Badge>
                  )}
                  {(skill.usageCount ?? 0) > 0 && (
                    <Badge size="sm" variant="outline" color="gray" title={skill.lastUsedAt ? `${t('skills.lastUsed')} ${new Date(skill.lastUsedAt).toLocaleString()}` : undefined}>
                      {skill.usageCount}× {t('skills.uses')}
                    </Badge>
                  )}
                </Group>
                {skill.description && <Text size="sm" c="dimmed">{skill.description}</Text>}
                <Text size="xs" c="dimmed" lineClamp={2} mt={4} style={{ whiteSpace: 'pre-wrap' }}>{skill.prompt}</Text>
              </div>
              <Group gap="xs">
                <Button size="xs" variant="subtle" color="gray" onClick={() => openEdit(skill)}>{t('common.edit')}</Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  loading={improving === skill.id}
                  onClick={() => improve(skill)}
                >
                  {t('skills.improve')}
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={async () => { if (confirm(`${t('skills.deleteConfirm')} "${skill.name}"?`)) { await window.electronAPI.deleteSkill(skill.id); await load(); } }}
                >
                  {t('common.delete')}
                </Button>
              </Group>
            </Group>
          </Card>
        ))
      )}

      <Modal opened={importOpen} onClose={() => setImportOpen(false)} title={t('skills.importTitle')} size="lg">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {t('skills.importHint')}
          </Text>
          <TextInput
            placeholder="https://github.com/owner/repo"
            value={importUrl}
            onChange={(e) => { setImportUrl(e.currentTarget.value); setImportPreview(null); setImportSel(0); }}
          />
          {importPreview && (
            <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Stack gap={4}>
                {importPreview.skills.length > 1 && (
                  <Select
                    size="xs"
                    label={t('skills.pickSkill')}
                    data={importPreview.skills.map((s, i) => ({ value: String(i), label: s.name }))}
                    value={String(importSel)}
                    onChange={(v) => setImportSel(Number(v ?? 0))}
                  />
                )}
                {importPreview.skills[importSel] && (
                  <>
                    <Text size="sm" fw={600}>{importPreview.skills[importSel].name}</Text>
                    <Text size="xs" c="dimmed">{importPreview.skills[importSel].description}</Text>
                    {importPreview.skills[importSel].toolNames.length > 0 && (
                      <Text size="xs" c="dimmed">{t('skills.toolsPrefix')}: {importPreview.skills[importSel].toolNames.join(', ')}</Text>
                    )}
                    <Text size="xs" c="dimmed" lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>{importPreview.skills[importSel].prompt}</Text>
                    {importPreview.skills[importSel].ignored && importPreview.skills[importSel].ignored!.length > 0 && (
                      <Text size="xs" c="dimmed">{t('skills.ignoredFiles')}: {importPreview.skills[importSel].ignored!.slice(0, 5).join(', ')}{importPreview.skills[importSel].ignored!.length > 5 ? '…' : ''}</Text>
                    )}
                  </>
                )}
                {importPreview.skipped.length > 0 && (
                  <Text size="xs" c="dimmed">{t('skills.skippedItems')}: {importPreview.skipped.map((s) => s.name).join(', ')}</Text>
                )}
              </Stack>
            </Card>
          )}
          {error && <Text size="sm" c="dimmed">{error}</Text>}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={() => setImportOpen(false)}>{t('common.cancel')}</Button>
            {!importPreview ? (
              <Button
                size="xs"
                loading={importing}
                disabled={!importUrl.trim()}
                onClick={async () => {
                  setImporting(true); setError('');
                  try {
                    const draft = await window.electronAPI.importSkillFromGitHub(importUrl.trim());
                    if (!draft.skills.length) throw new Error(t('skills.importFailed'));
                    setImportPreview(draft);
                    setImportSel(0);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : t('skills.importFailed'));
                  } finally { setImporting(false); }
                }}
              >
                {t('skills.fetch')}
              </Button>
            ) : (
              <Button
                size="xs"
                onClick={async () => {
                  const sel = importPreview.skills[importSel];
                  await window.electronAPI.createSkill({
                    name: sel.name,
                    description: sel.description,
                    prompt: sel.prompt,
                    toolNames: sel.toolNames.filter((n) => tools.some((t) => t.name === n)),
                    source: sel.source,
                    sourceRef: sel.sourceRef,
                    version: 1,
                  });
                  setImportOpen(false);
                  setImportPreview(null);
                  await load();
                }}
              >
                {t('skills.saveSkill')}
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>

      <Modal opened={marketOpen} onClose={() => setMarketOpen(false)} title={t('skills.marketplaceTitle')} size="lg">
        <Stack gap="sm">
          <TextInput
            placeholder={t('skills.marketplaceSearch')}
            value={marketQuery}
            onChange={(e) => setMarketQuery(e.currentTarget.value)}
          />
          {marketLoading ? (
            <Text size="sm" c="dimmed" ta="center" py="lg">{t('nav.loading')}</Text>
          ) : marketItems.filter((m) =>
            !marketQuery.trim() ||
            `${m.name} ${m.description} ${m.tags.join(' ')}`.toLowerCase().includes(marketQuery.trim().toLowerCase())
          ).length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="lg">{t('skills.marketplaceEmpty')}</Text>
          ) : (
            marketItems
              .filter((m) =>
                !marketQuery.trim() ||
                `${m.name} ${m.description} ${m.tags.join(' ')}`.toLowerCase().includes(marketQuery.trim().toLowerCase())
              )
              .sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false))
              .map((m) => (
                <Card key={m.id} withBorder padding="sm" radius="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={6}>
                        <Text size="sm" fw={600}>{m.name}</Text>
                        {m.featured && <Badge size="xs" variant="filled" color="dark">{t('skills.featured')}</Badge>}
                        {m.installed && <Badge size="xs" variant="light" color="green">{t('skills.installed')}</Badge>}
                      </Group>
                      <Text size="xs" c="dimmed">{m.description}</Text>
                      <Text size="xs" c="dimmed" mt={2}>
                        v{m.version} · {m.tags.join(', ')} · {m.source.replace(/^https:\/\/github\.com\//, '')}
                      </Text>
                    </div>
                    <Button
                      size="xs"
                      variant={m.installed ? 'light' : 'filled'}
                      color="dark"
                      loading={marketBusy === m.id}
                      onClick={() => void installFromMarket(m.id)}
                    >
                      {m.installed ? t('skills.reinstall') : t('skills.install')}
                    </Button>
                  </Group>
                </Card>
              ))
          )}
        </Stack>
      </Modal>

      <Modal opened={modalOpen} onClose={() => { setEditing(null); setIsNew(false); }} title={isNew ? t('skills.new') : `${t('common.edit')}: ${editing?.name}`} size="lg">
        <Stack gap="sm">
          <TextInput
            label={t('common.name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <TextInput
            label={t('common.description')}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
          />
          <Textarea
            label={t('skills.promptLabel')}
            description={t('skills.promptDesc')}
            minRows={8}
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.currentTarget.value })}
          />
          {tools.length > 0 && (
            <div>
              <Text size="sm" fw={500} mb={4}>{t('skills.toolsLabel')}</Text>
              <Text size="xs" c="dimmed" mb={8}>{t('skills.toolsDesc')}</Text>
              {tools.map((t) => (
                <Checkbox
                  key={t.name}
                  size="xs"
                  label={<><Text span size="sm" ff="monospace">{t.name}</Text> <Text span size="xs" c="dimmed">— {t.description}</Text></>}
                  checked={form.toolNames.includes(t.name)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      toolNames: e.currentTarget.checked
                        ? [...form.toolNames, t.name]
                        : form.toolNames.filter((n) => n !== t.name),
                    })
                  }
                  mb={4}
                />
              ))}
            </div>
          )}
          {error && <Text size="sm" c="dimmed">{error}</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setEditing(null); setIsNew(false); }}>{t('common.cancel')}</Button>
            <Button onClick={save}>{t('common.save')}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
