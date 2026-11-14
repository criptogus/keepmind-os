import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageManager } from '../src/main/storage/StorageManager';
import { parseSkillMarkdown } from '../src/main/integrations/SkillImporter';
import { filterSkills, skillCategory, skillTags } from '../src/shared/skillLibrary';
import type { Skill } from '../src/shared/types';
const skill = (changes: Partial<Skill> = {}): Skill => ({ id: 's1', name: 'Planejamento de conteúdo', description: 'Calendário editorial para LinkedIn', prompt: 'Pesquise fontes e faça um calendário.', toolNames: ['web_search'], createdAt: '2026-01-01', updatedAt: '2026-01-01', ...changes });
describe('skill library', () => {
  it('combines accent-insensitive terms across fields and requires every term', () => {
    expect(filterSkills([skill()], 'CONTEUDO fontes', null, [], 'relevance')).toHaveLength(1);
    expect(filterSkills([skill()], 'conteudo contratos', null, [], 'relevance')).toHaveLength(0);
  });
  it('ranks names above instruction matches and combines category and tags', () => {
    const named = skill({ id: 'name', name: 'SEO', tags: ['Busca', 'Web'] });
    const body = skill({ id: 'body', name: 'Outros', description: '', prompt: 'SEO', category: 'other' });
    expect(filterSkills([body, named], 'seo', null, [], 'relevance').map(s => s.id)).toEqual(['name', 'body']);
    expect(filterSkills([named, body], '', 'marketing', ['busca', 'WEB'], 'relevance')).toEqual([named]);
  });
  it('suggests legacy metadata while respecting explicitly cleared tags and edited categories', () => {
    expect(skillCategory(skill())).toBe('marketing');
    expect(skillTags(skill())).toContain('LinkedIn');
    expect(skillTags(skill({ tags: [] }))).toEqual([]);
    expect(skillCategory(skill({ category: 'research' }))).toBe('research');
  });
  it('retains metadata, prompt, permissions and provenance across database reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'km-skill-library-'));
    let db = new StorageManager(dir);
    try {
      db.saveSkill(skill({ category: 'marketing', tags: ['LinkedIn', 'Conteúdo'], source: 'local:test', usageCount: 8 }));
      db.saveSkill(skill({ id: 'legacy' }));
      db.close(); db = new StorageManager(dir);
      const current = db.getSkill('s1')!;
      db.saveSkill({ ...current, prompt: 'Proposta revisada' });
      expect(db.getSkill('s1')).toMatchObject({ category: 'marketing', tags: ['LinkedIn', 'Conteúdo'], source: 'local:test', usageCount: 8, toolNames: ['web_search'], prompt: 'Proposta revisada' });
      expect(db.getSkill('legacy')?.tags).toBeUndefined();
      expect(skillTags(db.getSkill('legacy')!)).toContain('LinkedIn');
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('migrates an existing database without losing legacy skill data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'km-skill-migrate-'));
    let db = new StorageManager(dir);
    db.saveSkill(skill({ source: 'local:existing', version: 3 })); db.close();
    const legacy = new DatabaseSync(join(dir, 'keepmind-os.db'));
    legacy.exec('ALTER TABLE skills DROP COLUMN category; ALTER TABLE skills DROP COLUMN tags;'); legacy.close();
    try {
      db = new StorageManager(dir);
      expect(db.getSkill('s1')).toMatchObject({ name: skill().name, prompt: skill().prompt, toolNames: ['web_search'], source: 'local:existing', version: 3 });
      expect(skillCategory(db.getSkill('s1')!)).toBe('marketing');
      db.saveSkill({ ...db.getSkill('s1')!, tags: ['teste'], category: 'research' });
      expect(db.getSkill('s1')).toMatchObject({ tags: ['teste'], category: 'research' });
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('preserves imported category and inline or block tags', () => {
    expect(parseSkillMarkdown('---\nname: Test\ncategory: marketing\ntags: [SEO, "LinkedIn"]\n---\nInstructions', 'local:test')).toMatchObject({ category: 'marketing', tags: ['SEO', 'LinkedIn'] });
    expect(parseSkillMarkdown('---\nname: Test\ntags:\n  - SEO\n  - LinkedIn\n---\nInstructions', 'local:test').tags).toEqual(['SEO', 'LinkedIn']);
  });
});
