import { expect, it } from 'vitest';
import { approvalCopy } from '../src/shared/approvalCopy';
it('replaces internal identifiers in legacy approval cards with plain language', () => {
  const copy = approvalCopy('tool:app_status');
  expect(copy.title).toBe('Consultar o status do aplicativo');
  expect(JSON.stringify(copy)).not.toMatch(/tool:|app_status|\*\*/);
});
it('shows team scope and whether its first task will actually run', () => {
  const draft = approvalCopy('tool:app_team_create', { name: 'Marketing', firstRequest: 'Plano de 7 dias', startFirstTask: false });
  expect(draft.description).toContain('rascunho'); expect(draft.detail).toContain('Plano de 7 dias');
  expect(approvalCopy('tool:app_team_create', { startFirstTask: true }).description).toContain('consumir créditos');
});
