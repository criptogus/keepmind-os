import { expect, it } from 'vitest';
import { chatChoices } from '../src/shared/chatChoices';
it('extracts answer options while preserving surrounding Markdown', () => {
 const result=chatChoices('**Qual objetivo?**\n\nA) Gerar leads\nB) Vender mais\nC) Outro\n\nPode escrever também.');
 expect(result?.options.map(o=>o.label)).toEqual(['Gerar leads','Vender mais','Outro']);
 expect(result?.before).toContain('**Qual objetivo?**');
 expect(result?.after).toContain('Pode escrever também.');
});
it('does not turn code, incomplete, repeated or unrelated lists into actions', () => {
 for(const text of ['Exemplo?\n```\nA) foo\nB) bar\n```','Pergunta?\nA) foo','Pergunta?\nA) foo\nC) bar','Pergunta?\nA) foo\nTexto\nB) bar','Lista\nA) foo\nB) bar']) expect(chatChoices(text)).toBeNull();
});
