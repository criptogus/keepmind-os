import { describe, it, expect, afterEach, vi } from 'vitest';
import { judgePii } from '../src/main/integrations/PiiJudge.js';

const openaiOk = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});
const anthropicOk = (text: string) => ({
  ok: true,
  json: async () => ({ content: [{ type: 'text', text }] }),
});

describe('judgePii', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns false when no keys are configured', async () => {
    expect(await judgePii('anything', () => ({}))).toBe(false);
  });

  it('blocks when OpenAI answers YES', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openaiOk('YES')));
    expect(await judgePii('João mora na Rua X', () => ({ openai: 'sk-test' }))).toBe(true);
  });

  it('allows when the model answers NO', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openaiOk('NO')));
    expect(await judgePii('Orçamento aprovado', () => ({ openai: 'sk-test' }))).toBe(false);
  });

  it('falls back to Anthropic when OpenAI fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(anthropicOk('YES'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await judgePii('texto', () => ({ openai: 'sk-a', anthropic: 'sk-b' }))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails open on network errors and timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    expect(await judgePii('texto', () => ({ openai: 'sk-test' }))).toBe(false);
  });
});
