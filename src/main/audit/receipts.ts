import { createHash } from 'node:crypto';
import type { AuditEntry, ExecutionToolCall } from '../../shared/types.js';

export const RECEIPT_FORMAT = 'keepmind-audit-receipt';
export const RECEIPT_VERSION = 1;

export interface ReceiptEntry extends AuditEntry {
  /** sha256 over prevHash + canonical entry — tamper-evident chain link. */
  receiptHash: string;
}

export interface ToolCallReceiptEntry extends ExecutionToolCall {
  receiptHash: string;
}

export interface AuditReceipt {
  format: typeof RECEIPT_FORMAT;
  version: number;
  generatedAt: string;
  app: string;
  appVersion: string;
  entryCount: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  chain: {
    algorithm: 'sha256';
    genesis: string;
    head: string;
  };
  entries: ReceiptEntry[];
  /** Tool calls agents executed — second hash chain covering "what was touched". */
  toolCalls?: {
    count: number;
    chain: { algorithm: 'sha256'; genesis: string; head: string };
    entries: ToolCallReceiptEntry[];
  };
}

/** Canonical JSON (sorted keys, recursively) — same scheme as approval arg hashing. */
function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val);
}

const GENESIS = '0'.repeat(64);

function entryHash(prevHash: string, entry: AuditEntry): string {
  const { receiptHash: _omit, ...rest } = entry as ReceiptEntry;
  return createHash('sha256')
    .update(prevHash + canonicalJson(rest))
    .digest('hex');
}

/**
 * Builds a tamper-evident receipt over audit entries. Entries are sorted
 * chronologically (oldest first) so the chain reads like a ledger.
 */
function toolCallHash(prevHash: string, call: ExecutionToolCall): string {
  const { receiptHash: _omit, ...rest } = call as ToolCallReceiptEntry;
  return createHash('sha256')
    .update(prevHash + canonicalJson(rest))
    .digest('hex');
}

export function buildAuditReceipt(entries: AuditEntry[], appVersion: string, toolCalls: ExecutionToolCall[] = []): AuditReceipt {
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let prev = GENESIS;
  const chained: ReceiptEntry[] = sorted.map((entry) => {
    const hash = entryHash(prev, entry);
    prev = hash;
    return { ...entry, receiptHash: hash };
  });

  let toolPrev = GENESIS;
  const sortedCalls = [...toolCalls].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt));
  const chainedCalls: ToolCallReceiptEntry[] = sortedCalls.map((call) => {
    const hash = toolCallHash(toolPrev, call);
    toolPrev = hash;
    return { ...call, receiptHash: hash };
  });

  return {
    format: RECEIPT_FORMAT,
    version: RECEIPT_VERSION,
    generatedAt: new Date().toISOString(),
    app: 'KeepMind OS',
    appVersion,
    entryCount: chained.length,
    firstTimestamp: chained[0]?.timestamp,
    lastTimestamp: chained[chained.length - 1]?.timestamp,
    chain: { algorithm: 'sha256', genesis: GENESIS, head: prev },
    entries: chained,
    toolCalls: {
      count: chainedCalls.length,
      chain: { algorithm: 'sha256', genesis: GENESIS, head: toolPrev },
      entries: chainedCalls,
    },
  };
}

