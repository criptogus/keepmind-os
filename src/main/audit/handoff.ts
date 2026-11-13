import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed agent handoffs — "notarized continuity" v1.
 *
 * A handoff is a Markdown document with a YAML-ish frontmatter block. The
 * signature is HMAC-SHA256 over the canonical payload + body hash, keyed by a
 * secret only this installation holds (CredentialStore). Any agent or human
 * can verify a handoff file later: tampering with the task, the result hash,
 * or the body breaks the signature.
 *
 * Format (KeepMind Memory Protocol — see docs/MEMORY-PROTOCOL.md):
 *
 *   ---
 *   keepmind_handoff: 1
 *   from: <agent>
 *   to: <agent>
 *   execution_id: <id>
 *   timestamp: <iso>
 *   depth: <n>
 *   result_hash: <sha256 of result text, optional>
 *   body_sha256: <sha256 of markdown body>
 *   signature: <hmac-sha256 hex>
 *   ---
 *   <markdown body: task + result summary>
 */

export const HANDOFF_FORMAT = 'keepmind-handoff';
export const HANDOFF_VERSION = 1;

export interface HandoffPayload {
  from: string;
  to: string;
  executionId?: string;
  timestamp: string;
  depth?: number;
  resultHash?: string;
  bodySha256: string;
}

export interface HandoffDoc extends HandoffPayload {
  body: string;
  signature: string;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  payload?: HandoffPayload;
}

/** Canonical JSON (sorted keys, recursively) — same scheme as receipts/approvals. */
function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The exact bytes the signature covers. */
export function handoffSigningInput(p: HandoffPayload): string {
  return canonicalJson({
    format: HANDOFF_FORMAT,
    version: HANDOFF_VERSION,
    from: p.from,
    to: p.to,
    executionId: p.executionId ?? null,
    timestamp: p.timestamp,
    depth: p.depth ?? null,
    resultHash: p.resultHash ?? null,
    bodySha256: p.bodySha256,
  });
}

export function signHandoff(p: HandoffPayload, key: string): string {
  return createHmac('sha256', key).update(handoffSigningInput(p), 'utf8').digest('hex');
}

export function verifyHandoffSignature(p: HandoffPayload, signature: string, key: string): boolean {
  const expected = signHandoff(p, key);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseScalar(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** Parses a handoff markdown doc into payload + body + signature. */
export function parseHandoffDoc(markdown: string): HandoffDoc | null {
  const m = FRONTMATTER_RE.exec(markdown);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    fields[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1));
  }
  if (fields.keepmind_handoff !== '1' || !fields.signature) return null;
  if (!fields.from || !fields.to || !fields.timestamp) return null;
  return {
    from: fields.from,
    to: fields.to,
    executionId: fields.execution_id || undefined,
    timestamp: fields.timestamp,
    depth: fields.depth ? Number(fields.depth) : undefined,
    resultHash: fields.result_hash || undefined,
    bodySha256: fields.body_sha256 || '',
    body: m[2] ?? '',
    signature: fields.signature,
  };
}

export function verifyHandoffDoc(markdown: string, key: string): VerifyResult {
  const doc = parseHandoffDoc(markdown);
  if (!doc) return { ok: false, reason: 'not a keepmind handoff document' };
  const { signature, body, ...rest } = doc;
  const actualBodyHash = sha256(body.replace(/\r\n/g, '\n'));
  if (doc.bodySha256 && doc.bodySha256 !== actualBodyHash) {
    return { ok: false, reason: 'body hash mismatch — content was modified', payload: rest };
  }
  const payload: HandoffPayload = { ...rest, bodySha256: actualBodyHash };
  if (!verifyHandoffSignature(payload, signature, key)) {
    return { ok: false, reason: 'signature mismatch — handoff was forged or tampered', payload };
  }
  return { ok: true, payload };
}

const esc = (s: string) => s.replace(/"/g, '\\"');

/** Builds a signed handoff markdown document. */
export function createHandoffDoc(opts: {
  from: string;
  to: string;
  task: string;
  result?: string;
  executionId?: string;
  depth?: number;
  key: string;
}): string {
  const timestamp = new Date().toISOString();
  const resultHash = opts.result !== undefined ? sha256(opts.result) : undefined;
  const bodyLines = [
    `# Handoff: ${opts.from} → ${opts.to}`,
    '',
    '## Task',
    '',
    opts.task,
    '',
  ];
  if (opts.result !== undefined) {
    bodyLines.push('## Result', '', opts.result.slice(0, 8000), '');
  }
  const body = bodyLines.join('\n');
  const bodySha256 = sha256(body);
  const payload: HandoffPayload = {
    from: opts.from,
    to: opts.to,
    executionId: opts.executionId,
    timestamp,
    depth: opts.depth,
    resultHash,
    bodySha256,
  };
  const signature = signHandoff(payload, opts.key);

  const fm = [
    '---',
    'keepmind_handoff: 1',
    `from: "${esc(opts.from)}"`,
    `to: "${esc(opts.to)}"`,
    opts.executionId ? `execution_id: "${esc(opts.executionId)}"` : null,
    `timestamp: "${timestamp}"`,
    opts.depth !== undefined ? `depth: ${opts.depth}` : null,
    resultHash ? `result_hash: ${resultHash}` : null,
    `body_sha256: ${bodySha256}`,
    `signature: ${signature}`,
    '---',
    '',
  ].filter((l): l is string => l !== null).join('\n');

  return fm + body;
}

/** Generates or loads the installation handoff signing key (hex). */
export function ensureHandoffKey(get: () => string | null, set: (v: string) => void): string {
  const existing = get();
  if (existing && existing.length >= 32) return existing;
  const key = randomBytes(32).toString('hex');
  set(key);
  return key;
}
