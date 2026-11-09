import { spawnSync } from 'node:child_process';
const canSpawn = !spawnSync(process.execPath, ['-e', '']).error;
import { it, expect } from 'vitest';
import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listConnectors } from '../../src/main/connectors/registry';
// @ts-expect-error plain ESM runner
import { executeCli } from '../../src/runner/cli.mjs';
it.skipIf(!canSpawn)('hides subscription by default and parses the native CLI response', async () => {
    expect(listConnectors()).toHaveLength(6);
    if (process.env.ZAOS_ENABLE_CLAUDE_SUBSCRIPTION !== '1') expect(listConnectors().find(c => c.id === 'claude')?.modes).toEqual(['api-key']);
    const bin = resolve('test/fixtures/fake-claude.mjs'); await chmod(bin, 0o755);
    expect(await executeCli('claude', bin, '', 'hello', 30)).toMatchObject({ result: 'Fake Claude result' });
    await expect(executeCli('claude', bin, '', 'FAKE_ERROR', 30)).rejects.toThrow('CLI execution failed');
});
