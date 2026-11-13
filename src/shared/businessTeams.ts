import type { Agent, Team } from './types';
import { DEFAULT_MODEL } from './models';

export const TEAM_STARTERS = [
  { id: 'consulting', name: 'Time de entregas', priority: 'Entregar melhor para meus clientes', example: 'Preciso preparar propostas e organizar as entregas para os clientes do meu negócio.', roles: [
    { name: 'Analista de negócios', purpose: 'Organiza o contexto do cliente e identifica o que precisa ser resolvido.' },
    { name: 'Especialista em entregas', purpose: 'Transforma as informações em propostas, planos e relatórios claros.' },
  ], first: 'Prepare um modelo de proposta para um cliente do meu negócio, com objetivo, escopo, etapas e próximos passos. Marque o que ainda preciso preencher.' },
  { id: 'marketing', name: 'Time de marketing', priority: 'Atrair clientes e vender mais', example: 'Quero divulgar melhor os produtos ou serviços do meu negócio e atrair novos clientes.', roles: [
    { name: 'Estrategista de marketing', purpose: 'Ajuda a definir público, mensagem e caminhos para atrair clientes.' },
    { name: 'Criador de conteúdo', purpose: 'Prepara ideias, textos e campanhas para você revisar antes de publicar.' },
  ], first: 'Proponha um plano de divulgação de uma semana, com ideias de conteúdo e um primeiro texto de apresentação. Liste o que falta saber sobre meu público e minha oferta. Não publique nada.' },
  { id: 'operations', name: 'Time de organização', priority: 'Organizar a rotina do meu negócio', example: 'Tenho uma pequena empresa e quero organizar as demandas, os prazos e o acompanhamento do trabalho da equipe.', roles: [
    { name: 'Analista de processos', purpose: 'Identifica etapas, gargalos e informações que precisam ser organizadas.' },
    { name: 'Planejador da rotina', purpose: 'Propõe prioridades, responsáveis e uma rotina simples de acompanhamento.' },
  ], first: 'Proponha uma rotina semanal simples para organizar as demandas do meu negócio, com prioridades e um modelo de acompanhamento. Destaque as informações que ainda faltam.' },
  { id: 'general', name: 'Time de apoio ao negócio', priority: 'Tenho outro desafio / ainda não sei', example: '', roles: [
    { name: 'Analista do problema', purpose: 'Ajuda a esclarecer o desafio, as opções e as informações que faltam.' },
    { name: 'Planejador de soluções', purpose: 'Transforma o diagnóstico em próximos passos e materiais úteis.' },
  ], first: 'Ajude-me a organizar este problema em um plano inicial. Sugira um primeiro resultado útil e faça até três perguntas essenciais para avançarmos. Não invente informações sobre meu negócio.' },
] as const;
export interface BusinessTeamInput {
  requestId: string; problem: string; priority: string; name: string;
  roles: Array<{ name: string; purpose: string }>;
  firstRequest: string; provider: 'openai' | 'anthropic'; language?: 'en' | 'pt';
}
export interface BusinessTeamResult { teamId: string; coordinatorId: string; taskId: string; }
export function validateBusinessTeam(input: BusinessTeamInput): void {
  const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max;
  if (!input || !/^[\w-]{8,80}$/.test(input.requestId) || !text(input.problem, 6000) || !text(input.name, 100) || !text(input.firstRequest, 6000)
    || (input.language !== undefined && !['en','pt'].includes(input.language)) || !TEAM_STARTERS.some(t => t.id === input.priority) || !['openai', 'anthropic'].includes(input.provider)
    || !Array.isArray(input.roles) || input.roles.length < 1 || input.roles.length > 3
    || input.roles.some(r => !text(r?.name, 100) || !text(r?.purpose, 1000))) throw new Error('Confira o problema, o nome do time, os papéis e o primeiro pedido.');
}
/** Pure construction: no calls, credentials, filesystem tools or publishing permissions. */
export function buildBusinessTeam(input: BusinessTeamInput, id: () => string, now: string): { agents: Agent[]; team: Team } {
  validateBusinessTeam(input);
  const teamId = id(); const coordinatorId = id();
  const boundaries = (input.language === 'en' ? 'Respond in clear English for a nontechnical person. ' : 'Trabalhe em português claro para uma pessoa não técnica. ') + ' Use apenas o contexto fornecido. Não invente fatos, fontes, resultados ou ações executadas. Se faltar informação, indique a lacuna e peça esclarecimento. Não publique, não envie mensagens, não acesse arquivos nem sistemas externos.';
  const base = { model: DEFAULT_MODEL[input.provider], temperature: 0.3, maxTokens: 4096, computerAccess: 'workspace' as const };
  const permissions = { canAccessNetwork: true, canAccessFileSystem: false, canExecuteCode: false, maxExecutionTime: 300 };
  const specialists: Agent[] = input.roles.map(role => ({ id: id(), name: role.name.trim(), description: role.purpose.trim(), managerId: coordinatorId,
    config: { ...base, systemPrompt: `${boundaries}\nSeu papel: ${role.name}. ${role.purpose}\nContexto informado pelo cliente:\n${input.problem}`, tools: [] },
    capabilities: ['text_generation', 'reasoning'], permissions, createdAt: now, updatedAt: now }));
  const coordinator: Agent = { id: coordinatorId, name: `${input.language === 'en' ? 'Coordinator' : 'Coordenação'} · ${input.name.trim()}`, description: input.language === 'en' ? 'Your point of contact: organizes requests, involves specialists and brings deliveries for your review.' : 'Seu ponto de contato: organiza o pedido, envolve os especialistas e apresenta a entrega para sua revisão.',
    config: { ...base, systemPrompt: `${boundaries}\nVocê coordena este time e trabalha junto com o cliente. Entenda o pedido. Delegue a produção ao especialista adequado e uma revisão a outro especialista usando delegate_to_agent com os IDs abaixo. Integre as contribuições em uma entrega única e explique o próximo passo. Se a delegação falhar, informe a limitação; nunca simule participação. Não delegue a agentes fora deste time.\nTime:\n${specialists.map(a => `${a.id}: ${a.name} — ${a.description}`).join('\n')}\nContexto do negócio:\n${input.problem}`, tools: [{ name: 'delegate_to_agent', type: 'custom', config: {} }] },
    capabilities: ['text_generation', 'reasoning'], permissions, createdAt: now, updatedAt: now };
  return { agents: [coordinator, ...specialists], team: { id: teamId, name: input.name.trim(), description: input.problem.trim(), agentIds: [coordinatorId, ...specialists.map(a => a.id)], workflow: { id: id(), name: 'Pedido acompanhado pelo time', executionMode: 'sequential', steps: [{ id: id(), agentId: coordinatorId, inputs: {} }] }, createdAt: now, updatedAt: now } };
}

