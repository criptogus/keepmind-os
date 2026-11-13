import { existsSync, realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import { extractText } from 'unpdf';

export interface ToolContext {
  signal?: AbortSignal;
  sendWhatsApp?: (to: string, text: string) => Promise<void>;
  /** Recent incoming WhatsApp messages (read-only). */
  getWhatsAppMessages?: (limit?: number) => Array<{ from: string; text: string; timestamp: number }>;
  secondBrainSearch?: (query: string, limit?: number) => Promise<string>;
  secondBrainRemember?: (content: string) => Promise<unknown>;
  /** Runs another agent with a task description; returns its text output. */
  delegateTask?: (callerAgentId: string | undefined, agent: string, task: string, input?: Record<string, unknown>) => Promise<string>;
  /** Root directory the file tools are confined to. */
  workspaceDir?: string;
  /** Executes a shell command; returns combined stdout+stderr (truncated). */
  shellExec?: (command: string, signal?: AbortSignal) => Promise<string>;
  /** Opens a URL in the default browser. */
  openUrl?: (url: string) => Promise<void>;
  /** Reads a web page via Jina Reader (clean markdown, no bot wall). */
  webReadUrl?: (url: string) => Promise<string>;
  /** Returns Agent Reach channel/backent availability. */
  agentReachStatus?: () => Promise<unknown>;
  /** Per-execution computer access policy (merged over the global context). */
  fileAccess?: 'workspace' | 'authorized' | 'full';
  allowedRoots?: string[];
  shellAccess?: 'disabled' | 'allowlist' | 'full';
  shellAllow?: string[];
  shellDeny?: string[];
  /** Composio: semantic search over connected-app actions. */
  composioSearch?: (query: string) => Promise<string>;
  /** Composio: executes an action slug with a JSON args string. */
  composioExecute?: (slug: string, argsJson: string) => Promise<string>;
  /** Personal brain (local vault, never leaves the machine). */
  personalBrainSearch?: (query: string, limit?: number) => Promise<{ text: string; ids: string[] }>;
  personalBrainRemember?: (content: string, file?: string) => Promise<string>;
  /** Collects ids of memory items returned to the model (outcome attribution). */
  memoryUsage?: Set<string>;
  /** Id of the agent running this execution (set per-execution via policy). */
  callerAgentId?: string;
  /** Creates a subordinate agent reporting to the caller; returns a summary. */
  createAgent?: (callerAgentId: string | undefined, spec: { name: string; description?: string; systemPrompt?: string; model?: string; skillNames?: string[] }) => Promise<string>;
  /** Records a structured review/rating of another agent in the audit log. */
  reviewAgent?: (callerAgentId: string | undefined, agent: string, rating: number, note: string) => Promise<string>;
}

/** Per-execution policy computed from install settings + agent config + caller role. */
export interface ExecutionPolicy {
  signal?: AbortSignal;
  executionId?: string;
  workTaskId?: string;
  allowedTools?: string[];
  fileAccess?: 'workspace' | 'authorized' | 'full';
  allowedRoots?: string[];
  shellAccess?: 'disabled' | 'allowlist' | 'full';
  shellAllow?: string[];
  shellDeny?: string[];
  /** Collects ids of memory items returned to the model (outcome attribution). */
  memoryUsage?: Set<string>;
  /** Id of the agent running this execution. */
  callerAgentId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

/**
 * Built-in tool registry. Skills declare which tool names they need;
 * AgentManager exposes them to the LLM as function-calling tools and
 * executes handlers here in the main process.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private context: ToolContext = {};
  /**
   * Optional governance gate consulted before every tool execution.
   * Return a string to block the call (the string becomes the tool result),
   * or null/undefined to allow it.
   */
  private gate?: (name: string, args: Record<string, unknown>, policy?: ExecutionPolicy) => Promise<string | null>;

  setGate(gate?: (name: string, args: Record<string, unknown>, policy?: ExecutionPolicy) => Promise<string | null>): void {
    this.gate = gate;
  }

  constructor() {
    this.register({
      name: 'get_current_time',
      description: 'Returns the current date and time in ISO format.',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async () => new Date().toISOString(),
    });

    this.register({
      name: 'whatsapp_send_message',
      description: 'Sends a WhatsApp text message to a phone number (with country code, digits only).',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number with country code, e.g. 5511999999999' },
          text: { type: 'string', description: 'Message text' },
        },
        required: ['to', 'text'],
      },
      handler: async (args, ctx) => {
        if (!ctx.sendWhatsApp) throw new Error('WhatsApp is not connected');
        await ctx.sendWhatsApp(String(args.to), String(args.text));
        return `Message sent to ${args.to}`;
      },
    });

    this.register({
      name: 'whatsapp_read_messages',
      description: 'Reads recent incoming WhatsApp messages (read-only, does not send anything).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max messages to return (default 20)' },
        },
        required: [],
      },
      handler: async (args, ctx) => {
        if (!ctx.getWhatsAppMessages) throw new Error('WhatsApp is not connected');
        const msgs = ctx.getWhatsAppMessages(Number(args.limit) || 20);
        if (msgs.length === 0) return 'No recent WhatsApp messages';
        return msgs.map((m) => `[${new Date(m.timestamp).toLocaleString()}] ${m.from}: ${m.text}`).join('\n');
      },
    });

    this.register({
      name: 'personalbrain_search',
      description: 'Searches the PERSONAL brain — a local vault on this machine for private notes, memories and personal context. Retrieval is local; results may be included in calls to the configured model provider.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
      handler: async (args, ctx) => {
        if (!ctx.personalBrainSearch) throw new Error('Personal brain is not available');
        const r = await ctx.personalBrainSearch(String(args.query), Number(args.limit) || 5);
        for (const id of r.ids || []) ctx.memoryUsage?.add(id);
        return r.text.slice(0, 8000) || 'No matches in personal brain';
      },
    });

    this.register({
      name: 'personalbrain_remember',
      description: 'Saves a note to the PERSONAL brain (local vault on this machine). Use for personal information, preferences and private context — NOT for corporate knowledge (use secondbrain_remember for that).',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Note content to remember' },
          file: { type: 'string', description: 'Optional vault file name (default memories.md)' },
        },
        required: ['content'],
      },
      handler: async (args, ctx) => {
        if (!ctx.personalBrainRemember) throw new Error('Personal brain is not available');
        return ctx.personalBrainRemember(String(args.content), args.file ? String(args.file) : undefined);
      },
    });

    this.register({
      name: 'web_read_url',
      description: 'Reads a web page and returns its content as clean text (via Jina Reader). Use for articles, docs and public pages.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http(s) URL to read' },
        },
        required: ['url'],
      },
      handler: async (args, ctx) => {
        if (!ctx.webReadUrl) throw new Error('Web reading is not available');
        const url = String(args.url || '');
        if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with http:// or https://');
        const text = await ctx.webReadUrl(url);
        return text.slice(0, 12000) || '(empty page)';
      },
    });

    this.register({
      name: 'agent_reach_status',
      description: 'Checks which internet platforms Agent Reach can currently read (YouTube, GitHub, X/Twitter, Reddit, etc.) and which backend serves each.',
      parameters: { type: 'object', properties: {}, required: [] },
      handler: async (_args, ctx) => {
        if (!ctx.agentReachStatus) throw new Error('Agent Reach is not available');
        const status = await ctx.agentReachStatus() as { installed?: boolean; channels?: Array<{ name: string; status: string; backend: string | null }> };
        if (!status?.installed) return 'Agent Reach is not installed. Install it with: pip install agent-reach (github.com/Panniantong/Agent-Reach)';
        const lines = (status.channels || []).map((c) => `${c.status === 'ok' ? '✓' : c.status === 'warn' ? '~' : '✗'} ${c.name}: ${c.status}${c.backend ? ` (${c.backend})` : ''}`);
        return `Agent Reach channels:\n${lines.join('\n')}`;
      },
    });

    this.register({
      name: 'secondbrain_search',
      description: 'Searches the company second brain (KeepMind Corp) for relevant knowledge.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
      handler: async (args, ctx) => {
        if (!ctx.secondBrainSearch) throw new Error('Second brain is not configured');
        return ctx.secondBrainSearch(String(args.query), Number(args.limit) || 5);
      },
    });

    this.register({
      name: 'secondbrain_remember',
      description: 'Stores a fact or note in the company second brain (KeepMind Corp).',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact or note to remember' },
        },
        required: ['content'],
      },
      handler: async (args, ctx) => {
        if (!ctx.secondBrainRemember) throw new Error('Second brain is not configured');
        const result = await ctx.secondBrainRemember(String(args.content));
        return typeof result === 'string' ? result : JSON.stringify(result);
      },
    });

    this.register({
      name: 'delegate_to_agent',
      description: 'Delegates a task to another agent by name or ID and waits for its result. Use for multi-step work that benefits from a different agent persona.',
      parameters: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Target agent name or ID' },
          task: { type: 'string', description: 'Task description / input for the target agent' },
        },
        required: ['agent', 'task'],
      },
      handler: async (args, ctx) => {
        if (!ctx.delegateTask) throw new Error('Agent delegation is not available');
        const result = await ctx.delegateTask(ctx.callerAgentId, String(args.agent), String(args.task));
        return result.slice(0, 8000);
      },
    });

    this.register({
      name: 'create_agent',
      description: 'Creates a new subordinate agent that reports to you. Use when a recurring sub-area of work deserves its own specialist. The new agent starts with basic tools; a human admin can extend it later.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name for the new agent' },
          description: { type: 'string', description: 'One-line description of its role' },
          systemPrompt: { type: 'string', description: 'Instructions defining the agent persona and boundaries' },
          model: { type: 'string', description: 'Optional model id (e.g. gpt-4o-mini, claude-haiku). Defaults to the workspace model.' },
          skillNames: { type: 'array', items: { type: 'string' }, description: 'Optional names of existing skills to attach' },
        },
        required: ['name'],
      },
      handler: async (args, ctx) => {
        if (!ctx.createAgent) throw new Error('Agent creation is not available');
        const result = await ctx.createAgent(ctx.callerAgentId, {
          name: String(args.name),
          description: args.description ? String(args.description) : undefined,
          systemPrompt: args.systemPrompt ? String(args.systemPrompt) : undefined,
          model: args.model ? String(args.model) : undefined,
          skillNames: Array.isArray(args.skillNames) ? args.skillNames.map(String) : undefined,
        });
        return result.slice(0, 4000);
      },
    });

    this.register({
      name: 'review_agent',
      description: 'Records a structured review (rating 1-5 plus notes) of another agent\'s work. Use after delegating or observing an agent\'s output to feed the team\'s quality history.',
      parameters: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Target agent name or ID' },
          rating: { type: 'number', description: 'Quality rating from 1 (poor) to 5 (excellent)' },
          note: { type: 'string', description: 'What went well or what to improve' },
        },
        required: ['agent', 'rating'],
      },
      handler: async (args, ctx) => {
        if (!ctx.reviewAgent) throw new Error('Agent review is not available');
        const rating = Math.max(1, Math.min(5, Math.round(Number(args.rating) || 0)));
        const result = await ctx.reviewAgent(ctx.callerAgentId, String(args.agent), rating, String(args.note ?? ''));
        return result.slice(0, 2000);
      },
    });

    this.register({
      name: 'file_read',
      description: 'Reads a UTF-8 text file from the agent workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace directory' },
        },
        required: ['path'],
      },
      handler: async (args, ctx) => {
        const p = resolveInWorkspace(ctx, String(args.path));
        const content = await fs.readFile(p, 'utf8');
        return content.slice(0, 20000);
      },
    });

    this.register({
      name: 'file_write',
      description: 'Writes UTF-8 text to a file in the agent workspace (creates parent directories).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace directory' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
      handler: async (args, ctx) => {
        const p = resolveInWorkspace(ctx, String(args.path));
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, String(args.content), 'utf8');
        return `Wrote ${Buffer.byteLength(String(args.content))} bytes to ${args.path}`;
      },
    });

    this.register({
      name: 'file_list',
      description: 'Lists files and directories inside the agent workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Subdirectory relative to the workspace (default: root)' },
        },
        required: [],
      },
      handler: async (args, ctx) => {
        const p = resolveInWorkspace(ctx, args.path ? String(args.path) : '.');
        const entries = await fs.readdir(p, { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n') || '(empty)';
      },
    });

    this.register({
      name: 'shell_exec',
      description: 'Executes a shell command on the local machine and returns its output. Use for system tasks, scripts, git, package managers, etc. Commands have a 30s timeout.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
      handler: async (args, ctx) => {
        if (!ctx.shellExec) throw new Error('Shell execution is not available');
        const access = ctx.shellAccess ?? 'full';
        if (access === 'disabled') throw new Error('Shell execution is disabled by computer access policy');
        const command = String(args.command);
        if (access === 'allowlist') {
          const allow = ctx.shellAllow || [];
          const deny = [...BUILTIN_SHELL_DENY, ...(ctx.shellDeny || [])];
          const lower = command.toLowerCase();
          if (deny.some((d) => lower.includes(d.toLowerCase()))) {
            throw new Error('Command blocked by shell denylist policy');
          }
          if (!allow.some((p) => command.trimStart().startsWith(p))) {
            throw new Error(`Command not in shell allowlist. Allowed prefixes: ${allow.join(', ') || '(none)'}`);
          }
        }
        const out = await ctx.shellExec(command, ctx.signal);
        return out.slice(0, 20000);
      },
    });

    this.register({
      name: 'pdf_read',
      description: 'Extracts text from a PDF file in the workspace (proposals, contracts, reports, invoices).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the .pdf file relative to the workspace' },
          maxPages: { type: 'number', description: 'Max pages to extract (default 20)' },
        },
        required: ['path'],
      },
      handler: async (args, ctx) => {
        const p = resolveInWorkspace(ctx, String(args.path));
        const buf = await fs.readFile(p);
        const { text, totalPages } = await extractText(new Uint8Array(buf), { mergePages: true });
        const merged = Array.isArray(text) ? text.join('\n\n') : String(text ?? '');
        const max = Math.min(Number(args.maxPages) || 20, totalPages || 20);
        return `PDF (${totalPages} pages, showing ${max}):\n${merged.slice(0, 30000) || '(no extractable text — may be scanned/image-only)'}`;
      },
    });

    this.register({
      name: 'sheet_read',
      description: 'Reads a spreadsheet (.xlsx, .xls, .csv) from the workspace and returns rows as text. Use for budgets, schedules and tabular data.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the spreadsheet relative to the workspace' },
          sheet: { type: 'string', description: 'Sheet name (default: first sheet)' },
          maxRows: { type: 'number', description: 'Max rows to return (default 100)' },
        },
        required: ['path'],
      },
      handler: async (args, ctx) => {
        const p = resolveInWorkspace(ctx, String(args.path));
        const buf = await fs.readFile(p);
        const wb = XLSX.read(buf, { type: 'buffer' });
        const name = args.sheet ? String(args.sheet) : wb.SheetNames[0];
        const ws = wb.Sheets[name];
        if (!ws) throw new Error(`Sheet "${name}" not found. Available: ${wb.SheetNames.join(', ')}`);
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
        const max = Math.min(Number(args.maxRows) || 100, rows.length);
        const shown = rows.slice(0, max).map((r) => (r as unknown[]).map((c) => String(c ?? '')).join(' | ')).join('\n');
        return `Sheet "${name}" (${rows.length} rows, showing ${max}):\n${shown.slice(0, 20000)}`;
      },
    });

    this.register({
      name: 'sheet_write',
      description: 'Writes tabular data to a .csv or .xlsx file in the workspace. rows is a 2D array (first row = headers).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Output path relative to workspace (.csv or .xlsx)' },
          rows: { type: 'array', items: { type: 'array' }, description: '2D array of cell values; first row should be headers' },
          sheet: { type: 'string', description: 'Sheet name for .xlsx (default: Sheet1)' },
        },
        required: ['path', 'rows'],
      },
      handler: async (args, ctx) => {
        const p = resolveInWorkspace(ctx, String(args.path));
        const rows = args.rows;
        if (!Array.isArray(rows) || !rows.every((r) => Array.isArray(r))) {
          throw new Error('rows must be a 2D array');
        }
        await fs.mkdir(path.dirname(p), { recursive: true });
        if (/\.csv$/i.test(p)) {
          const esc = (v: unknown) => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          };
          await fs.writeFile(p, rows.map((r) => (r as unknown[]).map(esc).join(',')).join('\n'), 'utf8');
        } else {
          const ws = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, String(args.sheet || 'Sheet1').slice(0, 31));
          const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
          await fs.writeFile(p, out);
        }
        return `Wrote ${(rows as unknown[][]).length} rows to ${args.path}`;
      },
    });

    this.register({
      name: 'composio_search_tools',
      description: 'Searches available Composio actions (Gmail, Calendar, Slack, etc.) by describing what you need. Returns action slugs to use with composio_execute. Requires Composio to be configured and the app connected in Settings.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What you want to do, e.g. "send an email" or "list calendar events"' },
        },
        required: ['query'],
      },
      handler: async (args, ctx) => {
        if (!ctx.composioSearch) throw new Error('Composio is not configured');
        return ctx.composioSearch(String(args.query));
      },
    });

    this.register({
      name: 'composio_execute',
      description: 'Executes a Composio action (e.g. GMAIL_SEND_EMAIL) found via composio_search_tools. args is a JSON object string with the action parameters.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Action slug from composio_search_tools' },
          args: { type: 'string', description: 'JSON object string of action arguments' },
        },
        required: ['slug', 'args'],
      },
      handler: async (args, ctx) => {
        if (!ctx.composioExecute) throw new Error('Composio is not configured');
        return ctx.composioExecute(String(args.slug), String(args.args ?? '{}'));
      },
    });

    this.register({
      name: 'open_url',
      description: 'Opens a URL in the default web browser.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http(s) URL to open' },
        },
        required: ['url'],
      },
      handler: async (args, ctx) => {
        if (!ctx.openUrl) throw new Error('open_url is not available');
        const url = String(args.url);
        if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed');
        await ctx.openUrl(url);
        return `Opened ${url}`;
      },
    });
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  setContext(ctx: ToolContext): void {
    this.context = ctx;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): Array<{ name: string; description: string }> {
    return [...this.tools.values()].map((t) => ({ name: t.name, description: t.description }));
  }

  /** Returns only the requested tools that exist, as LLM-facing schemas. */
  schemasFor(names: string[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return names
      .map((n) => this.tools.get(n))
      .filter((t): t is ToolDefinition => !!t)
      .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  }

  async execute(name: string, args: Record<string, unknown>, policy?: ExecutionPolicy): Promise<string> {
    policy?.signal?.throwIfAborted();
    if (policy?.allowedTools && !policy.allowedTools.includes(name)) throw new Error(`Tool not authorized: ${name}`);
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (this.gate) {
      const denied = await this.gate(name, args, policy);
      if (denied) return denied;
    }
    policy?.signal?.throwIfAborted();
    const ctx = policy ? { ...this.context, ...policy } : this.context;
    return tool.handler(args, ctx);
  }
}

