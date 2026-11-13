import type { ConsolidationVerdict, MemoryJudge } from './MemoryManager.js';
import type { PiiKeyResolver } from './PiiJudge.js';

/**
 * LLM judge for personal-brain memory consolidation — the semantic
 * counterpart of the lexical fallback in MemoryManager. One cheap call
 * classifies the new memory against each candidate as
 * same/refines/updates/contradicts/related/unrelated with a confidence.
 * Fails open (returns []) so a provider outage degrades to plain adds.
 */

const PROMPT = `You maintain a personal knowledge base. Given a NEW memory and candidate EXISTING memories, classify the relation of the new one to EACH candidate.

Actions:
- same: says the same thing (duplicate)
- refines: same claim, more precise or more complete
- updates: the world changed; the new one replaces the old (new value, new decision, new preference)
- contradicts: incompatible claims about the same thing at the same time
- related: same topic, different claim
- unrelated: different topic

Answer ONLY with JSON: {"verdicts":[{"id":"<candidate id>","action":"<one of the above>","confidence":0.0-1.0}]}
Include every candidate id exactly once.

NEW MEMORY:
"""`;

async function askOpenAI(key: string, text: string): Promise<string | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: text }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

async function askAnthropic(key: string, text: string): Promise<string | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      temperature: 0,
      messages: [{ role: 'user', content: text }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find((b) => b.type === 'text')?.text ?? null;
}

const VALID = new Set(['same', 'refines', 'updates', 'contradicts', 'related', 'unrelated']);

function parseVerdicts(raw: string | null): ConsolidationVerdict[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { verdicts?: Array<Record<string, unknown>> };
    return (data.verdicts || [])
      .map((v) => ({
        candidateId: String(v.id ?? ''),
        action: String(v.action ?? 'unrelated') as ConsolidationVerdict['action'],
        confidence: Math.max(0, Math.min(1, Number(v.confidence ?? 0.5))),
      }))
      .filter((v) => v.candidateId && VALID.has(v.action));
  } catch {
    return [];
  }
}

/** Builds a MemoryJudge backed by the cheapest configured provider key. */
export function createMemoryJudge(resolveKeys: PiiKeyResolver): MemoryJudge {
  return async (content, candidates) => {
    const keys = resolveKeys();
    const candText = candidates
      .map((c, i) => `--- candidate ${i} (id: ${c.id}) ---\n${c.content.slice(0, 1500)}`)
      .join('\n\n');
    const prompt = `${PROMPT}${content.slice(0, 3000)}"""\n\nEXISTING MEMORIES:\n${candText}\n\nJSON:`;

    let raw: string | null = null;
    if (keys.openai) raw = await askOpenAI(keys.openai, prompt).catch(() => null);
    if (!raw && keys.anthropic) raw = await askAnthropic(keys.anthropic, prompt).catch(() => null);
    return parseVerdicts(raw);
  };
}
