import type { AgentTemplate } from './agentTemplates';
import type { NichePack } from './nichePacks';
const pt: Record<string, string[]> = {
  "ceo": [
    "Direção executiva",
    "Executivo",
    "Estratégia, prioridades e comunicação com a empresa"
  ],
  "cfo": [
    "Direção financeira",
    "Executivo",
    "Orçamentos, previsões e riscos financeiros"
  ],
  "cto": [
    "Direção de tecnologia",
    "Executivo",
    "Estratégia tecnológica, arquitetura e engenharia"
  ],
  "cmo": [
    "Direção de marketing",
    "Executivo",
    "Marca, geração de demanda e entrada no mercado"
  ],
  "coo": [
    "Direção de operações",
    "Executivo",
    "Processos e acompanhamento da execução"
  ],
  "chro": [
    "Direção de pessoas",
    "Executivo",
    "Contratação, cultura e organização da equipe"
  ],
  "ciso": [
    "Direção de segurança",
    "Executivo",
    "Segurança da informação, riscos e conformidade"
  ],
  "cpo": [
    "Direção de produto",
    "Executivo",
    "Estratégia de produto, descoberta e prioridades"
  ],
  "cro": [
    "Direção de receita",
    "Executivo",
    "Vendas, oportunidades e operações comerciais"
  ],
  "general-counsel": [
    "Assessoria jurídica",
    "Jurídico",
    "Contratos, conformidade e riscos jurídicos"
  ],
  "personal-assistant": [
    "Assistente pessoal",
    "Pessoal",
    "Tarefas diárias, lembretes e respostas rápidas"
  ],
  "research-analyst": [
    "Analista de pesquisa",
    "Pessoal",
    "Pesquisa, comparação e resumo de informações"
  ],
  "content-writer": [
    "Redator",
    "Pessoal",
    "E-mails, publicações, textos e revisões"
  ],
  "life-organizer": [
    "Organizador pessoal",
    "Pessoal",
    "Objetivos, hábitos, agenda e decisões"
  ],
  "legal-intake": [
    "Atendimento inicial",
    "Jurídico",
    "Organiza consultas, conflitos e urgência de novos casos"
  ],
  "legal-research": [
    "Pesquisador jurídico",
    "Jurídico",
    "Pesquisa referências e precedentes para os casos"
  ],
  "legal-drafter": [
    "Redator de documentos",
    "Jurídico",
    "Prepara minutas e documentos para revisão"
  ],
  "clinic-scheduler": [
    "Assistente de agendamento",
    "Clínica",
    "Organiza horários, confirmações e disponibilidade"
  ],
  "clinic-comms": [
    "Comunicação com pacientes",
    "Clínica",
    "Prepara orientações e mensagens para pacientes"
  ],
  "clinic-billing": [
    "Assistente de cobrança",
    "Clínica",
    "Organiza cobranças e pendências de pagamento"
  ],
  "acct-recon": [
    "Analista de conciliação",
    "Contabilidade",
    "Compara registros e identifica diferenças"
  ],
  "acct-fiscal": [
    "Acompanhamento de prazos",
    "Contabilidade",
    "Organiza obrigações e prazos fiscais"
  ],
  "acct-reports": [
    "Analista de relatórios",
    "Contabilidade",
    "Prepara relatórios financeiros para clientes"
  ],
  "re-leads": [
    "Qualificador de contatos",
    "Imobiliário",
    "Organiza interesse, orçamento e prazo de compradores"
  ],
  "re-listings": [
    "Redator de anúncios",
    "Imobiliário",
    "Prepara descrições e anúncios de imóveis"
  ],
  "re-followup": [
    "Coordenador de acompanhamento",
    "Imobiliário",
    "Acompanha contatos, negociações e próximos passos"
  ],
  "mkt-strategist": [
    "Estrategista de conteúdo",
    "Marketing",
    "Planeja calendário, temas e campanhas"
  ],
  "mkt-copywriter": [
    "Redator de marketing",
    "Marketing",
    "Prepara publicações para LinkedIn, X e Instagram"
  ],
  "mkt-designer": [
    "Diretor de arte",
    "Marketing",
    "Prepara orientações visuais e revisa consistência da marca"
  ],
  "mkt-seo": [
    "Especialista em busca",
    "Marketing",
    "Otimiza conteúdo para buscadores e respostas de IA"
  ],
  "fin-analyst": [
    "Analista financeiro",
    "Finanças",
    "Analisa margens, variações e sinais de atenção"
  ],
  "fin-fpa": [
    "Planejador financeiro",
    "Finanças",
    "Prepara orçamentos, cenários e projeções"
  ],
  "fin-billing": [
    "Faturamento e cobrança",
    "Finanças",
    "Acompanha recebíveis, cobranças e inconsistências"
  ],
  "sales-sdr": [
    "Prospector comercial",
    "Vendas",
    "Pesquisa contatos e prepara primeiras abordagens"
  ],
  "sales-proposals": [
    "Redator de propostas",
    "Vendas",
    "Prepara propostas, orçamentos e acompanhamentos"
  ],
  "sales-pipeline": [
    "Gestor de oportunidades",
    "Vendas",
    "Organiza etapas, previsões e próximas ações"
  ],
  "prod-pm": [
    "Gerente de produto",
    "Produto",
    "Estrutura problemas, requisitos e critérios de aceite"
  ],
  "prod-researcher": [
    "Pesquisador de experiência",
    "Produto",
    "Sintetiza entrevistas, aprendizados e experimentos"
  ],
  "prod-pmm": [
    "Gestor de lançamentos",
    "Produto",
    "Prepara notas de versão e comunicados"
  ]
};
const en: Record<string, string[]> = {
  "site-engineer": [
    "Site engineer",
    "Construction",
    "Daily site reports, technical follow-up and documentation"
  ],
  "site-foreman": [
    "Site foreman",
    "Construction",
    "Coordinates the site, crews and daily schedule"
  ],
  "site-supervisor": [
    "Site supervisor",
    "Construction",
    "Tracks crews and reports to the foreman"
  ],
  "purchasing": [
    "Purchasing",
    "Construction",
    "Quotes, purchase orders and material tracking"
  ],
  "safety-officer": [
    "Workplace safety specialist",
    "Construction",
    "Safety checklists, equipment and incident tracking"
  ],
  "site-finance": [
    "Construction finance",
    "Construction",
    "Project costs, measurements, cash flow and variances"
  ],
  "bids-assistant": [
    "Tender assistant",
    "Construction",
    "Reviews tender notices, proposals and qualification documents"
  ]
};
const packs: Record<string,string[]> = {
  "pack-legal": [
    "Time jurídico",
    "Atendimento inicial, pesquisa e documentos para revisão"
  ],
  "pack-clinic": [
    "Time de atendimento da clínica",
    "Agendamento, comunicação e cobrança"
  ],
  "pack-accounting": [
    "Time contábil",
    "Conciliação, prazos e relatórios"
  ],
  "pack-realestate": [
    "Time imobiliário",
    "Qualificação, anúncios e acompanhamento de contatos"
  ],
  "pack-marketing": [
    "Time de marketing",
    "Estratégia, redação, design e busca"
  ],
  "pack-finance": [
    "Time financeiro",
    "Análise, planejamento e cobrança"
  ],
  "pack-sales": [
    "Time comercial",
    "Prospecção, propostas e oportunidades"
  ],
  "pack-product": [
    "Time de produto",
    "Descoberta, pesquisa e lançamentos"
  ]
};
export function localizeTemplate(template: AgentTemplate, lang: 'pt' | 'en'): AgentTemplate {
  const translated = (lang === 'pt' ? pt : en)[template.id];
  return { ...template, ...(translated ? {name: translated[0], role: translated[0], group: translated[1], tagline: translated[2], description: translated[2]} : {}), config: {...template.config, systemPrompt: `${template.config.systemPrompt}

${lang === 'pt' ? 'Responda em português brasileiro, salvo pedido explícito em outro idioma.' : 'Respond in English unless the customer explicitly requests another language.'}`} };
}
export function localizePack(pack: NichePack, lang: 'pt' | 'en'): NichePack {
  const translated = lang === 'pt' ? packs[pack.id] : undefined;
  return {...pack, ...(translated ? {name:translated[0],teamName:translated[0],tagline:translated[1],description:translated[1]} : {}), agents:pack.agents.map(agent => localizeTemplate(agent,lang))};
}
