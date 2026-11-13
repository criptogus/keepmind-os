import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { authorizeContent, checkedPath, gateCall } from './gate';
import { clientIdFor } from './map';
import { scopesFor } from './scopes';
export interface KeepMindTransport {
    health(): Promise<boolean>;
    call(tool: string, args: Record<string, unknown>): Promise<unknown>;
    dispose(): void;
}
export interface TransportContext { companyId: string; vault: string; scopesPath: string }
export interface StdioOptions extends TransportContext {
    keepmindPackageRoot?: string;
    entry?: string;
    node?: string;
    allowPlaintextFixtures?: boolean;
    timeoutMs?: number;
}
export class StdioKeepMindTransport implements KeepMindTransport {
    private child: ChildProcessWithoutNullStreams;
    private id = 0;
    private pending = new Map<number, { resolve: (v: unknown) => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
    private ready: Promise<unknown>;
    private closed = false;
    constructor(private options: StdioOptions, spawnProcess: typeof spawn = spawn) {
        const entry = options.entry ?? process.env.KEEPMIND_MCP_ENTRY ?? (options.keepmindPackageRoot ? join(options.keepmindPackageRoot, 'tools', 'keepmind-mcp.mjs') : undefined);
        if (!entry) throw new Error('KeepMind MCP entry required');
        // 097f02fb consumes a flat client map. Keep the public scopes.json contract
        // wrapped, and give this MCP version an equivalent, single-client map.
        const runtimeScopes = join(dirname(options.scopesPath), 'mcp-scopes.json');
        writeFileSync(runtimeScopes, JSON.stringify(scopesFor(options.companyId).clients), { mode: 0o600 });
        // Deliberately do not inherit KeepMind config, unlock material, NODE_OPTIONS,
        // provider credentials or arbitrary ambient environment.
        this.child = spawnProcess(options.node ?? 'node', [entry], { stdio: 'pipe', env: {
            PATH: process.env.PATH,
            KEEPMIND_MCP_CLIENT: clientIdFor(options.companyId),
            KEEPMIND_MCP_SCOPES: runtimeScopes,
            KEEPMIND_MEMORY_DIR: options.vault,
            ...(options.allowPlaintextFixtures === true ? { KEEPMIND_MCP_ALLOW_PLAINTEXT: 'true' } : {})
        } });
        const lines = createInterface({ input: this.child.stdout });
        lines.on('line', line => {
            try {
                const message = JSON.parse(line);
                const p = this.pending.get(message.id);
                if (!p) return;
                clearTimeout(p.timer); this.pending.delete(message.id);
                if (message.error) p.reject(); else p.resolve(message.result);
            } catch { this.dispose(); }
        });
        this.child.stdout.on('data', chunk => { if (chunk.length > 4 * 1024 * 1024) this.dispose(); });
        this.child.stderr.resume(); // Never forward vault diagnostics to logs or callers.
        this.child.on('error', () => this.dispose());
        this.child.on('exit', () => this.dispose());
        this.ready = this.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'keepmind-os', version: '0.1.0' } }).then(() => {
            if (!this.closed) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        });
        void this.ready.catch(() => {});
    }
    private rpc(method: string, params: unknown = {}): Promise<unknown> {
        if (this.closed) return Promise.reject(new Error('KeepMind unavailable'));
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            const fail = () => reject(new Error('KeepMind unavailable'));
            const timer = setTimeout(() => { this.pending.delete(id); fail(); this.dispose(); }, this.options.timeoutMs ?? 5000);
            this.pending.set(id, { resolve, reject: fail, timer });
            this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => { if (error) this.dispose(); });
        });
    }
    async health() {
        try { await this.ready; await this.rpc('ping'); await this.call('sb_list', {}); return true; } catch { return false; }
    }
    async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
        const call = gateCall(tool, args);
        await this.ready;
        const result = await this.rpc('tools/call', { name: call.tool, arguments: call.args }) as { isError?: boolean; content?: { type: string; text: string }[] };
        if (result.isError || !Array.isArray(result.content) || result.content.some(c => c.type !== 'text' || typeof c.text !== 'string')) throw new Error('KeepMind unavailable');
        return result.content.map(c => c.text).join('\n');
    }
    dispose() {
        this.closed = true;
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(); }
        this.pending.clear();
        if (!this.child.killed) this.child.kill();
    }
}
export class FixtureKeepMindTransport implements KeepMindTransport {
    private closed = false;
    constructor(private vault: string, private companyId: string) {}
    async health() { return !this.closed; }
    async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
        if (this.closed) throw new Error('KeepMind unavailable');
        const call = gateCall(tool, args);
        if (call.tool === 'sb_read') {
            const content = readFileSync(checkedPath(this.vault, String(call.args.path)), 'utf8');
            return authorizeContent(content, this.companyId) ? content : '';
        }
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(checkedPath(this.vault, dir), { withFileTypes: true })) {
                if (entry.isSymbolicLink()) continue;
                const path = dir ? `${dir}/${entry.name}` : entry.name;
                if (entry.isDirectory()) walk(path);
                else if (entry.isFile() && path.endsWith('.md')) files.push(path);
            }
        };
        walk('');
        const hits = files.flatMap(path => {
            const content = readFileSync(checkedPath(this.vault, path), 'utf8');
            if (!authorizeContent(content, this.companyId)) return [];
            if (call.tool === 'sb_search' && !content.toLowerCase().includes(String(call.args.query).toLowerCase())) return [];
            if (call.tool === 'sb_list' && call.args.dir && !path.startsWith(String(call.args.dir).replace(/\/$/, '') + '/')) return [];
            if (call.tool === 'sb_recent' && statSync(checkedPath(this.vault, path)).mtimeMs < Date.now() - Number(call.args.days) * 864e5) return [];
            return [{ path }];
        });
        return { hits: call.tool === 'sb_search' ? hits.slice(0, Number(call.args.limit)) : hits };
    }
    dispose() { this.closed = true; }
}
