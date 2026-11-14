import SuperAgentSkillPanel from './SuperAgentSkillPanel';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Group, Modal, MultiSelect, Select, Stack, Tabs, TagsInput, Text, Textarea, TextInput, Title } from '@mantine/core';
import type { Skill } from '../../../shared/types';
import { useLang } from '../../lib/i18n';
import { SKILL_CATEGORIES, categoryLabel, cleanSkillTags, filterSkills, skillCategory, skillTags } from '../../../shared/skillLibrary';
import PageHeader from '../common/PageHeader';

interface ToolInfo {
  name: string;
  description: string;
}

export default function SkillsPanel() {
  const { t, lang } = useLang();
  const copy = (pt: string, en: string) => lang === 'pt' ? pt : en;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState('relevance');
  const [tab, setTab] = useState<string | null>('installed');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [improveOpen, setImproveOpen] = useState(false);
  const [improveId, setImproveId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ skill: Skill; prompt: string } | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', prompt: '', toolNames: [] as string[], category: '', tags: [] as string[] });
  const [improving, setImproving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{ skills: Array<{ name: string; description: string; prompt: string; toolNames: string[]; source: string; sourceRef?: string; category?: string; tags?: string[]; files?: string[]; ignored?: string[] }>; skipped: Array<{ name: string; reason: string }> } | null>(null);
  const [importSel, setImportSel] = useState(0);
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketItems, setMarketItems] = useState<Array<{ id: string; name: string; description: string; source: string; tags: string[]; audience: string; version: string; featured?: boolean; installed: boolean; installedCount: number }>>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketQuery, setMarketQuery] = useState('');
  const [marketBusy, setMarketBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const [s, t] = await Promise.all([window.electronAPI.getSkills(), window.electronAPI.listSkillTools()]);
      setSkills(s); setTools(t);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
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
          category: s.category,
          tags: s.tags ?? marketItems.find(item => item.id === id)?.tags,
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
    setError('');
    setIsNew(true);
    setEditing(null);
    setForm({ name: '', description: '', prompt: '', toolNames: [], category: '', tags: [] });
  };

  const openEdit = (skill: Skill) => {
    setError('');
    setIsNew(false);
    setEditing(skill);
    setForm({ name: skill.name, description: skill.description, prompt: skill.prompt, toolNames: skill.toolNames, category: skillCategory(skill), tags: skillTags(skill) });
  };

  const save = async () => {
    if (!form.name.trim() || !form.prompt.trim()) {
      setError(t('skills.required'));
      return;
    }
    setError('');
    setSaving(true);
    try {
      const values = { ...form, tags: cleanSkillTags(form.tags), category: form.category || undefined };
      if (isNew) await window.electronAPI.createSkill(values);
      else if (editing) await window.electronAPI.updateSkill(editing.id, values);
      setEditing(null); setIsNew(false); await load();
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  const improve = async (skill: Skill) => {
    setImproving(skill.id); setError(''); setProposal(null);
    try {
      const res = await window.electronAPI.improveSkill(skill.id);
      setProposal({ skill, prompt: res.improvedPrompt });
    } catch (e) { setError(e instanceof Error ? e.message : t('skills.improveFailed')); }
    finally { setImproving(null); }
  };
  const startImprove = (skill?: Skill) => {
    setImproveId(skill?.id ?? null); setProposal(null); setError(''); setImproveOpen(true);
  };
  const availableTags = useMemo(() => cleanSkillTags(skills.flatMap(skillTags)).sort(), [skills]);
  const categories = useMemo(() => [...new Set([...SKILL_CATEGORIES.map(c => c.id), ...skills.map(skillCategory)])]
    .map(id => ({ value: id, label: categoryLabel(id, lang) })), [skills, lang]);
  const visibleSkills = useMemo(() => filterSkills(skills, query, category, tags, sort), [skills, query, category, tags, sort]);
  const groups = useMemo(() => categories.map(c => ({ ...c, skills: visibleSkills.filter(s => skillCategory(s) === c.value) })).filter(c => c.skills.length), [categories, visibleSkills]);

  const modalOpen = editing !== null || isNew;

  return (
    <Stack gap="md">
      <PageHeader
        title={t('ph.skills.title')}
        subtitle={t('ph.skills.sub')}
        help={t('ph.skills.help')}
        actions={
          <Group gap="xs">
            <Button size="xs" className="km-primary-action" disabled={!skills.length} onClick={() => startImprove()}>{t('skills.improve')}</Button>
            <Button size="xs" variant="default" onClick={() => void openMarketplace()}>{t('skills.marketplace')}</Button>
            <Button size="xs" variant="default" onClick={() => void importFolder()} loading={importing}>{t('skills.importFolder')}</Button>
            <Button size="xs" variant="default" onClick={() => { setImportOpen(true); setImportPreview(null); setImportSel(0); setImportUrl(''); }}>{t('skills.importGithub')}</Button>
            <Button size="xs" variant="default" onClick={openNew}>{t('skills.new')}</Button>
          </Group>
        }
      />

      <Tabs value={tab} onChange={setTab} keepMounted>
        <Tabs.List>
          <Tabs.Tab value="installed">{copy('Minhas habilidades', 'My skills')} · {skills.length}</Tabs.Tab>
          <Tabs.Tab value="discover">SuperAgentSkill · {copy('Descobrir', 'Discover')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="discover" pt="md"><SuperAgentSkillPanel onInstalled={load} /></Tabs.Panel>
        <Tabs.Panel value="installed" pt="lg">
          <Stack gap="md">
            <TextInput label={copy('Buscar habilidades', 'Search skills')}
              placeholder={copy('Nome, descrição, tag ou trecho das instruções…', 'Name, description, tag or instructions…')}
              value={query} onChange={e => setQuery(e.currentTarget.value)} />
            <Group align="flex-end" grow>
              <Select label={copy('Categoria', 'Category')} placeholder={copy('Todas as categorias', 'All categories')}
                clearable searchable data={categories.map(c => ({ ...c, label: `${c.label} (${skills.filter(s => skillCategory(s) === c.value).length})` }))}
                value={category} onChange={setCategory} />
              <MultiSelect label="Tags" placeholder={copy('Todas as tags', 'All tags')} searchable clearable data={availableTags} value={tags} onChange={setTags} />
              <Select label={copy('Ordenar por', 'Sort by')} value={sort} onChange={v => setSort(v ?? 'relevance')}
                data={[{ value: 'relevance', label: copy('Relevância / nome', 'Relevance / name') }, { value: 'usage', label: copy('Mais usadas', 'Most used') }, { value: 'updated', label: copy('Atualizadas recentemente', 'Recently updated') }]} />
            </Group>
            <Text size="xs" c="dimmed">{copy('Categorias e tags são sugeridas para habilidades antigas. Use Editar para personalizar.', 'Categories and tags are suggested for existing skills. Use Edit to customize.')}</Text>
            <Group justify="space-between">
              <Text size="sm" c="dimmed" role="status">{visibleSkills.length} / {skills.length} {copy('habilidades', 'skills')}</Text>
              {(query || category || tags.length > 0) && <Button size="xs" variant="subtle" color="gray" onClick={() => { setQuery(''); setCategory(null); setTags([]); }}>{copy('Limpar filtros', 'Clear filters')}</Button>}
            </Group>
            {error && !modalOpen && !improveOpen && <Alert color="red" role="alert">{error}</Alert>}
            {loading ? <Text role="status">{t('nav.loading')}</Text> : !skills.length ?
              <Text c="dimmed">{t('skills.empty2')}</Text> : !visibleSkills.length ?
              <Text c="dimmed">{copy('Nenhuma habilidade encontrada. Tente outro termo ou limpe os filtros.', 'No skills found. Try another term or clear the filters.')}</Text> :
              groups.map(group => <section key={group.value} aria-label={group.label}>
                <Group gap="xs" mb="sm"><Title order={3} size="h4">{group.label}</Title><Text size="sm" c="dimmed">{group.skills.length}</Text></Group>
                {group.skills.map(skill => <div key={skill.id} className="km-skill-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Group gap="xs"><Text fw={600}>{skill.name}</Text>
                      {(skill.usageCount ?? 0) > 0 && <Badge color="gray" variant="outline" title={skill.lastUsedAt ? `${t('skills.lastUsed')} ${new Date(skill.lastUsedAt).toLocaleString()}` : undefined}>{skill.usageCount}× {t('skills.uses')}</Badge>}
                    </Group>
                    <Text size="sm" c="dimmed">{skill.description}</Text>
                    <Group gap={6} mt={8}>
                      {skillTags(skill).map(tag => <Button key={tag} size="compact-xs" variant={tags.includes(tag) ? 'light' : 'default'} color="gray" aria-pressed={tags.includes(tag)} onClick={() => setTags(old => old.includes(tag) ? old.filter(t => t !== tag) : [...old, tag])}>{tag}</Button>)}
                      <Text size="xs" c="dimmed">{skill.toolNames.length} {t('agents.tools')}</Text>
                    </Group>
                    <details className="km-skill-instructions"><summary>{copy('Ver instruções', 'View instructions')}</summary><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{skill.prompt}</Text></details>
                  </div>
                  <Group gap="xs" className="km-skill-actions">
                    <Button size="xs" variant="default" onClick={() => startImprove(skill)}>{t('skills.improve')}</Button>
                    <Button size="xs" variant="subtle" color="gray" onClick={() => openEdit(skill)}>{t('common.edit')}</Button>
                    <Button size="xs" variant="subtle" color="gray" onClick={async () => {
                      if (confirm(`${t('skills.deleteConfirm')} "${skill.name}"?`)) {
                        try { await window.electronAPI.deleteSkill(skill.id); await load(); } catch (e) { setError(String(e)); }
                      }
                    }}>{t('common.delete')}</Button>
                  </Group>
                </div>)}
              </section>)}
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Modal opened={improveOpen} onClose={() => { if (!improving && !saving) setImproveOpen(false); }} title={t('skills.improve')} size="xl" closeOnClickOutside={!improving && !saving} closeOnEscape={!improving && !saving} withCloseButton={!improving && !saving}>
        <Stack>
          <Text size="sm" c="dimmed">{copy('A IA configurada no KeepMind propõe instruções mais claras com base na skill e no histórico de uso. Você revisa antes de aplicar. Pode haver custo do provedor.', 'Your configured KeepMind AI proposes clearer instructions using the skill and its usage history. Review before applying. Provider charges may apply.')}</Text>
          <Select label={copy('Habilidade para melhorar', 'Skill to improve')} searchable data={skills.map(s => ({ value: s.id, label: s.name }))} value={improveId} disabled={!!improving || !!proposal} onChange={setImproveId} />
          {error && <Alert color="red" role="alert">{error}</Alert>}
          {proposal ? <>
            <Alert color="gray">{copy('Esta é uma proposta, ainda não testada em tarefas reais. Nome, tags, categoria e ferramentas serão preservados.', 'This is a proposal, not yet tested on real tasks. Name, tags, category and tools will be preserved.')}</Alert>
            <div className="km-skill-compare">
              <Textarea label={copy('Instruções atuais', 'Current instructions')} value={proposal.skill.prompt} readOnly minRows={12} autosize maxRows={20} />
              <Textarea label={copy('Proposta de melhoria', 'Proposed improvement')} value={proposal.prompt} onChange={e => setProposal({ ...proposal, prompt: e.currentTarget.value })} minRows={12} autosize maxRows={20} />
            </div>
            <Group justify="flex-end">
              <Button variant="default" disabled={saving} onClick={() => { setProposal(null); setImproveOpen(false); }}>{copy('Descartar proposta', 'Discard proposal')}</Button>
              <Button className="km-primary-action" loading={saving} disabled={!proposal.prompt.trim()} onClick={async () => {
                setSaving(true); setError('');
                try { await window.electronAPI.updateSkill(proposal.skill.id, { prompt: proposal.prompt }); await load(); setImproveOpen(false); setProposal(null); }
                catch (e) { setError(String(e)); } finally { setSaving(false); }
              }}>{copy('Aplicar melhoria', 'Apply improvement')}</Button>
            </Group>
          </> : <Button className="km-primary-action" loading={!!improving} disabled={!improveId} onClick={() => { const skill = skills.find(s => s.id === improveId); if (skill) void improve(skill); }}>{copy('Gerar proposta de melhoria', 'Generate improvement proposal')}</Button>}
        </Stack>
      </Modal>

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
            <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-default-hover)' }}>
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
                    category: sel.category,
                    tags: sel.tags,
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
                        {m.installed && <Badge size="xs" variant="light" color="lime">{t('skills.installed')}</Badge>}
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
          <Select label={copy('Categoria', 'Category')} placeholder={copy('Sugerir automaticamente', 'Suggest automatically')} clearable searchable data={categories} value={form.category || null} onChange={v => setForm({ ...form, category: v ?? '' })} />
          <TagsInput label="Tags" description={copy('Digite uma tag e pressione Enter. Use vírgula para separar várias.', 'Type a tag and press Enter. Separate multiple tags with commas.')} data={availableTags} value={form.tags} onChange={value => setForm({ ...form, tags: value })} />
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
            <Button loading={saving} onClick={save}>{t('common.save')}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
