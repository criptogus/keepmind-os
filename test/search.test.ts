import { expect, it } from 'vitest';
import { searchRank } from '../src/renderer/lib/search';
it('finds Portuguese titles regardless of accents/case and combines project terms',()=>{
  expect(searchRank('REUNIAO obra','Reunião semanal','Obra central')).toBeGreaterThan(0);
  expect(searchRank('obra pagamento','Reunião semanal','Obra central')).toBe(0);
});
it('ranks exact titles ahead of prefix and context-only matches',()=>{
  expect(searchRank('Vendas','Vendas')).toBeGreaterThan(searchRank('Vendas','Vendas semanais'));
  expect(searchRank('Vendas','Vendas semanais')).toBeGreaterThan(searchRank('Vendas','Resumo','Vendas'));
  expect(searchRank('  ','Qualquer conversa')).toBeGreaterThan(0);
});

it("ranks separated or reversed title words ahead of matching context",()=>{
  expect(searchRank("leads novos","Novos leads")).toBeGreaterThan(searchRank("leads novos","Resumo","leads novos"));
  expect(searchRank("leads novos","Leads qualificados novos")).toBeGreaterThan(searchRank("leads novos","Resumo","leads novos"));
});