const ENGLISH_STARTERS = [
  { id: 'consulting', name: 'Client delivery team', priority: 'Deliver better work for my clients', example: 'I need to prepare proposals and organize deliveries for my business clients.', roles: [
    { name: 'Business analyst', purpose: 'Organizes the client context and identifies what needs to be solved.' },
    { name: 'Delivery specialist', purpose: 'Turns information into clear proposals, plans and reports.' },
  ], first: 'Prepare a proposal template for a client, including objectives, scope, steps and next actions. Mark information I still need to provide.' },
  { id: 'marketing', name: 'Marketing team', priority: 'Attract clients and grow sales', example: 'I want to promote my products or services and attract new customers.', roles: [
    { name: 'Marketing strategist', purpose: 'Helps define the audience, message and ways to reach customers.' },
    { name: 'Content creator', purpose: 'Prepares ideas, copy and campaigns for you to review before publishing.' },
  ], first: 'Suggest a one-week outreach plan, with content ideas and an initial introduction. List missing information about my audience and offer. Do not publish anything.' },
  { id: 'operations', name: 'Operations team', priority: 'Organize my business routines', example: 'I run a small business and need to organize requests, deadlines and team follow-up.', roles: [
    { name: 'Process analyst', purpose: 'Identifies steps, bottlenecks and information to organize.' },
    { name: 'Operations planner', purpose: 'Suggests priorities, owners and a simple tracking routine.' },
  ], first: 'Suggest a simple weekly routine for managing requests, with priorities and a tracking template. Highlight missing information.' },
  { id: 'general', name: 'Business support team', priority: 'Another challenge / not sure yet', example: '', roles: [
    { name: 'Problem analyst', purpose: 'Helps clarify the challenge, options and missing information.' },
    { name: 'Solution planner', purpose: 'Turns the diagnosis into next steps and useful materials.' },
  ], first: 'Help me turn this problem into an initial plan. Suggest a useful first outcome and ask up to three essential questions. Do not invent facts about my business.' },
];
export function businessStarters(language: 'en' | 'pt') {
  return language === 'en' ? ENGLISH_STARTERS : TEAM_STARTERS;
}
