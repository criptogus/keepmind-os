import { canReviseWork } from '../../shared/work.js';
import { randomUUID } from 'node:crypto';
import { conversationInputSchema, conversationReplySchema, type ConversationInput } from '../../shared/conversation.js';
import type { AgentExecution } from '../../shared/types.js';
import { WorkManager } from './WorkManager.js';

interface ConversationActions {
  respond: (agentId: string, input: Record<string, unknown>) => Promise<AgentExecution>;
  start: (id: string) => void;
}
/** Persisted dialogue is separate from delivery versions. Only explicit work intent reaches start. */
export class WorkConversation {
  constructor(private work: WorkManager, private actions: ConversationActions) {}
  async send(id: string, raw: ConversationInput, expectedRevision: number) {
    const input = conversationInputSchema.parse(raw);
    const task = this.work.get(id);
    const key = JSON.stringify(input);
    const prior = task.conversation?.turns.find(t => t.id === input.requestId);
    if (prior) { if (prior.requestKey !== key) throw new Error('Message ID reused'); return task; }
    if (task.revision !== expectedRevision) throw new Error('Conversation changed. Refresh before sending.');
    if (task.conversation?.pending) throw new Error('A reply is already being prepared');
    const decision = task.conversation?.decision;
    if (input.choice && (!decision || decision.id !== input.decisionId)) throw new Error('This decision is no longer current');
    if (input.choice === 'revise' && !canReviseWork(task)) throw new Error('This request cannot be revised yet');
    if (input.decisionId && !input.choice) throw new Error('Decision answer required');
    const allowed = decision?.kind === 'start' ? ['start', 'clarify', 'dismiss'] : decision?.kind === 'intent' ? ['answer', 'revise', 'note', 'dismiss'] : ['clarify', 'dismiss'];
    if (input.choice && !allowed.includes(input.choice)) throw new Error('Invalid decision choice');
    const tr = (pt: string, en: string) => input.language === 'pt' ? pt : en;
    const sourceText = input.text || (input.choice === 'answer' || input.choice === 'revise' || input.choice === 'note' ? decision?.sourceText : '') || '';
    if (!sourceText && !['start', 'dismiss'].includes(input.choice || '') && input.mode !== 'prepare') throw new Error('Write a message first');
    const mode = input.mode === 'prepare' || (decision && decision.kind !== 'intent' && input.choice === 'clarify') ? 'prepare' : 'message';
    if (mode === 'prepare' && (task.output || task.status !== 'backlog')) throw new Error('Only a new draft can be prepared');
    this.work.updateConversation(id, c => {
      c.error = undefined; c.decision = undefined; c.pending = input.requestId;
      c.turns.push({ id: input.requestId, requestKey: key, at: new Date().toISOString(), role: 'user', text: sourceText || (input.choice === 'start' ? tr('Pode começar.', 'Start the work.') : input.choice === 'dismiss' ? tr('Agora não.', 'Not now.') : task.goal) });
    });
    const finish = (reply: string) => this.work.updateConversation(id, c => {
      c.pending = undefined; c.error = undefined;
      c.turns.push({id: randomUUID(), at: new Date().toISOString(), role: 'assistant', text: reply});
    });
    try {
      if (input.choice === 'dismiss') return finish(tr('Tudo bem. Você pode continuar a conversa quando quiser.', 'You can continue the conversation whenever you like.'));
      if (input.choice === 'start') {
        finish(tr('Vou preparar a primeira entrega com o contexto combinado.', 'I will prepare the first delivery using the agreed context.'));
        this.actions.start(id); return this.work.get(id);
      }
      if (task.status === 'running') {
        finish(tr('Guardei sua mensagem para a próxima revisão. Ela não altera o trabalho que já está em andamento.', 'Your message is saved for the next revision. It does not change work already in progress.'));
        return this.work.change(id, 'comment', sourceText);
      }
      if (input.choice === 'note') return finish(tr('Comentário registrado, sem alterar a entrega.', 'Comment saved without changing the delivery.'));
      if (input.choice === 'revise') {
        finish(task.output ? tr('Seu ajuste vai iniciar uma nova versão.', 'Your change will start a new version.') : tr('Vou tentar novamente com o pedido ajustado.', 'I will try again using your updated request.'));
        this.work.change(id, 'revise', sourceText); this.actions.start(id); return this.work.get(id);
      }
      // Exact acknowledgements are local; mixed messages still need interpretation.
      if (mode === 'message' && /^(obrigad[oa]|muito obrigad[oa]|valeu|thanks|thank you|thank you very much)[!.\s]*$/i.test(sourceText)) {
        return finish(tr('Por nada. A entrega continua disponível aqui.', 'You are welcome. Your delivery stays here.'));
      }
      const result = await this.actions.respond(task.agentId, {
        workTaskId: id, conversationMode: mode, language: input.language, forcedIntent: input.choice === 'answer' ? 'answer' : undefined,
        task: sourceText || task.goal, goal: task.goal, criteria: task.criteria,
        previousDelivery: task.output?.slice(0, 30000),
        conversation: this.work.get(id).conversation!.turns.slice(-16).map(t => ({role:t.role,text:t.text})),
      });
      // Cancel/restart invalidates the pending turn; late replies never change a delivery.
      if (this.work.get(id).conversation?.pending !== input.requestId) return this.work.get(id);
      if (result.status !== 'completed') throw new Error(result.error || 'Conversation failed');
      const content = String(result.output?.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      const reply = conversationReplySchema.parse(JSON.parse(content));
      if (mode === 'prepare' && !['clarify', 'ready', 'configure'].includes(reply.intent)) throw new Error('Invalid preparation reply');
      if (mode === 'message' && reply.intent === 'ready') throw new Error('Invalid conversation reply');
      if (input.choice === 'answer' && reply.intent !== 'answer') throw new Error('Expected an answer without changes');
      finish(reply.reply);
      if (reply.intent === 'revise' && canReviseWork(task)) {
        this.work.change(id, 'revise', sourceText); this.actions.start(id);
      } else if (reply.intent === 'configure' || reply.intent === 'ready' || reply.intent === 'clarify' || reply.intent === 'ambiguous' || reply.intent === 'revise') {
        this.work.updateConversation(id, c => { c.decision = {
          id: randomUUID(), kind: reply.intent === 'configure' ? 'configure' : reply.intent === 'ready' ? 'start' : mode === 'prepare' && reply.intent === 'clarify' ? 'clarify' : 'intent',
          prompt: reply.reply, choices: reply.choices, sourceText, language: input.language,
        }; });
      }
      return this.work.get(id);
    } catch (error) {
      if (this.work.get(id).conversation?.pending === input.requestId || (!this.work.get(id).conversation?.pending && this.work.get(id).status !== 'cancelled' && this.work.get(id).conversation?.turns.filter(t => t.role === 'user').at(-1)?.id === input.requestId)) {
        this.work.updateConversation(id, c => { c.pending = undefined; c.error = error instanceof Error ? error.message : String(error); });
      }
      throw error;
    }
  }
}
