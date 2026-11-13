import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry } from '../tools/registry.js';

export const mcpConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,19}$/),
  transport: z.enum(['stdio','http']), command: z.string().optional(), args: z.array(z.string()).default([]),
  url: z.string().optional(), tokenEnv: z.string().optional(), envNames: z.array(z.string()).default([]),
  enabled: z.boolean().default(false),
  automaticReadTools: z.array(z.string().min(1).max(200)).max(200).default([]),
});
export type McpConfig = z.infer<typeof mcpConfigSchema>;
export function mcpToolName(server: string, tool: string) {
  return `mcp_${server}_${tool.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,24)}_${createHash('sha256').update(tool).digest('hex').slice(0,8)}`;
}
export function validateEndpoint(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS, or HTTP on loopback, without URL credentials');
  return url;
}
export class McpManager {
  private automaticReads = new Set<string>();
  isAutomaticRead(name: string) { return this.automaticReads.has(name); }
  private clients = new Map<string, { client: Client; tools: string[] }>();
  private statuses: Array<{id:string; connected:boolean; tools:string[]; error?:string}> = [];
  constructor(private registry: ToolRegistry) {}
  list() { return structuredClone(this.statuses); }
  async configure(raw: unknown) {
    const configs = z.array(mcpConfigSchema).max(20).parse(raw);
    if (new Set(configs.map(c=>c.id)).size !== configs.length) throw new Error('MCP server IDs must be unique');
    await this.close(); this.statuses = [];
    for (const config of configs) {
      if (!config.enabled) { this.statuses.push({id:config.id,connected:false,tools:[]}); continue; }
      const client = new Client({name:'keepmind-os',version:'0.1.9'}, {capabilities:{}});
      const names: string[] = [];
      try {
        if (config.transport === 'stdio') {
          if (!config.command || !path.isAbsolute(config.command)) throw new Error('MCP command must be an absolute executable path');
          const env: Record<string,string> = {};
          for (const key of config.envNames) if (process.env[key]) env[key] = process.env[key]!;
          await client.connect(new StdioClientTransport({command:config.command,args:config.args,env,stderr:'ignore'}), {timeout:15_000});
        } else {
          const url = validateEndpoint(config.url || '');
          const token = config.tokenEnv ? process.env[config.tokenEnv] : undefined;
          if (config.tokenEnv && !token) throw new Error('MCP token environment variable is missing');
          await client.connect(new StreamableHTTPClientTransport(url, {
            requestInit: {headers:token ? {Authorization:`Bearer ${token}`} : undefined, redirect:'error'},
            fetch: (input, init) => fetch(input, {...init,redirect:'error'}),
          }), {timeout:15_000});
        }
        let cursor: string | undefined; let pages = 0;
        do {
          const page = await client.listTools(cursor ? {cursor} : undefined, {timeout:15_000});
          for (const tool of page.tools) {
            if (names.length >= 200) throw new Error('MCP tool limit exceeded');
            const name = mcpToolName(config.id, tool.name);
            if (names.includes(name)) throw new Error('Duplicate MCP tool');
            names.push(name);
            // Owner opt-in AND server declaration are required; annotations alone grant nothing.
            if (config.automaticReadTools.includes(tool.name) && tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false) this.automaticReads.add(name);
            this.registry.register({name, description:`[MCP ${config.id}] ${tool.description || tool.name}`.slice(0,3000), parameters:tool.inputSchema,
              handler: async (args, ctx) => {
                const result = await client.callTool({name:tool.name,arguments:args}, undefined, {signal:ctx.signal,timeout:60_000});
                if (result.isError) throw new Error(`MCP tool reported an error: ${JSON.stringify(result.content).slice(0,2000)}`);
                return JSON.stringify(result).slice(0,32000);
              }});
          }
          cursor = page.nextCursor;
          if (++pages >= 10 && cursor) throw new Error('MCP pagination limit exceeded');
        } while (cursor);
        this.clients.set(config.id,{client,tools:names}); this.statuses.push({id:config.id,connected:true,tools:names});
      } catch {
        for (const name of names) { this.registry.unregister(name); this.automaticReads.delete(name); }
        await client.close().catch(()=>{});
        // Third-party messages can include credentials; detailed errors stay with the server owner.
        this.statuses.push({id:config.id,connected:false,tools:[],error:'Connection failed. Verify command/URL, environment and MCP server logs.'});
      }
    }
    return this.list();
  }
  async close() {
    for (const {client,tools} of this.clients.values()) { for (const name of tools) this.registry.unregister(name); await client.close().catch(()=>{}); }
    this.clients.clear(); this.automaticReads.clear();
  }
}
