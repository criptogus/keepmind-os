/** User-facing action names; internal tool identifiers never become the headline. */
export function approvalCopy(action: string, args: Record<string, unknown> = {}) {
  const tool = action.replace(/^tool:/, '');
  const value = (key: string) => typeof args[key] === 'string' ? (args[key] as string).slice(0, 6000) : '';
  if (tool === 'app_team_create') return {
    title: value('name') ? `Criar ${value('name')}` : 'Criar seu time',
    description: `Cria uma coordenação e dois especialistas, usando sua conexão de IA. ${args.startFirstTask === true ? 'Também inicia a primeira entrega; isso pode consumir créditos.' : 'Salva a primeira entrega como rascunho.'} Não publica nem envia mensagens externas.`,
    detail: [value('problem'), value('firstRequest') && `Primeira entrega: ${value('firstRequest')}`].filter(Boolean).join('\n\n'),
  };
  const names: Record<string, [string, string]> = {
    delegate_to_agent: ['Trabalhar com um especialista', 'Encaminhar a tarefa ao especialista responsável.'],
    review_agent: ['Revisar a entrega', 'Registrar a avaliação do trabalho do especialista.'],
    app_status: ['Consultar o status do aplicativo', 'Ver os times, agentes e trabalhos em andamento.'],
    app_agents_list: ['Consultar seus agentes', 'Ver os agentes já configurados.'],
    app_teams_list: ['Consultar seus times', 'Ver os times e seus integrantes.'],
    app_automations_list: ['Consultar suas rotinas', 'Ver as rotinas configuradas.'],
    app_approvals_list: ['Consultar solicitações pendentes', 'Ver o que aguarda sua decisão.'],
    app_channels_list: ['Consultar seus canais', 'Ver os canais de conversa.'],
    app_audit_search: ['Consultar o histórico de ações', 'Ver o registro das ações realizadas no aplicativo.'],
    app_settings_get: ['Consultar as configurações', 'Ver as preferências atuais do aplicativo.'],
    app_settings_update: ['Alterar configurações', 'Revisar e aplicar as mudanças solicitadas nas preferências do aplicativo.'],
    app_chat_read: ['Ler uma conversa', 'Consultar mensagens do canal solicitado.'],
    app_chat_post: ['Enviar uma mensagem ao canal', 'Publicar uma mensagem no canal do aplicativo.'],
    app_channel_create: ['Criar um canal', 'Adicionar um espaço de conversa ao aplicativo.'],
    create_agent: ['Criar um especialista', 'Adicionar um agente de IA para ajudar no trabalho solicitado.'],
    app_automation_create: ['Criar uma rotina', 'Programar execuções futuras. Elas podem consumir créditos de IA.'],
    app_automation_delete: ['Excluir uma rotina', 'Remover a rotina solicitada.'],
    sheet_write: ['Salvar uma planilha', 'Criar ou atualizar o arquivo da entrega.'],
    file_write: ['Salvar um arquivo', 'Criar ou atualizar o arquivo solicitado.'],
    shell_exec: ['Executar um comando no computador', 'O comando pode alterar arquivos ou acessar serviços. Confira os detalhes antes de permitir.'],
    open_url: ['Abrir um link', 'Abrir o endereço solicitado no navegador.'],
    whatsapp_send_message: ['Enviar mensagem pelo WhatsApp', 'A mensagem será enviada ao destinatário indicado.'],
    secondbrain_remember: ['Salvar na memória compartilhada', 'Compartilhar esta informação com a memória da organização.'],
  };
  const [title, description] = names[tool] ?? ['Permitir a ação solicitada', 'Confira os detalhes antes de permitir que o agente continue.'];
  return { title, description, detail: value('name') || value('path') || value('url') };
}
