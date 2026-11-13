import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dict } from '../src/renderer/lib/i18n';
import { AGENT_TEMPLATES } from '../src/renderer/lib/agentTemplates';
import { NICHE_PACKS } from '../src/renderer/lib/nichePacks';
import { localizeTemplate, localizePack } from '../src/renderer/lib/catalogLanguage';
import { skillLabel } from '../src/renderer/lib/skillLanguage';
import { nativeMenuTemplate } from '../src/main/ui/nativeMenu';
import { materialFilename } from '../src/shared/materials';
import { businessStarters, buildBusinessTeam } from '../src/shared/businessTeams';

describe('interface language contracts', () => {
  it('has both translations for every literal renderer translation key', () => {
    const files: string[] = [];
    const walk = (dir: string) => readdirSync(dir, {withFileTypes:true}).forEach(entry => {
      const path=join(dir,entry.name); if(entry.isDirectory())walk(path);else if(path.endsWith('.tsx'))files.push(path);
    });
    walk('src/renderer');
    let count=0;
    for(const file of files) for(const match of readFileSync(file,'utf8').matchAll(/\bt\(['"]([^'"]+)['"]\)/g)) {
      count++; expect(dict[match[1]], `${file}: ${match[1]}`).toBeDefined();
      expect(dict[match[1]].pt.trim()).not.toBe(''); expect(dict[match[1]].en.trim()).not.toBe('');
    }
    expect(count).toBeGreaterThan(200);
  });
  it('localizes the built-in catalog without changing tools or permission configuration', () => {
    for(const template of [...AGENT_TEMPLATES,...NICHE_PACKS.flatMap(pack=>pack.agents)]) {
      const pt=localizeTemplate(template,'pt'); const en=localizeTemplate(template,'en');
      expect(pt.name).not.toBe(en.name);
      expect(pt.toolNames).toEqual(template.toolNames);
      expect(pt.skillNames).toEqual(template.skillNames);
    }
    for(const pack of NICHE_PACKS)expect(localizePack(pack,'pt').name).not.toBe(pack.name);
  });
  it('never rewrites custom skill descriptions or persisted instructions', () => {
    const custom={name:'Second Brain',description:'Minha descrição personalizada'};
    expect(skillLabel(custom,'pt')).toBe(custom);
  });
  it('generates new business teams in the selected language and preserves customer input', () => {
    const starter=businessStarters('en')[1]; let id=0;
    const built=buildBusinessTeam({requestId:'language-test',problem:'Meu contexto original',priority:starter.id,name:starter.name,roles:starter.roles.map(role=>({...role})),firstRequest:starter.first,provider:'openai',language:'en'},()=>String(++id),'2026-11-13');
    expect(built.agents[0].name).toContain('Coordinator');
    for(const agent of built.agents) { expect(agent.config.systemPrompt).toContain('Respond in clear English'); expect(agent.config.systemPrompt).toContain('Meu contexto original'); }
  });
  it('localizes desktop menu labels while keeping native keyboard roles', () => {
    const pt=nativeMenuTemplate('pt',true);const en=nativeMenuTemplate('en',true);
    expect(pt.map(menu=>menu.label)).toContain('Editar');expect(en.map(menu=>menu.label)).toContain('Edit');
    expect(JSON.stringify(pt)).toContain('"role":"copy"');expect(JSON.stringify(pt)).not.toContain('"label":"Copy"');
  });
  it('keeps downloaded versions distinguishable and strips path separators', () => {
    expect(materialFilename('Proposta / cliente · Versão 2','pdf')).toBe('Proposta-cliente-Versao-2.pdf');
    expect(materialFilename('../','pptx')).toBe('entrega.pptx');
    expect(materialFilename('Proposta · Versão 1','pdf')).not.toBe(materialFilename('Proposta · Versão 2','pdf'));
  });
});
