/** Deterministic policy: tool descriptions and model output never grant authority. */
const routine = new Set(['artifact_create','get_current_time','file_read','file_list','pdf_read','sheet_read',
  'personalbrain_search','personalbrain_remember','secondbrain_search','web_read_url',
  'whatsapp_read_messages','agent_reach_status','composio_search_tools','review_agent','delegate_to_agent']);
export function actionDecision(name: string, trustedMcpRead = false) {
  if (routine.has(name) || (name.startsWith('mcp_') && trustedMcpRead)) return { requiresApproval: false, reason: 'Routine action within assigned permissions' };
  const reasons: Record<string,string> = {
    shell_exec: 'A command can change the system or publish externally.',
    file_write: 'This action changes a file; a reversible change boundary is not configured.',
    sheet_write: 'This action changes a spreadsheet; a reversible change boundary is not configured.',
    whatsapp_send_message: 'This sends a message to another person.',
    open_url: 'Opening this URL may trigger an external action.',
    create_agent: 'This creates a new agent with persistent authority.',
    secondbrain_remember: 'This changes shared organizational knowledge.',
    composio_execute: 'The external action has not been classified by the workspace owner.',
  };
  return { requiresApproval: true, reason: reasons[name] || 'This external tool is not authorized for automatic read-only use.' };
}
