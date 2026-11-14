import { describe, it, expect } from 'vitest';
import { parseMentions, mentionQuery } from '../src/shared/mentions.js';

const agents = [
  { id: 'a1', name: 'Ana' },
  { id: 'a2', name: 'Beto Silva' },
];
const teams = [
  { id: 't1', name: 'Vendas' },
  { id: 't2', name: 'Suporte' },
];

describe('parseMentions', () => {
  it('matches agent at start of text', () => {
    const m = parseMentions('@Ana faz um resumo', agents, teams);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: 'agent', name: 'Ana', start: 0 });
  });

  it('matches mid-sentence after whitespace', () => {
    const m = parseMentions('oi @Ana tudo bem?', agents, teams);
    expect(m).toHaveLength(1);
    expect(m[0].name).toBe('Ana');
  });

  it('does not match email-like text', () => {
    expect(parseMentions('manda para ana@empresa.com', agents, teams)).toHaveLength(0);
    expect(parseMentions('foo@Ana.com', agents, teams)).toHaveLength(0);
  });

  it('ignores unknown names', () => {
    expect(parseMentions('@Fantasma olá', agents, teams)).toHaveLength(0);
  });

  it('matches multi-word names', () => {
    const m = parseMentions('@Beto Silva assume isso', agents, teams);
    expect(m).toHaveLength(1);
    expect(m[0].name).toBe('Beto Silva');
  });

  it('prefers longest name when names overlap', () => {
    const overlap = [
      { id: 'x', name: 'Ana' },
      { id: 'y', name: 'Ana Maria' },
    ];
    const m = parseMentions('@Ana Maria responde', overlap, []);
    expect(m[0].name).toBe('Ana Maria');
  });

  it('matches teams', () => {
    const m = parseMentions('@Vendas fecha o mês', agents, teams);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: 'team', name: 'Vendas' });
  });

  it('agent wins on name collision', () => {
    const both = [
      { id: 'a', name: 'Alpha' },
    ];
    const m = parseMentions('@Alpha hi', both, [{ id: 't', name: 'Alpha' }]);
    expect(m[0].kind).toBe('agent');
  });

  it('finds multiple mentions sorted by position', () => {
    const m = parseMentions('@Ana e @Vendas vejam isso', agents, teams);
    expect(m.map((x) => x.kind)).toEqual(['agent', 'team']);
    expect(m[0].start).toBeLessThan(m[1].start);
  });
});

describe('mentionQuery', () => {
  it('returns text after last @ before caret', () => {
    expect(mentionQuery('oi @An', 6)).toBe('An');
    expect(mentionQuery('@', 1)).toBe('');
    expect(mentionQuery('sem arroba', 11)).toBeNull();
    expect(mentionQuery('email@host', 10)).toBe('host'); // still a query; parser decides validity
  });
});
