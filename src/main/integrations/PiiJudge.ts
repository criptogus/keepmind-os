/**
 * Second-layer PII check for corporate-brain writes. The regex guard in
 * SecondBrainManager catches structured identifiers (CPF, phone, card);
 * this judge catches unstructured personal data ("o João da Silva, morador
 * da Rua X") using a cheap LLM call. Only runs when a raw provider API key
 * is available (BYOK or corp-resolved) — OAuth-only setups keep regex-only.
 * Fails open on errors so a provider outage never blocks legitimate writes.
 */

export type PiiKeyResolver = () => { openai?: string; anthropic?: string };

const PROMPT = `You are a data-classification gate. Decide if the text contains PERSONAL data about an identifiable private individual that must NOT be stored in a CORPORATE knowledge base.

BLOCK (answer YES) when the text contains things like: a person's full name tied to private life details (home address, health, family, personal finances, documents like RG/CNH/passport numbers, personal email/phone), salary/benefits of a specific employee, medical or legal personal matters.

ALLOW (answer NO) when the text is: corporate information, work roles/titles without private details, publicly known business contacts, generic statements, technical/financial data about the company, or professional information that legitimately belongs in a company brain (e.g. "CMO João Silva" is fine; "João Silva's home address is..." is not).

Answer with exactly YES or NO, nothing else.

Text:
"""`;

async function askOpenAI(key: string, text: string): Promise<string | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 4,
      temperature: 0,
      messages: [{ role: 'user', content: PROMPT + text.slice(0, 4000) + '"""' }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
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
      max_tokens: 4,
      temperature: 0,
      messages: [{ role: 'user', content: PROMPT + text.slice(0, 4000) + '"""' }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find((b) => b.type === 'text')?.text?.trim() ?? null;
}

/** Returns true when the text looks like personal data (block the write). */
export async function judgePii(text: string, resolveKeys: PiiKeyResolver): Promise<boolean> {
  const keys = resolveKeys();
  let answer: string | null = null;
  if (keys.openai) answer = await askOpenAI(keys.openai, text).catch(() => null);
  if (!answer && keys.anthropic) answer = await askAnthropic(keys.anthropic, text).catch(() => null);
  if (!answer) return false; // fail-open: regex guard already ran
  return /^y(es)?\b/i.test(answer);
}
