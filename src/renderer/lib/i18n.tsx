import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'pt' | 'es';
const STORAGE_KEY = 'km-lang';

const dict: Record<string, { en: string; pt: string }> = {
  // Shell / navigation
  'nav.dashboard': { en: 'Dashboard', pt: 'Painel' },
  'nav.agents': { en: 'Agents', pt: 'Agentes' },
  'nav.teams': { en: 'Teams', pt: 'Equipes' },
  'nav.skills': { en: 'Skills', pt: 'Habilidades' },
  'nav.governance': { en: 'Governance', pt: 'Governança' },
  'nav.logs': { en: 'Activity Logs', pt: 'Logs de Atividade' },
  'nav.settings': { en: 'Settings', pt: 'Configurações' },
  'nav.advanced': { en: 'Advanced', pt: 'Avançado' },
  'nav.navigation': { en: 'Navigation', pt: 'Navegação' },
  'nav.system': { en: 'System', pt: 'Sistema' },
  'nav.version': { en: 'Version', pt: 'Versão' },
  'nav.loading': { en: 'Loading…', pt: 'Carregando…' },
  'nav.signout': { en: 'Sign out', pt: 'Sair' },
  'nav.poweredBy': { en: 'Powered by', pt: 'Desenvolvido por' },
  'gov.pending': { en: 'Pending Approvals', pt: 'Aprovações Pendentes' },
  'gov.rules': { en: 'Rules', pt: 'Regras' },

  // Login
  'login.subtitle': { en: 'Sign in to continue', pt: 'Entre para continuar' },
  'login.email': { en: 'Email', pt: 'E-mail' },
  'login.password': { en: 'Password', pt: 'Senha' },
  'login.submit': { en: 'Sign in', pt: 'Entrar' },
  'login.failed': { en: 'Login failed', pt: 'Falha no login' },

  // Settings panel
  'settings.title': { en: 'Settings', pt: 'Configurações' },
  'settings.loading': { en: 'Loading settings...', pt: 'Carregando configurações...' },
  'settings.appearance': { en: 'Appearance', pt: 'Aparência' },
  'settings.theme': { en: 'Theme', pt: 'Tema' },
  'settings.theme.light': { en: 'Light', pt: 'Claro' },
  'settings.theme.dark': { en: 'Dark', pt: 'Escuro' },
  'settings.theme.auto': { en: 'Auto', pt: 'Automático' },
  'settings.language': { en: 'Language', pt: 'Idioma' },
  'settings.portugues': { en: 'Português', pt: 'Português' },
  'settings.governance': { en: 'Governance', pt: 'Governança' },
  'settings.autoApprove': { en: 'Auto-approve actions', pt: 'Aprovar ações automaticamente' },
  'settings.autoApproveHint': { en: 'Disabling manual approval reduces security oversight', pt: 'Desativar aprovação manual reduz a supervisão de segurança' },
  'settings.execution': { en: 'Execution', pt: 'Execução' },
  'settings.defaultModel': { en: 'Default model', pt: 'Modelo padrão' },
  'settings.catalogUpdated': { en: 'Catalog updated', pt: 'Catálogo atualizado' },
  'settings.bundledCatalog': { en: 'Using bundled catalog', pt: 'Usando catálogo embutido' },
  'settings.refreshModels': { en: 'Refresh models', pt: 'Atualizar modelos' },
  'settings.maxConcurrent': { en: 'Max concurrent executions', pt: 'Máx. execuções simultâneas' },
  'settings.retention': { en: 'Data retention', pt: 'Retenção de dados' },
  'settings.auditDays': { en: 'Audit log retention (days)', pt: 'Retenção de logs de auditoria (dias)' },
  'settings.auditHint': { en: 'Logs older than this will be automatically deleted', pt: 'Logs mais antigos que isso serão apagados automaticamente' },
  'settings.error': { en: 'Error', pt: 'Erro' },

  // Onboarding
  'ob.welcome': { en: 'Welcome to KeepMind OS', pt: 'Bem-vindo ao KeepMind OS' },
  'ob.subtitle': { en: 'Set up your workspace in a few steps.', pt: 'Configure seu espaço de trabalho em poucos passos.' },
  'ob.step.company': { en: 'Company', pt: 'Empresa' },
  'ob.step.llm': { en: 'LLM Provider', pt: 'Provedor de IA' },
  'ob.step.brain': { en: 'Second Brain', pt: 'Segundo Cérebro' },
  'ob.step.agent': { en: 'First Agent', pt: 'Primeiro Agente' },
  'ob.companyName': { en: 'Company name', pt: 'Nome da empresa' },
  'ob.industry': { en: 'Industry', pt: 'Segmento' },
  'ob.website': { en: 'Website', pt: 'Site' },
  'ob.companyDoes': { en: 'What does your company do?', pt: 'O que sua empresa faz?' },
  'ob.apiKeyDesc': { en: 'Or sign in with OAuth below.', pt: 'Ou entre com OAuth abaixo.' },
  'ob.connected': { en: 'Connected via OAuth', pt: 'Conectado via OAuth' },
  'ob.signinWith': { en: 'Sign in with', pt: 'Entrar com' },
  'ob.oauthUnavailable': { en: 'OAuth sign-in requires a provider-approved client ID and is currently unavailable. Use an API key instead.', pt: 'O login OAuth requer um client ID aprovado pelo provedor e está indisponível no momento. Use uma chave de API.' },
  'ob.connectBrain': { en: 'Connect KeepMind Corp (second brain)', pt: 'Conectar KeepMind Corp (segundo cérebro)' },
  'ob.connectBrainDesc': { en: 'Optional. Lets agents read and write shared company knowledge via your corp server.', pt: 'Opcional. Permite que agentes leiam e escrevam conhecimento corporativo compartilhado via seu servidor corp.' },
  'ob.serverUrl': { en: 'Server URL', pt: 'URL do servidor' },
  'ob.accessToken': { en: 'Access token', pt: 'Token de acesso' },
  'ob.tokenDesc': { en: 'KEEPMIND_CORP_TOKEN from your corp server.', pt: 'KEEPMIND_CORP_TOKEN do seu servidor corp.' },
  'ob.testConnection': { en: 'Test connection', pt: 'Testar conexão' },
  'ob.skipLater': { en: 'You can skip this and connect later in Settings.', pt: 'Você pode pular e conectar depois nas Configurações.' },
  'ob.agentName': { en: 'Agent name', pt: 'Nome do agente' },
  'ob.agentRole': { en: 'Role / responsibilities', pt: 'Função / responsabilidades' },
  'ob.agentRoleDesc': { en: 'e.g. \'Content strategist\', \'Customer support lead\'', pt: 'ex.: \'Estrategista de conteúdo\', \'Líder de suporte\'' },
  'ob.agentUses': { en: 'This agent will use your', pt: 'Este agente usará sua conexão' },
  'ob.andBrain': { en: 'and the KeepMind Corp second brain', pt: 'e o segundo cérebro KeepMind Corp' },
  'ob.back': { en: 'Back', pt: 'Voltar' },
  'ob.continue': { en: 'Continue', pt: 'Continuar' },
  'ob.finish': { en: 'Finish setup', pt: 'Concluir configuração' },
  'ob.openingSignin': { en: 'Opening sign-in…', pt: 'Abrindo login…' },
  'ob.testing': { en: 'Testing connection…', pt: 'Testando conexão…' },
  'ob.connectedCorp': { en: 'Connected to KeepMind Corp.', pt: 'Conectado ao KeepMind Corp.' },
  'ob.saving': { en: 'Saving configuration…', pt: 'Salvando configuração…' },
  'ob.failed': { en: 'failed', pt: 'falhou' },

  'adv.title': { en: 'Advanced Settings', pt: 'Configurações Avançadas' },
  // Advanced settings — section titles
  'adv.secondBrain': { en: 'Second Brain (Corporate Knowledge)', pt: 'Segundo Cérebro (Conhecimento Corporativo)' },
  'adv.whatsapp': { en: 'WhatsApp', pt: 'WhatsApp' },
  'adv.users': { en: 'Users & Roles', pt: 'Usuários e Funções' },
  'adv.brainsGithub': { en: 'Brains & GitHub Access', pt: 'Cérebros e Acesso GitHub' },
  'adv.computerAccess': { en: 'Computer Access', pt: 'Acesso ao Computador' },
  'adv.automation': { en: 'Automation & Approvals', pt: 'Automação e Aprovações' },
  'adv.updates': { en: 'Updates', pt: 'Atualizações' },
  'adv.data': { en: 'Data Management', pt: 'Gerenciamento de Dados' },
  'adv.appearance': { en: 'Appearance', pt: 'Aparência' },
};

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: 'pt',
  setLang: () => {},
  t: (key) => dict[key]?.en ?? key,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === 'en' || saved === 'pt' || saved === 'es' ? saved : 'pt';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const t = (key: string): string => {
    const entry = dict[key];
    if (!entry) return key;
    if (lang === 'pt') return entry.pt;
    return entry.en; // 'es' falls back to English until translated
  };

  return (
    <LangContext.Provider value={{ lang, setLang: setLangState, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}
