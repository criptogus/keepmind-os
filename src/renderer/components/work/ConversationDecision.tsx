import React from 'react';
import { Button, Text } from '@mantine/core';
import { useLang } from '../../lib/i18n';
import type { ConversationInput, ConversationDecision as Decision } from '../../../shared/conversation';
import DecisionCard from './DecisionCard';

export default function ConversationDecision({ decision, busy, canRevise, hasDelivery, onAnswer, onFocus, onConfigure }: {
  decision: Decision; busy: boolean; canRevise: boolean; hasDelivery: boolean;
  onAnswer: (choice: NonNullable<ConversationInput['choice']>, text?: string) => void; onFocus: () => void; onConfigure?: () => void;
}) {
  const { lang } = useLang(); const tr = (en: string, pt: string) => lang === 'pt' ? pt : en;
  const title = decision.kind === 'configure' ? tr('Configure in conversation', 'Configurar pela conversa') : decision.kind === 'start' ? tr('Ready to begin?', 'Podemos começar?') : decision.kind === 'intent' ? tr('What would you like to do?', 'Como você quer continuar?') : tr('One detail before we begin', 'Um detalhe antes de começar');
  return <DecisionCard title={title} status={tr('Waiting for you', 'Aguarda você')} actions={<>
    {decision.kind === 'configure' && onConfigure && <Button className="km-primary-action" disabled={busy} onClick={onConfigure}>{tr('Prepare configuration','Preparar configuração')}</Button>}
    {decision.kind === 'clarify' && <>{decision.choices.map((choice, i) => <Button variant="default" key={i} disabled={busy} onClick={() => onAnswer('clarify', choice)}>{choice}</Button>)}<Button variant="subtle" disabled={busy} onClick={onFocus}>{tr('Write my answer', 'Escrever minha resposta')}</Button></>}
    {decision.kind === 'start' && <><Button className="km-primary-action" disabled={busy} onClick={() => onAnswer('start')}>{tr('Start delivery', 'Iniciar entrega')}</Button><Button variant="default" disabled={busy} onClick={onFocus}>{tr('Adjust the brief', 'Ajustar o pedido')}</Button></>}
    {decision.kind === 'intent' && <><Button variant="default" disabled={busy} onClick={() => onAnswer('answer')}>{tr('Answer my question', 'Responder minha pergunta')}</Button>{canRevise && <Button className="km-primary-action" disabled={busy} onClick={() => onAnswer('revise')}>{hasDelivery ? tr('Create a new version', 'Criar nova versão') : tr('Try the updated request', 'Tentar o pedido ajustado')}</Button>}<Button variant="default" disabled={busy} onClick={() => onAnswer('note')}>{tr('Keep as a comment', 'Guardar como comentário')}</Button></>}
    <Button variant="subtle" disabled={busy} onClick={() => onAnswer('dismiss')}>{tr('Not now', 'Agora não')}</Button>
  </>}><Text style={{whiteSpace:'pre-wrap'}}>{decision.prompt}</Text>{decision.kind === 'start' && <Text size="xs" c="dimmed" mt="sm">{tr('Starting uses your AI account. External actions still need their own authorization.', 'Iniciar usa sua conta de IA. Ações externas continuam exigindo autorização própria.')}</Text>}</DecisionCard>;
}
