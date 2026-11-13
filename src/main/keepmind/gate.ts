import { createHash } from 'node:crypto';
import { existsSync, realpathSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { clientIdFor, spaceFor } from './map';
export class KeepMindDeniedError extends Error {
    constructor() { super('KeepMind access denied'); this.name = 'KeepMindDeniedError'; }
}
export type Tool = 'sb_search' | 'sb_read' | 'sb_list' | 'sb_recent';
const fields: Record<Tool, string[]> = { sb_search: ['query', 'limit'], sb_read: ['path'], sb_list: ['dir'], sb_recent: ['days'] };
export function gateCall(tool: string, args: Record<string, unknown>): { tool: Tool; args: Record<string, unknown> } {
    const name = tool === 'search' ? 'sb_search' : tool === 'read' ? 'sb_read' : tool;
    if (!Object.hasOwn(fields, name) || !args || typeof args !== 'object' || Array.isArray(args)) throw new KeepMindDeniedError();
    const t = name as Tool;
    if (Object.keys(args).some(k => !fields[t].includes(k))) throw new KeepMindDeniedError();
    const clean = { ...args };
    if (t === 'sb_search') {
        if (typeof args.query !== 'string' || args.query.length > 4096) throw new KeepMindDeniedError();
        clean.limit = cap(args.limit, 8);
    }
    if (t === 'sb_recent') clean.days = cap(args.days, 7);
    if (t === 'sb_read' && (typeof args.path !== 'string' || !args.path)) throw new KeepMindDeniedError();
    if (t === 'sb_list' && args.dir !== undefined && typeof args.dir !== 'string') throw new KeepMindDeniedError();
    return { tool: t, args: clean };
}
function cap(value: unknown, maximum: number) {
    if (value === undefined) return maximum;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new KeepMindDeniedError();
    return Math.min(value, maximum);
}
export function checkedPath(vault: string, path: string): string {
    if (typeof path !== 'string' || path.includes('\0') || path.includes('\\') || isAbsolute(path) || win32.isAbsolute(path) || path.split('/').includes('..')) throw new KeepMindDeniedError();
    const root = resolve(vault), target = resolve(root, path);
    if (target !== root && !target.startsWith(root + sep)) throw new KeepMindDeniedError();
    // Also reject a symlinked company/vault root, not just links inside it.
    let ancestor = target;
    while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
    if (realpathSync(ancestor) !== ancestor) throw new KeepMindDeniedError();
    if (relative(root, target).startsWith('..')) throw new KeepMindDeniedError();
    return target;
}
export function authorizeContent(content: string, companyId: string): boolean {
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!fm) return false;
    const values = (key: string) => [...fm.matchAll(new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)$`, 'gm'))].map(m => m[1].trim());
    const spaces = values('space'), classes = values('class'), overrides = values('class_override');
    if (spaces.length !== 1 || spaces[0] !== spaceFor(companyId) || classes.length !== 1 || !['public', 'internal'].includes(classes[0])) return false;
    if (overrides.length > 1 || overrides.some(c => !['public', 'internal'].includes(c))) return false;
    // Match upstream automatic elevation for credentials and personal identifiers.
    if (/\b(?:sk-|ghp_|xox[a-z]-|AKIA)|-----BEGIN .*PRIVATE KEY-----|\beyJ[\w-]+\.[\w-]+\.[\w-]+/.test(content)) return false;
    if (/\b[^\s@]+@[^\s@]+\.[^\s@]+|(?:\+\d{8,15}\b|\b\d{10,15}\b)|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b|(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,3}\)[ .-]?|\b\d{2,3}[ .-])\d{4,5}[ .-]?\d{4}\b/.test(content)) return false;
    return true;
}
const auditTools = new Set(['health', 'search', 'read', ...Object.keys(fields), 'sb_write', 'sb_append', 'sb_remember', 'sb_supersede', 'sb_tasks', 'sb_tree', 'sb_query', 'learning_list', 'learning_search', 'learning_check_public']);
export function audit(file: string, companyId: string, tool: string, allowed: boolean, path?: string, reason?: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), companyId, clientId: clientIdFor(companyId), tool: auditTools.has(tool) ? tool : 'denied_tool', ...(path === undefined ? {} : { pathHash: createHash('sha256').update(path).digest('hex') }), allowed, ...(reason ? { reason } : {}) }) + '\n', { mode: 0o600 });
}
