import { join } from 'node:path';
import { audit, authorizeContent, checkedPath, gateCall, KeepMindDeniedError } from './gate';
import { clientIdFor, spaceFor, vaultDir } from './map';
import { writeScopes } from './scopes';
import type { KeepMindTransport, TransportContext } from './transport';
export class KeepMindUnavailableError extends Error {
    constructor() { super('KeepMind unavailable'); this.name = 'KeepMindUnavailableError'; }
}
export interface MemoryHit { path: string; space: string; class: 'public' | 'internal'; snippet: string }
export interface ServiceOptions {
    dataRoot: string;
    companyId: string;
    transportFactory: (context: TransportContext) => KeepMindTransport;
}
export class KeepMindService {
    readonly companyId: string;
    private vault: string;
    private auditFile: string;
    private transport?: KeepMindTransport;
    private factory: () => KeepMindTransport;
    constructor(options: ServiceOptions) {
        this.companyId = options.companyId;
        clientIdFor(this.companyId);
        this.vault = vaultDir(options.dataRoot, this.companyId);
        this.auditFile = join(options.dataRoot, 'keepmind', 'audit.jsonl');
        this.factory = () => options.transportFactory({ companyId: this.companyId, vault: this.vault, scopesPath: writeScopes(options.dataRoot, this.companyId) });
    }
    private getTransport() { return this.transport ??= this.factory(); }
    async health(): Promise<boolean> {
        let ok = false;
        try { checkedPath(this.vault, ''); ok = await this.getTransport().health(); } catch { /* sanitized below */ }
        audit(this.auditFile, this.companyId, 'health', ok, undefined, ok ? undefined : 'unavailable');
        if (!ok) throw new KeepMindUnavailableError();
        return true;
    }
    search(query: string) { return this.call('sb_search', { query }) as Promise<MemoryHit[]>; }
    read(path: string) { return this.call('sb_read', { path }) as Promise<string>; }
    list(dir?: string) { return this.call('sb_list', dir === undefined ? {} : { dir }) as Promise<MemoryHit[]>; }
    recent(days?: number) { return this.call('sb_recent', days === undefined ? {} : { days }) as Promise<MemoryHit[]>; }
    // Main-process boundary for tool dispatch. Never pass authority from tool args.
    async call(tool: string, args: Record<string, unknown>): Promise<string | MemoryHit[]> {
        const path = typeof args?.path === 'string' ? args.path : typeof args?.dir === 'string' ? args.dir : undefined;
        let normalized = tool;
        try {
            const call = gateCall(tool, args); normalized = call.tool;
            if (path !== undefined) checkedPath(this.vault, path);
            await this.health();
            const raw = await this.getTransport().call(call.tool, call.args);
            let result: string | MemoryHit[];
            if (call.tool === 'sb_read') result = this.authorizedRead(raw);
            else {
                const paths = this.candidates(raw, call.tool);
                const hits: MemoryHit[] = [];
                for (const candidate of paths.slice(0, 1000)) {
                    try {
                        checkedPath(this.vault, candidate);
                        const content = this.authorizedRead(await this.getTransport().call('sb_read', { path: candidate }));
                        // Return only fields built from authorized content; never trust raw snippets.
                        hits.push({ path: candidate, space: spaceFor(this.companyId), class: /^class:[ \t]*public\s*$/m.test(content) ? 'public' : 'internal', snippet: content.slice(0, 500) });
                        audit(this.auditFile, this.companyId, call.tool, true, candidate);
                    } catch (error) {
                        audit(this.auditFile, this.companyId, call.tool, false, candidate, error instanceof KeepMindDeniedError ? 'denied' : 'unavailable');
                        if (!(error instanceof KeepMindDeniedError)) throw new KeepMindUnavailableError();
                    }
                    if (call.tool === 'sb_search' && hits.length >= Number(call.args.limit)) break;
                }
                result = hits;
            }
            audit(this.auditFile, this.companyId, call.tool, true, path);
            return result;
        } catch (error) {
            audit(this.auditFile, this.companyId, normalized, false, path, error instanceof KeepMindDeniedError ? 'denied' : 'unavailable');
            if (error instanceof KeepMindDeniedError) throw error;
            throw new KeepMindUnavailableError();
        }
    }
    private authorizedRead(raw: unknown): string {
        if (typeof raw !== 'string' || !authorizeContent(raw, this.companyId)) throw new KeepMindDeniedError();
        return raw;
    }
    private candidates(raw: unknown, tool: string): string[] {
        if (typeof raw === 'object' && raw !== null && 'hits' in raw && Array.isArray(raw.hits)) {
            return raw.hits.flatMap((hit: unknown) => typeof hit === 'object' && hit !== null && 'path' in hit && typeof hit.path === 'string' ? [hit.path] : []);
        }
        if (typeof raw !== 'string') throw new KeepMindDeniedError();
        if (tool === 'sb_search') return [...raw.matchAll(/^## (.+) \(score [\d.]+\)$/gm)].map(m => m[1]);
        return raw.split('\n').map(line => tool === 'sb_recent' ? line.replace(/^\d{4}-\d{2}-\d{2}  /, '') : line).filter(line => line.endsWith('.md'));
    }
    dispose() { this.transport?.dispose(); }
}