/** Resolves a workspace-relative path, rejecting traversal outside the root. */
const BUILTIN_SHELL_DENY = ['rm -rf /', 'rm -rf ~', 'mkfs', ':(){', 'dd if=', '> /dev/sd', 'shutdown', 'reboot'];

function resolveInWorkspace(ctx: ToolContext, rel: string): string {
  const access = ctx.fileAccess ?? 'workspace';
  if (access === 'full') {
    // Absolute paths allowed as-is; relative paths resolve against workspace.
    if (path.isAbsolute(rel)) return path.resolve(rel);
    if (!ctx.workspaceDir) throw new Error('Workspace is not configured');
    return path.resolve(ctx.workspaceDir, rel);
  }
  const canonical = (value: string): string => {
    if (existsSync(value)) return realpathSync(value);
    const parent = path.dirname(value);
    return parent === value ? value : path.join(canonical(parent), path.basename(value));
  };
  const roots = [ctx.workspaceDir, ...(access === 'authorized' ? ctx.allowedRoots || [] : [])]
    .filter((r): r is string => !!r)
    .map((r) => canonical(path.resolve(r)));
  if (roots.length === 0) throw new Error('Workspace is not configured');
  const resolved = canonical(path.isAbsolute(rel)
    ? path.resolve(rel)
    : path.resolve(roots[0], rel));
  const inside = roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
  if (!inside) {
    throw new Error(access === 'authorized'
      ? 'Path is outside the workspace and authorized directories'
      : 'Path escapes the workspace directory');
  }
  return resolved;
}

