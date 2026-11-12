import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-data' },
}));

import { StorageManager } from '../src/main/storage/StorageManager.js';
import { SecondBrainManager } from '../src/main/integrations/SecondBrainManager.js';

describe('SecondBrainManager.remember governance', () => {
  let dir: string;
  let storage: StorageManager;
  let brain: SecondBrainManager;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-sb-'));
    storage = new StorageManager(dir);
    brain = new SecondBrainManager(storage);
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { appended: true } }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    brain.setConfig({ enabled: true, url: 'http://corp.test', token: 'tok', access: 'write', blockPii: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects writes in read-only mode', async () => {
    brain.setConfig({ access: 'read' });
    await expect(brain.remember('nota corporativa')).rejects.toThrow('read-only');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects regex-detected PII without calling the server', async () => {
    await expect(brain.remember('cpf 123.456.789-09 do funcionário')).rejects.toThrow('personal data');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects semantic PII flagged by the judge', async () => {
    brain.setPiiJudge(async () => true);
    await expect(brain.remember('João da Silva mora na Rua das Flores 123, apart 42')).rejects.toThrow('identifiable person');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows clean corporate content and appends via sb_append', async () => {
    brain.setPiiJudge(async () => false);
    const result = await brain.remember('Decisão: orçamento da obra aprovado pelo comitê');
    expect(result).toEqual({ appended: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://corp.test/api/mcp/call');
    const body = JSON.parse(String(init.body));
    expect(body.tool).toBe('sb_append');
    expect(body.arguments.path).toBe('inbox/keepmind-os-captures.md');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('skips the judge when blockPii is off', async () => {
    brain.setConfig({ blockPii: false });
    const judge = vi.fn().mockResolvedValue(true);
    brain.setPiiJudge(judge);
    await brain.remember('João da Silva mora na Rua das Flores 123');
    expect(judge).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