/** Recomputes the chain; returns the index of the first broken link or -1. */
export function verifyAuditReceipt(receipt: AuditReceipt): number {
  let prev = GENESIS;
  for (let i = 0; i < receipt.entries.length; i++) {
    const expected = entryHash(prev, receipt.entries[i]);
    if (expected !== receipt.entries[i].receiptHash) return i;
    prev = expected;
  }
  if (prev !== receipt.chain.head) return receipt.entries.length;

  if (receipt.toolCalls) {
    let tPrev = GENESIS;
    for (let i = 0; i < receipt.toolCalls.entries.length; i++) {
      const expected = toolCallHash(tPrev, receipt.toolCalls.entries[i]);
      if (expected !== receipt.toolCalls.entries[i].receiptHash) return i;
      tPrev = expected;
    }
    if (tPrev !== receipt.toolCalls.chain.head) return receipt.toolCalls.entries.length;
  }
  return -1;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Self-contained printable HTML receipt (browser print → PDF). */
export function renderReceiptHtml(receipt: AuditReceipt): string {
  const rows = receipt.entries.map((e, i) => `
    <tr>
      <td class="mono dim">${esc(e.timestamp)}</td>
      <td>${esc(e.agentName)}</td>
      <td class="mono">${esc(e.action)}</td>
      <td class="mono dim" title="${esc(JSON.stringify(e.input))}">${esc(JSON.stringify(e.input)).slice(0, 120)}</td>
      <td class="mono dim" title="${esc(JSON.stringify(e.output))}">${esc(JSON.stringify(e.output)).slice(0, 120)}</td>
      <td class="mono dim">${esc(e.receiptHash.slice(0, 12))}…</td>
    </tr>`).join('');

  const toolRows = (receipt.toolCalls?.entries ?? []).map((c) => `
    <tr>
      <td class="mono dim">${esc(c.createdAt)}</td>
      <td class="mono dim">${esc(c.executionId.slice(0, 8))}…</td>
      <td>${esc(c.kind)}</td>
      <td class="mono">${esc(c.name)}</td>
      <td class="mono dim" title="${esc(c.args ? JSON.stringify(c.args) : '')}">${esc(c.args ? JSON.stringify(c.args) : '').slice(0, 120)}</td>
      <td class="mono dim" title="${esc(c.error ?? c.result ?? '')}">${esc((c.error ? `error: ${c.error}` : c.result ?? '')).slice(0, 120)}</td>
      <td class="mono dim">${esc(c.receiptHash.slice(0, 12))}…</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KeepMind OS — Audit Receipt</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 32px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #666; margin-bottom: 20px; }
  .meta { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 20px; }
  .meta div span { display: block; color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .meta div strong { font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #888; border-bottom: 2px solid #111; padding: 6px 8px; }
  td { border-bottom: 1px solid #eee; padding: 6px 8px; vertical-align: top; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .dim { color: #666; }
  .chain { margin-top: 24px; padding: 12px; background: #f6f6f6; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 10px; word-break: break-all; }
  .foot { margin-top: 24px; color: #888; font-size: 10px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>KeepMind OS — Audit Receipt</h1>
  <div class="sub">Tamper-evident record of agent and governance activity. Verify the hash chain with <code>verifyAuditReceipt()</code>.</div>
  <div class="meta">
    <div><span>Generated</span><strong>${esc(receipt.generatedAt)}</strong></div>
    <div><span>App version</span><strong>${esc(receipt.appVersion)}</strong></div>
    <div><span>Entries</span><strong>${receipt.entryCount}</strong></div>
    <div><span>Tool calls</span><strong>${receipt.toolCalls?.count ?? 0}</strong></div>
    <div><span>Period</span><strong>${esc(receipt.firstTimestamp ?? '—')} → ${esc(receipt.lastTimestamp ?? '—')}</strong></div>
  </div>
  <table>
    <thead><tr><th>Timestamp</th><th>Agent</th><th>Action</th><th>Input</th><th>Output</th><th>Hash</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${receipt.toolCalls && receipt.toolCalls.entries.length > 0 ? `
  <h2 style="font-size:14px;margin-top:28px;">Tool calls (${receipt.toolCalls.count})</h2>
  <table>
    <thead><tr><th>Timestamp</th><th>Execution</th><th>Kind</th><th>Tool</th><th>Args</th><th>Result</th><th>Hash</th></tr></thead>
    <tbody>${toolRows}</tbody>
  </table>` : ''}
  ${receipt.toolCalls ? `<div class="chain"><strong>Tool-call chain head (sha256):</strong> ${receipt.toolCalls.chain.head}</div>` : ''}
  <div class="chain"><strong>Chain head (sha256):</strong> ${receipt.chain.head}<br><strong>Genesis:</strong> ${receipt.chain.genesis}</div>
  <div class="foot">Each entry's hash covers the previous hash plus the canonical entry content. Any modification breaks verification from that point forward.</div>
</body>
</html>`;
}
