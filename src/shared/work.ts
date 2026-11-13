export type WorkStatus = 'backlog' | 'running' | 'review' | 'done' | 'blocked' | 'cancelled';
export interface WorkEvent { actorId?: string; id: string; at: string; kind: string; text: string; }
export interface DeliveryVersion { version: number; content: string; at: string; executionId?: string; }
export interface WorkTask {
  deliveries?: DeliveryVersion[];
  /** Legacy tasks with no policy retain mandatory review. */
  reviewRequired?: boolean;
  completedAt?: string;
  creationHash?: string;
  id: string; title: string; goal: string; project: string; agentId: string;
  ownerId: string; status: WorkStatus; revision: number;
  criteria: string; dependencies: string[]; events: WorkEvent[];
  executionId?: string; output?: string; error?: string;
  createdAt: string; updatedAt: string; acceptedAt?: string;
}
export interface WorkRule {
  id: string; project: string; text: string; previousText?: string; version: number;
  status: 'proposed' | 'active' | 'retired'; sourceTaskId: string; createdAt: string;
}
export interface WorkSnapshot { tasks: WorkTask[]; rules: WorkRule[]; }
export interface CreateWorkInput { reviewRequired?: boolean; goal: string; project?: string; agentId: string; criteria?: string; dependencies?: string[]; }
export type WorkAction = 'resume' | 'run' | 'accept' | 'revise' | 'cancel' | 'comment' | 'propose-rule';
export const WORK_TEMPLATES = [
  { id: 'proposal', title: 'Prepare a client proposal', titlePt: 'Proposta para um cliente', goal: 'Help me draft a proposal for a client. Identify the context you need and provide an editable outline.', goalPt: 'Ajude-me a preparar uma proposta para um cliente. Indique o contexto que precisa e monte uma estrutura que eu possa completar.', criteria: 'Clear scope, missing information and next steps.', criteriaPt: 'Escopo claro, informações que faltam e próximos passos.' },
  { id: 'marketing', title: 'Plan my outreach', titlePt: 'Plano de divulgação', goal: 'Suggest a one-week outreach plan for my business. Ask about my audience and offer. Do not publish anything.', goalPt: 'Sugira um plano de divulgação de uma semana para meu negócio. Pergunte sobre meu público e minha oferta. Não publique nada.', criteria: 'Practical ideas and a draft for review.', criteriaPt: 'Ideias práticas e um rascunho para revisão.' },
  { id: 'routine', title: 'Organize my week', titlePt: 'Organizar minha semana', goal: 'Help me organize my business priorities for the week. Ask about deadlines and current commitments.', goalPt: 'Ajude-me a organizar as prioridades do meu negócio nesta semana. Pergunte sobre prazos e compromissos atuais.', criteria: 'Priorities, next actions and missing information.', criteriaPt: 'Prioridades, próximas ações e informações que faltam.' },
] as const;

export interface WorkPreview {
  agentName: string; model: string; tools: string[]; monthlyBudgetUsd?: number;
  dependencies: Array<{ id: string; title: string; accepted: boolean }>;
}
export interface WorkContext {
  snapshot: WorkSnapshot; agents: import('./types.js').Agent[]; approvals: import('./types.js').Approval[];
  connection: { mode: 'local' | 'remote'; actor: string; role: string; projects?: string[]; serverTime?: string };
}

export function deliveryState(task: WorkTask) {
  const version = task.deliveries?.at(-1)?.version ?? (task.output ? Math.max(1, task.events.filter(e => e.kind === 'delivered').length) : 0);
  const lastDelivery = task.events.map(e => e.kind).lastIndexOf('delivered');
  const updating = task.events.map(e => e.kind).lastIndexOf('revision') > lastDelivery;
  return { version, updating, nextVersion: version + 1 };
}
