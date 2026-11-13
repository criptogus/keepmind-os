import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/main/tools/registry.js';
import { buildAuditReceipt, verifyAuditReceipt, renderReceiptHtml } from '../src/main/audit/receipts.js';
import type { AuditEntry } from '../src/shared/types.js';

function entry(i: number, action = 'test_action'): AuditEntry {
  return {
    id: `e${i}`,
    timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    agentId: 'a1',
    agentName: 'Tester',
    action,
    input: { i },
    output: { ok: true },
    metadata: {},
  };
}

describe('dry-run tool policy', () => {
  it('returns a would-execute description and never runs the handler', async () => {
    const reg = new ToolRegistry();
    let ran = false;
    reg.register({
      name: 'side_effect',
      description: 'test',
      parameters: { type: 'object', properties: {} },
      handler: async () => { ran = true; return 'done'; },
    });
    const out = await reg.execute('side_effect', { x: 1 }, { dryRun: true });
    expect(out).toContain('[dry-run] would execute side_effect');
    expect(ran).toBe(false);
  });

  it('skips the governance gate in dry-run', async () => {
    const reg = new ToolRegistry();
    reg.setGate(async () => 'blocked by policy');
    const out = await reg.execute('get_current_time', {}, { dryRun: true });
    expect(out).toContain('[dry-run]');
  });

  it('still runs normally without dryRun', async () => {
    const reg = new ToolRegistry();
    const out = await reg.execute('get_current_time', {});
    expect(out).not.toContain('[dry-run]');
    expect(out).toContain('T'); // ISO timestamp
  });
});

describe('audit receipts', () => {
  it('builds a verifiable hash chain over entries', () => {
    const receipt = buildAuditReceipt([entry(2), entry(1), entry(3)], '0.1.9');
    expect(receipt.entryCount).toBe(3);
    expect(verifyAuditReceipt(receipt)).toBe(-1);
    // Chronological order
    expect(receipt.entries[0].id).toBe('e1');
  });

  it('detects tampering with an entry', () => {
    const receipt = buildAuditReceipt([entry(1), entry(2)], '0.1.9');
    receipt.entries[0].action = 'tampered';
    expect(verifyAuditReceipt(receipt)).toBe(0);
  });

  it('detects a missing/reordered chain head', () => {
    const receipt = buildAuditReceipt([entry(1), entry(2)], '0.1.9');
    receipt.chain.head = 'f'.repeat(64);
    expect(verifyAuditReceipt(receipt)).toBe(receipt.entries.length);
  });

  it('renders standalone HTML', () => {
    const receipt = buildAuditReceipt([entry(1)], '0.1.9');
    const html = renderReceiptHtml(receipt);
    expect(html).toContain('Audit Receipt');
    expect(html).toContain(receipt.chain.head);
    expect(html).toContain('test_action');
  });
});
