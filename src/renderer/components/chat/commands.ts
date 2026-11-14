/** Slash commands that make every setting reachable from the chat composer. */

export interface ChatCommandDef {
  /** canonical name without slash */
  name: string;
  /** i18n key for the one-line description shown in the popup */
  descKey: string;
  /** expected argument shape, e.g. '<nome>', 'on|off', 'pt|en|es' */
  usage?: string;
}

export const CHAT_COMMANDS: ChatCommandDef[] = [
  { name: 'ajuda', descKey: 'chat.cmd.help' },
  { name: 'admin', descKey: 'chat.cmd.admin', usage: '[secao]' },
  { name: 'canal', descKey: 'chat.cmd.channel', usage: '<nome>' },
  { name: 'dm', descKey: 'chat.cmd.dm', usage: '<agente>' },
  { name: 'som', descKey: 'chat.cmd.sound', usage: 'on|off' },
  { name: 'auto-aprovar', descKey: 'chat.cmd.autoapprove', usage: 'on|off' },
  { name: 'tema', descKey: 'chat.cmd.theme', usage: 'light|dark|auto' },
  { name: 'idioma', descKey: 'chat.cmd.lang', usage: 'pt|en|es' },
];

export interface ParsedCommand {
  name: string;
  args: string;
}

/** Returns the command when `text` starts with `/name`, else null. */
export function parseCommand(text: string): ParsedCommand | null {
  const m = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] ?? '').trim() };
}

/** Prefix-filtered command list for the composer popup. */
export function commandSuggestions(prefix: string): ChatCommandDef[] {
  const q = prefix.toLowerCase();
  return CHAT_COMMANDS.filter((c) => c.name.startsWith(q) || c.name.includes(q)).slice(0, 8);
}
