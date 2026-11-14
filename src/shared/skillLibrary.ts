import type { Skill } from './types';

export const SKILL_CATEGORIES = [
  { id: 'marketing', pt: 'Marketing e conteúdo', en: 'Marketing & content', terms: /marketing|copywriting|seo|geo\b|content|conteudo|social|instagram|linkedin/ },
  { id: 'sales', pt: 'Vendas e atendimento', en: 'Sales & support', terms: /sales|vendas|prospec|commercial|comercial|customer|atendimento|whatsapp/ },
  { id: 'finance', pt: 'Finanças', en: 'Finance', terms: /financ|billing|collections|fp&a|budget|faturamento/ },
  { id: 'product', pt: 'Produto e design', en: 'Product & design', terms: /product|produto|design|user research|ux\b|release notes/ },
  { id: 'engineering', pt: 'Tecnologia e automação', en: 'Technology & automation', terms: /code|codigo|develop|program|computer|delegation|autom|api\b|security|cyber/ },
  { id: 'construction', pt: 'Construção e obras', en: 'Construction', terms: /obra|construc|nr\b|licitac|sinapi/ },
  { id: 'research', pt: 'Pesquisa e conhecimento', en: 'Research & knowledge', terms: /research|pesquisa|brain|knowledge|conhecimento|internet|document|report|relatorio/ },
  { id: 'other', pt: 'Outras habilidades', en: 'Other skills', terms: /$^/ },
] as const;
export const normalizeSkillText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[-_]/g, ' ').trim();
export function skillCategory(skill: Skill): string {
  if (skill.category) return skill.category;
  // Names are stronger signals than descriptions, which often mention other disciplines.
  return SKILL_CATEGORIES.find(c => c.terms.test(normalizeSkillText(skill.name)))?.id
    ?? SKILL_CATEGORIES.find(c => c.terms.test(normalizeSkillText(skill.description)))?.id ?? 'other';
}
export function categoryLabel(id: string, lang: string): string {
  const c = SKILL_CATEGORIES.find(c => c.id === id);
  return c ? (lang === 'pt' ? c.pt : c.en) : id;
}
export function cleanSkillTags(tags: string[] = []): string[] {
  return [...new Map(tags.map(t => t.trim()).filter(Boolean).map(t => [normalizeSkillText(t), t])).values()];
}
export function skillTags(skill: Skill): string[] {
  if (skill.tags) return cleanSkillTags(skill.tags);
  const text = normalizeSkillText(`${skill.name} ${skill.description}`);
  const suggestions: [string, RegExp][] = [
    ['LinkedIn', /linkedin/], ['Instagram', /instagram/], ['SEO', /seo|search engine/],
    ['conteúdo', /content|copywriting|conteudo/], ['planejamento', /planning|planejamento|strategy|estrategia/],
    ['pesquisa', /research|pesquisa|search|prospect/], ['documentos', /document|report|relatorio|proposal/],
    ['automação', /autom|computer|delegation/], ['finanças', /financ|budget|billing/], ['obras', /obra|construc/],
  ];
  return suggestions.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}
export function skillSearchScore(skill: Skill, query: string): number {
  const terms = normalizeSkillText(query).split(/\s+/).filter(Boolean);
  const category = skillCategory(skill);
  const fields = [skill.name, skillTags(skill).join(' '), `${categoryLabel(category, 'pt')} ${categoryLabel(category, 'en')}`, skill.description, skill.toolNames.join(' '), skill.prompt].map(normalizeSkillText);
  if (!terms.every(term => fields.some(field => field.includes(term)))) return -1;
  return terms.reduce((total, term) => total + Math.max(...fields.map((field, i) => field.includes(term) ? [20, 15, 10, 5, 2, 1][i] : 0)), 0);
}
export function filterSkills(skills: Skill[], query: string, category: string | null, tags: string[], sort: string): Skill[] {
  return skills.filter(s => (!category || skillCategory(s) === category)
    && tags.every(tag => skillTags(s).some(t => normalizeSkillText(t) === normalizeSkillText(tag)))
    && skillSearchScore(s, query) >= 0).sort((a, b) => {
      if (sort === 'usage') return (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name);
      if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name);
      return skillSearchScore(b, query) - skillSearchScore(a, query) || a.name.localeCompare(b.name);
    });
}
