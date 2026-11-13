import type { WorkEvent } from '../../shared/work';

const eventLabels: Record<string, [string, string]> = {
  created: ['Request saved', 'Pedido salvo'], started: ['Work started', 'Trabalho iniciado'],
  delivered: ['Delivery ready', 'Entrega pronta'], accepted: ['Delivery approved', 'Entrega aprovada'],
  revision: ['Change requested', 'Ajuste solicitado'], comment: ['Message', 'Mensagem'],
  cancelled: ['Request cancelled', 'Pedido cancelado'], failed: ['Needs attention', 'Precisa de atenção'],
  interrupted: ['Work interrupted', 'Trabalho interrompido'],
  'rule-proposed': ['Rule proposed', 'Regra proposta'], 'rule-reviewed': ['Rule reviewed', 'Regra revisada'],
};
const systemMessages: Record<string, string> = {
  'Task created': 'Pedido criado', 'Execution started': 'Execução iniciada',
  'Result ready for review': 'Entrega pronta para revisão',
  'Delivered automatically; no human acceptance claimed': 'Entrega automática, ainda sem aceite de uma pessoa',
  'Result accepted': 'Entrega aceita', 'Cancellation requested': 'Cancelamento solicitado',
};
/** Translate only known system copy; customer messages and diagnostic evidence stay verbatim. */
export function workEventLabel(event: WorkEvent, lang: 'en' | 'pt') {
  return {
    label: eventLabels[event.kind]?.[lang === 'pt' ? 1 : 0] ?? (lang === 'pt' ? 'Atividade' : 'Activity'),
    text: lang === 'pt' && !['comment', 'revision', 'rule-proposed'].includes(event.kind)
      ? systemMessages[event.text] ?? event.text : event.text,
  };
}
