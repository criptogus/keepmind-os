import { spawnSync } from 'node:child_process';
const canSpawn = !spawnSync(process.execPath, ['-e', '']).error;
import { it, expect } from 'vitest';
import { chmod, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { detectCli } from '../../src/main/connectors/cli';
// @ts-expect-error plain ESM runner
import { executeCli, childEnvironment } from '../../src/runner/cli.mjs';
it.skipIf(!canSpawn)('delegates to installed CLI and strips secrets', async () => {
    const bin = resolve('test/fixtures/fake-codex.mjs'); await chmod(bin, 0o755);
    const previous = process.env.ZAOS_CODEX_BIN; process.env.ZAOS_CODEX_BIN = bin;
    try { expect(await detectCli('codex')).toMatchObject({ installed: true, loggedIn: true }); }
    finally { if (previous === undefined) delete process.env.ZAOS_CODEX_BIN; else process.env.ZAOS_CODEX_BIN = previous; }
    expect(childEnvironment({ PATH: process.env.PATH, HOME: '/tmp', PAPERCLIP_API_KEY: 'private', ZAOS_PROVIDER_API_KEY: 'private', OPENAI_API_KEY: 'private' })).toEqual({ PATH: process.env.PATH, HOME: '/tmp' });
    expect(await executeCli('codex', bin, '', 'hello', 30)).toMatchObject({ result: 'Fake Codex result', inputTokens: 10, outputTokens: 20 });
});
it('never accesses vendor credentials', async () => {
    const files = await readdir('src/main/connectors');
    for (const file of files) expect(await readFile(`src/main/connectors/${file}`, 'utf8')).not.toMatch(/auth\.json|\.credentials|setup-token|CLAUDE_CODE_OAUTH_TOKEN/);
});
