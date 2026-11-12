import type { Approval } from '../../shared/types.js';

export interface ApprovalDescription {
  /** Plain-language action, e.g. "enviar uma mensagem de WhatsApp". */
  action: string;
  /** Quoted payload the layperson should actually read (message text, command…). */
  payload?: string;
  /** Short target hint (phone, path, url…). */
  target?: string;
}

const truncate = (s: string, n = 280) => (s.length > n ? s.slice(0, n) + '…' : s);

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * Turns a raw `tool:<name>` approval into a sentence a non-technical person
 * can approve or reject. Unknown tools fall back to a humanized name + args.
 */
export function describeApproval(approval: Approval, lang: 'en' | 'pt'): ApprovalDescription {
  const pt = lang === 'pt';
  const ctx = approval.context as { tool?: string; args?: Record<string, unknown> } | undefined;
  const tool = ctx?.tool || approval.action.replace(/^tool:/, '');
  const args = (ctx?.args ?? {}) as Record<string, unknown>;

  switch (tool) {
    case 'whatsapp_send_message':
      return {
        action: pt ? 'enviar uma mensagem de WhatsApp' : 'send a WhatsApp message',
        target: str(args.to),
        payload: str(args.text) ? truncate(str(args.text)!) : undefined,
      };
    case 'file_write':
      return {
        action: pt ? 'criar ou alterar um arquivo' : 'create or change a file',
        target: str(args.path),
        payload: str(args.content) ? truncate(str(args.content)!, 400) : undefined,
      };
    case 'shell_exec':
      return {
        action: pt ? 'executar um comando no computador' : 'run a command on the computer',
        payload: str(args.command) ? `\`${truncate(str(args.command)!, 300)}\`` : undefined,
      };
    case 'open_url':
      return {
        action: pt ? 'abrir um link no navegador' : 'open a link in the browser',
        target: str(args.url),
      };
    case 'delegate_to_agent':
      return {
        action: pt ? 'pedir ajuda a outro agente' : 'ask another agent for help',
        target: str(args.agent),
        payload: str(args.task) ? truncate(str(args.task)!, 300) : undefined,
      };
    case 'composio_execute':
      return {
        action: pt ? 'executar uma ação em um app conectado' : 'run an action in a connected app',
        target: str(args.slug),
        payload: str(args.args) && args.args !== '{}' ? truncate(str(args.args)!, 300) : undefined,
      };
    case 'secondbrain_remember':
      return {
        action: pt ? 'salvar na memória da empresa' : 'save to company memory',
        payload: str(args.content) ? truncate(str(args.content)!, 400) : undefined,
      };
    case 'personalbrain_remember':
      return {
        action: pt ? 'salvar no cérebro pessoal' : 'save to personal brain',
        target: str(args.file),
        payload: str(args.content) ? truncate(str(args.content)!, 400) : undefined,
      };
    case 'team_execution':
      return {
        action: pt ? 'executar um fluxo de trabalho' : 'run a workflow',
        target: str(args.teamName) || str(args.name),
      };
    default: {
      const humanized = tool.replace(/_/g, ' ');
      const summary = args && Object.keys(args).length
        ? Object.entries(args)
            .slice(0, 4)
            .map(([k, v]) => `${k}: ${typeof v === 'string' ? truncate(v, 80) : JSON.stringify(v)}`)
            .join(' · ')
        : undefined;
      return { action: pt ? `usar a ferramenta "${humanized}"` : `use the tool "${humanized}"`, payload: summary };
    }
  }
}

const TOOL_LABELS: Record<string, { en: string; pt: string }> = {
  whatsapp_send_message: { en: 'send WhatsApp messages', pt: 'enviar mensagens de WhatsApp' },
  whatsapp_read_messages: { en: 'read WhatsApp messages', pt: 'ler mensagens de WhatsApp' },
  secondbrain_search: { en: 'search company memory', pt: 'buscar na memória da empresa' },
  secondbrain_remember: { en: 'save to company memory', pt: 'salvar na memória da empresa' },
  personalbrain_search: { en: 'search personal brain', pt: 'buscar no cérebro pessoal' },
  personalbrain_remember: { en: 'save to personal brain', pt: 'salvar no cérebro pessoal' },
  file_read: { en: 'read files', pt: 'ler arquivos' },
  file_write: { en: 'create/edit files', pt: 'criar/editar arquivos' },
  file_list: { en: 'list files', pt: 'listar arquivos' },
  pdf_read: { en: 'read PDF documents', pt: 'ler documentos PDF' },
  sheet_read: { en: 'read spreadsheets', pt: 'ler planilhas' },
  sheet_write: { en: 'write spreadsheets', pt: 'escrever planilhas' },
  shell_exec: { en: 'run computer commands', pt: 'executar comandos no computador' },
  open_url: { en: 'open web links', pt: 'abrir links na web' },
  delegate_to_agent: { en: 'ask other agents for help', pt: 'pedir ajuda a outros agentes' },
  composio_search_tools: { en: 'find app actions', pt: 'encontrar ações de apps' },
  composio_execute: { en: 'run actions in connected apps', pt: 'executar ações em apps conectados' },
  web_read_url: { en: 'read web pages', pt: 'ler páginas da web' },
  agent_reach_status: { en: 'check internet access tools', pt: 'verificar ferramentas de internet' },
  get_current_time: { en: 'check the current time', pt: 'verificar a hora atual' },
};

/** Plain-language label for a tool name, used in the agent wizard review. */
export function describeTool(toolName: string, lang: 'en' | 'pt'): string {
  const entry = TOOL_LABELS[toolName];
  if (entry) return lang === 'pt' ? entry.pt : entry.en;
  return toolName.replace(/_/g, ' ');
}
