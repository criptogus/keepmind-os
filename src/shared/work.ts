export type WorkStatus = 'backlog' | 'running' | 'review' | 'done' | 'blocked' | 'cancelled';
export interface WorkEvent { actorId?: string; id: string; at: string; kind: string; text: string; }
export interface WorkTask {
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
  { id: 'review', goalPt: 'Revise o repositório em [caminho ou URL]. Encontre problemas reproduzíveis de funcionamento e confiabilidade. Leia CONTRIBUTING.md e AGENTS.md primeiro. Não altere arquivos.', criteriaPt: 'Inclua referências aos arquivos, impacto, passos para reproduzir e correções priorizadas. Separe problemas verificados de hipóteses.', title: 'Review a repository', titlePt: 'Revisar um repositório', goal: 'Review the repository at [path or URL]. Find reproducible correctness and reliability issues. Read CONTRIBUTING.md and AGENTS.md first. Do not change files.', criteria: 'Findings include file references, impact, reproduction steps and prioritized fixes. Clearly distinguish verified bugs from hypotheses.' },
  { id: 'release', goalPt: 'Prepare um relatório de prontidão para lançamento de [repositório]. Confira mudanças, testes, compatibilidade, migração e documentação. Escreva as notas de lançamento. Não publique nem crie tags.', criteriaPt: 'Inclua evidências das verificações, impedimentos, instruções de atualização e notas de lançamento. Só declare que um teste passou se ele foi executado.', title: 'Prepare a release', titlePt: 'Preparar uma release', goal: 'Prepare a release readiness report for [repository]. Inspect changes, tests, compatibility, migration steps and documentation. Draft release notes. Do not publish or tag.', criteria: 'Include evidence for checks, blockers, upgrade instructions and release notes. Never claim a check passed unless it was executed.' },
  { id: 'docs', goalPt: 'Revise os primeiros passos de [repositório]. Identifique pré-requisitos ausentes, comandos quebrados e etapas confusas. Proponha uma alteração concisa na documentação.', criteriaPt: 'Uma pessoa nova deve conseguir seguir os passos. Inclua as alterações propostas e os comandos que foram verificados.', title: 'Improve developer docs', titlePt: 'Melhorar documentação', goal: 'Audit the getting-started experience for [repository]. Identify missing prerequisites, broken commands and confusing steps. Propose a concise documentation patch.', criteria: 'A new contributor can follow the documented steps. Include the proposed changes and which commands were actually verified.' },
] as const;

export interface WorkPreview {
  agentName: string; model: string; tools: string[]; monthlyBudgetUsd?: number;
  dependencies: Array<{ id: string; title: string; accepted: boolean }>;
}
export interface WorkContext {
  snapshot: WorkSnapshot; agents: import('./types.js').Agent[]; approvals: import('./types.js').Approval[];
  connection: { mode: 'local' | 'remote'; actor: string; role: string; projects?: string[]; serverTime?: string };
}
