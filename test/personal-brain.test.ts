import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PersonalBrainManager } from '../src/main/integrations/PersonalBrainManager.js';
import { containsPii } from '../src/main/integrations/SecondBrainManager.js';

describe('PersonalBrainManager', () => {
  let dir: string;
  let brain: PersonalBrainManager;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pb-'));
    brain = new PersonalBrainManager(dir);
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('remembers and searches across vault files', async () => {
    await brain.remember('Prefiro café sem açúcar', 'prefs.md');
    await brain.remember('Aniversário da Maria em março', 'family.md');
    expect(await brain.search('café açúcar')).toContain('prefs.md');
    expect(await brain.search('Maria março')).toContain('family.md');
    expect(await brain.search('xyz inexistente')).toBe('');
  });

  it('sanitizes file names and lists files', async () => {
    await brain.remember('nota', '../evil name!.md');
    const files = await brain.list();
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
    expect(files.every((f) => !f.includes('..'))).toBe(true);
  });
});

describe('containsPii', () => {
  it('flags CPF, phone and card numbers', () => {
    expect(containsPii('cpf 123.456.789-09 aqui')).toBe(true);
    expect(containsPii('liga (11) 99999-8888')).toBe(true);
    expect(containsPii('cartão 4111 1111 1111 1111')).toBe(true);
  });
  it('allows corporate text and emails', () => {
    expect(containsPii('Reunião de pipeline com joao@corp.com dia 12/05')).toBe(false);
    expect(containsPii('Receita Q3: R$ 1.234.567,89')).toBe(false);
  });
});
