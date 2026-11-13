import { createHash } from 'node:crypto';
import type { WorkStorage } from '../work/WorkManager.js';

export class CheckpointError extends Error {}
export interface ToolStep {
  key: string; name: string; args: Record<string, unknown>;
  state: 'pending' | 'started' | 'done'; result?: string; approvalId?: string;
  reconciledBy?: string; reconciledAt?: string;
}
interface Checkpoint {
  version: 1; identity: string; systemPrompt: string;
  responses: Record<string, unknown>; tools: Record<string, ToolStep>;
  output?: Record<string, unknown>;
}
export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)).digest('hex');

/** Write-ahead journal. A started handler is ambiguous until its result is durable. */
export class CheckpointStore {
  constructor(private storage: WorkStorage) {}
  private key(id: string) { return `execution.checkpoint.v1.${id}`; }
  read(id: string): Checkpoint | undefined {
    const raw = this.storage.getSetting(this.key(id));
    return raw ? JSON.parse(raw) : undefined;
  }
  private save(id: string, value: Checkpoint) { this.storage.setSetting(this.key(id), JSON.stringify(value)); }
  open(id: string, identity: unknown, systemPrompt: string): Checkpoint {
    const existing = this.read(id); const hash = fingerprint(identity);
    if (existing) {
      if (existing.version !== 1 || existing.identity !== hash) throw new CheckpointError('Execution configuration changed. Restore the original configuration to resume.');
      return existing;
    }
    const created: Checkpoint = { version: 1, identity: hash, systemPrompt, responses: {}, tools: {} };
    this.save(id, created); return created;
  }
  private require(id: string) { const cp = this.read(id); if (!cp) throw new CheckpointError('Execution checkpoint unavailable'); return cp; }
  async response<T>(id: string, key: string, call: () => Promise<T>): Promise<T> {
    const cp = this.require(id);
    if (Object.hasOwn(cp.responses, key)) return structuredClone(cp.responses[key]) as T;
    const result = await call();
    cp.responses[key] = result; this.save(id, cp); return result;
  }
  complete(id: string, output: Record<string, unknown>) { const cp = this.require(id); cp.output = output; this.save(id, cp); }
  steps(id: string): ToolStep[] { return Object.values(this.read(id)?.tools ?? {}); }
  approval(id: string, key: string, approvalId?: string): string | undefined {
    const cp = this.require(id); const step = cp.tools[key];
    if (!step) throw new CheckpointError('Tool checkpoint unavailable');
    if (approvalId) { step.approvalId = approvalId; this.save(id, cp); }
    return step.approvalId;
  }
  reconcile(id: string, key: string, result: string, reviewer: string) {
    const cp = this.require(id); const step = cp.tools[key];
    if (!step || step.state !== 'started') throw new CheckpointError('Only an uncertain tool effect can be reconciled');
    if (!result.trim() || result.length > 32000) throw new CheckpointError('Provide the verified result (up to 32000 characters)');
    step.state = 'done'; step.result = result; step.reconciledBy = reviewer; step.reconciledAt = new Date().toISOString();
    this.save(id, cp);
  }
  async tool(id: string, key: string, name: string, args: Record<string, unknown>, call: (started: () => void) => Promise<string>): Promise<string> {
    let cp = this.require(id); let step = cp.tools[key];
    if (step && (step.name !== name || fingerprint(step.args) !== fingerprint(args))) throw new CheckpointError('Tool call changed since checkpoint');
    if (step?.state === 'done') return step.result!;
    if (step?.state === 'started') throw new CheckpointError(`Uncertain effect: ${name}. Verify the external result and reconcile step ${key} before resuming.`);
    if (!step) { cp.tools[key] = { key, name, args: structuredClone(args), state: 'pending' }; this.save(id, cp); }
    // Re-read after the approval gate: its decision binding may have updated this row.
    const result = await call(() => { cp = this.require(id); cp.tools[key].state = 'started'; this.save(id, cp); });
    cp = this.require(id); cp.tools[key].state = 'done'; cp.tools[key].result = result;
    try { this.save(id, cp); } catch { throw new CheckpointError('Tool completed but its result could not be saved. Verify its effect before resuming.'); }
    return result;
  }
}
