import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, Group, Modal, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import type { Skill } from '../../../shared/types';

interface ToolInfo {
  name: string;
  description: string;
}

export default function SkillsPanel() {
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
  const [importPreview, setImportPreview] = useState<{ name: string; description: string; prompt: string; toolNames: string[]; source: string } | null>(null);

  const load = async () => {
    const [s, t] = await Promise.all([window.electronAPI.getSkills(), window.electronAPI.listSkillTools()]);
    setSkills(s);
    setTools(t);
  };

  useEffect(() => { void load(); }, []);

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
      setError('Name and prompt are required');
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
      setError(e instanceof Error ? e.message : 'Improvement failed');
    } finally {
      setImproving(null);
    }
  };

  const modalOpen = editing !== null || isNew;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={2} size="h4">Skills</Title>
          <Text size="sm" c="dimmed">
            Reusable prompt modules with tool access. Assign skills to agents in the agent editor.
          </Text>
        </div>
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => { setImportOpen(true); setImportPreview(null); setImportUrl(''); }}>Import from GitHub</Button>
          <Button size="xs" variant="default" onClick={openNew}>New skill</Button>
        </Group>
      </Group>

      {error && <Text size="sm" c="dimmed">{error}</Text>}

      {skills.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Text size="sm" c="dimmed" ta="center">No skills yet. Create one to give agents specialized capabilities.</Text>
        </Card>
      ) : (
        skills.map((skill) => (
          <Card key={skill.id} withBorder padding="md" radius="md">
            <Group justify="space-between" align="flex-start">
              <div style={{ flex: 1 }}>
                <Group gap="xs">
                  <Text fw={600}>{skill.name}</Text>
                  {skill.toolNames.length > 0 && (
                    <Badge size="sm" variant="light" color="gray">{skill.toolNames.length} tool{skill.toolNames.length > 1 ? 's' : ''}</Badge>
                  )}
                  {(skill.usageCount ?? 0) > 0 && (
                    <Badge size="sm" variant="outline" color="gray" title={skill.lastUsedAt ? `Last used ${new Date(skill.lastUsedAt).toLocaleString()}` : undefined}>
                      used {skill.usageCount}×
                    </Badge>
                  )}
                </Group>
                {skill.description && <Text size="sm" c="dimmed">{skill.description}</Text>}
                <Text size="xs" c="dimmed" lineClamp={2} mt={4} style={{ whiteSpace: 'pre-wrap' }}>{skill.prompt}</Text>
              </div>
              <Group gap="xs">
                <Button size="xs" variant="subtle" color="gray" onClick={() => openEdit(skill)}>Edit</Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  loading={improving === skill.id}
                  onClick={() => improve(skill)}
                >
                  Improve with AI
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={async () => { if (confirm(`Delete skill "${skill.name}"?`)) { await window.electronAPI.deleteSkill(skill.id); await load(); } }}
                >
                  Delete
                </Button>
              </Group>
            </Group>
          </Card>
        ))
      )}

      <Modal opened={importOpen} onClose={() => setImportOpen(false)} title="Import skill from GitHub" size="lg">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Paste a GitHub repo or file URL containing a SKILL.md (with optional frontmatter: name, description, tools).
          </Text>
          <TextInput
            placeholder="https://github.com/owner/repo"
            value={importUrl}
            onChange={(e) => { setImportUrl(e.currentTarget.value); setImportPreview(null); }}
          />
          {importPreview && (
            <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Stack gap={4}>
                <Text size="sm" fw={600}>{importPreview.name}</Text>
                <Text size="xs" c="dimmed">{importPreview.description}</Text>
                {importPreview.toolNames.length > 0 && (
                  <Text size="xs" c="dimmed">Tools: {importPreview.toolNames.join(', ')}</Text>
                )}
                <Text size="xs" c="dimmed" lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>{importPreview.prompt}</Text>
              </Stack>
            </Card>
          )}
          {error && <Text size="sm" c="dimmed">{error}</Text>}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={() => setImportOpen(false)}>Cancel</Button>
            {!importPreview ? (
              <Button
                size="xs"
                loading={importing}
                disabled={!importUrl.trim()}
                onClick={async () => {
                  setImporting(true); setError('');
                  try {
                    const draft = await window.electronAPI.importSkillFromGitHub(importUrl.trim());
                    setImportPreview(draft);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Import failed');
                  } finally { setImporting(false); }
                }}
              >
                Fetch
              </Button>
            ) : (
              <Button
                size="xs"
                onClick={async () => {
                  await window.electronAPI.createSkill({
                    name: importPreview.name,
                    description: importPreview.description,
                    prompt: importPreview.prompt,
                    toolNames: importPreview.toolNames.filter((n) => tools.some((t) => t.name === n)),
                  });
                  setImportOpen(false);
                  setImportPreview(null);
                  await load();
                }}
              >
                Save skill
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>

      <Modal opened={modalOpen} onClose={() => { setEditing(null); setIsNew(false); }} title={isNew ? 'New skill' : `Edit: ${editing?.name}`} size="lg">
        <Stack gap="sm">
          <TextInput
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <TextInput
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
          />
          <Textarea
            label="Prompt"
            description="Instructions injected into the agent's system prompt when this skill is active."
            minRows={8}
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.currentTarget.value })}
          />
          {tools.length > 0 && (
            <div>
              <Text size="sm" fw={500} mb={4}>Tools</Text>
              <Text size="xs" c="dimmed" mb={8}>The LLM can call these during execution.</Text>
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
            <Button variant="default" onClick={() => { setEditing(null); setIsNew(false); }}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
