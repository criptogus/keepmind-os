import type { Skill } from '../../shared/types';
const builtinLabels: Record<string, {originalDescription:string; en?: {name:string;description:string}; pt?: {name:string;description:string}}> = {
  "Autonomous Deliverables": {
    "originalDescription": "Create reports, proposed code files and patches without altering the project.",
    "pt": {
      "name": "Materiais e documentos",
      "description": "Cria relatórios, arquivos de código propostos e correções sem alterar o projeto."
    }
  },
  "Local Computer": {
    "originalDescription": "Read/write files, list directories, run shell commands and open URLs on this machine. Files are confined to the app workspace; shell commands have a 30s timeout.",
    "pt": {
      "name": "Arquivos e computador",
      "description": "Lê e grava arquivos, lista pastas, executa comandos e abre links. Os arquivos ficam restritos ao espaço do app; comandos têm limite de 30 segundos."
    }
  },
  "Agent Delegation": {
    "originalDescription": "Delegate sub-tasks to other agents, create subordinate specialists, and review their work.",
    "pt": {
      "name": "Colaboração entre agentes",
      "description": "Delega tarefas, cria agentes especialistas subordinados e revisa o trabalho deles."
    }
  },
  "Second Brain": {
    "originalDescription": "Search and store knowledge in the company second brain (KeepMind Corp).",
    "pt": {
      "name": "Memória da empresa",
      "description": "Consulta e registra conhecimento na base conectada."
    }
  },
  "WhatsApp": {
    "originalDescription": "Read incoming WhatsApp messages and send WhatsApp text messages via the connected account.",
    "pt": {
      "name": "WhatsApp",
      "description": "Lê mensagens recebidas e envia mensagens de texto pela conta conectada."
    }
  },
  "Agent Reach — Internet Access": {
    "originalDescription": "Read and search content across 15+ platforms (X/Twitter, Reddit, YouTube, GitHub, LinkedIn, Xiaohongshu, web, RSS) using the locally installed Agent Reach toolchain and real session credentials.",
    "pt": {
      "name": "Pesquisa na internet",
      "description": "Pesquisa conteúdo em serviços e páginas conectados."
    }
  },
  "Diário de Obra": {
    "originalDescription": "Registra e consulta o Relatório Diário de Obra (RDO): clima, efetivo por função, serviços executados, ocorrências, fotos e pendências.",
    "en": {
      "name": "Site diary",
      "description": "Records daily site activities, workforce, weather, incidents and pending work."
    }
  },
  "Orçamento e Planejamento": {
    "originalDescription": "Composição de orçamento de obras: quantitativos, composições, BDI, curva ABC de insumos, cronograma físico-financeiro.",
    "en": {
      "name": "Construction budgeting and planning",
      "description": "Prepares quantities, cost estimates and project schedules."
    }
  },
  "Segurança do Trabalho (NR)": {
    "originalDescription": "Checklists de segurança conforme NRs (18, 35, 4, 33 etc.), PPRA, EPIs, ocorrências e não-conformidades.",
    "en": {
      "name": "Workplace safety (NR)",
      "description": "Supports safety checklists, equipment and incident records."
    }
  },
  "Documentos e Licitações": {
    "originalDescription": "Leitura e análise de documentos de obra: ART, alvarás, memoriais, editais, propostas e contratos.",
    "en": {
      "name": "Documents and tenders",
      "description": "Reviews construction documents, proposals and contracts."
    }
  },
  "Copywriting — LinkedIn & X": {
    "originalDescription": "Writes scroll-stopping posts for LinkedIn and X/Twitter: hooks, threads, CTAs.",
    "pt": {
      "name": "Redação para LinkedIn e X",
      "description": "Escreve publicações para LinkedIn e X, com aberturas, sequências e chamadas para ação."
    }
  },
  "Copywriting — Instagram": {
    "originalDescription": "Captions, carousel scripts and Reels copy for Instagram.",
    "pt": {
      "name": "Redação para Instagram",
      "description": "Escreve legendas, roteiros de carrosséis e textos para vídeos Reels do Instagram."
    }
  },
  "SEO & GEO": {
    "originalDescription": "Search engine optimization plus generative engine optimization (being cited by AI answers).",
    "pt": {
      "name": "Otimização para busca e IA",
      "description": "Melhora conteúdo para buscadores e respostas de IA."
    }
  },
  "Design Direction": {
    "originalDescription": "Art direction, design briefs and brand-consistent visual concepts.",
    "pt": {
      "name": "Direção de design",
      "description": "Prepara orientações visuais alinhadas à marca."
    }
  },
  "Content Strategy": {
    "originalDescription": "Content calendars, pillars, repurposing plans and editorial workflows.",
    "pt": {
      "name": "Estratégia de conteúdo",
      "description": "Organiza temas, calendário e reaproveitamento de conteúdo."
    }
  },
  "Financial Analysis": {
    "originalDescription": "Ratios, variance analysis, margins and financial health checks.",
    "pt": {
      "name": "Análise financeira",
      "description": "Analisa indicadores, margens e variações financeiras."
    }
  },
  "FP&A & Planning": {
    "originalDescription": "Budgets, forecasts, scenarios and rolling plans.",
    "pt": {
      "name": "Planejamento financeiro",
      "description": "Prepara orçamentos, projeções e cenários."
    }
  },
  "Billing & Collections": {
    "originalDescription": "Invoicing follow-ups, AR aging and payment reminders.",
    "pt": {
      "name": "Faturamento e cobrança",
      "description": "Acompanha faturas, recebíveis e lembretes de pagamento."
    }
  },
  "Sales Prospecting": {
    "originalDescription": "Lead research, personalization and outbound messaging.",
    "pt": {
      "name": "Prospecção comercial",
      "description": "Pesquisa potenciais clientes, personaliza abordagens e redige mensagens de prospecção."
    }
  },
  "Proposals & Commercial Writing": {
    "originalDescription": "Proposals, quotes, follow-ups and commercial documents.",
    "pt": {
      "name": "Propostas comerciais",
      "description": "Prepara propostas, orçamentos e documentos comerciais."
    }
  },
  "Product Discovery": {
    "originalDescription": "PRDs, user stories, acceptance criteria and discovery frameworks.",
    "pt": {
      "name": "Descoberta de produto",
      "description": "Elabora documentos de requisitos, histórias de usuário, critérios de aceite e métodos de descoberta de produto."
    }
  },
  "User Research Synthesis": {
    "originalDescription": "Interview notes → insights, themes and opportunity maps.",
    "pt": {
      "name": "Síntese de pesquisa com usuários",
      "description": "Transforma entrevistas em temas, aprendizados e oportunidades."
    }
  },
  "Release Notes & Announcements": {
    "originalDescription": "Changelogs, release announcements and internal comms.",
    "pt": {
      "name": "Notas de versão e comunicados",
      "description": "Escreve registros de mudanças, anúncios de novas versões e comunicados internos."
    }
  }
};
/** Only built-in, unedited metadata is localized; custom skills and instructions stay untouched. */
export function skillLabel(skill: Pick<Skill,'name'|'description'>, lang:'pt'|'en') {
 const entry=builtinLabels[skill.name];
 return entry && entry.originalDescription===skill.description ? entry[lang] || skill : skill;
}
