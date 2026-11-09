import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startMockProvider } from '../test/fixtures/mock-provider.mjs';

const temp = await mkdtemp(join(tmpdir(), 'zaos-electron-'));
let provider, child, timer;
let failure;
try {
    await rm('evidence/smoke-report.json', { force: true });
    await chmod(resolve('test/fixtures/fake-codex.mjs'), 0o755);
    await chmod(resolve('test/fixtures/fake-claude.mjs'), 0o755);
    provider = await startMockProvider();
    const args = [...(process.env.ZAOS_SMOKE_EXECUTABLE ? [] : ['.']), ...(process.env.ZAOS_SMOKE_LINUX === '1' ? ['--no-sandbox'] : [])];
    child = spawn(process.env.ZAOS_SMOKE_EXECUTABLE || resolve('node_modules/.bin/electron'), args, {
        env: { ...process.env, ZAOS_CODEX_BIN: resolve('test/fixtures/fake-codex.mjs'), ZAOS_CLAUDE_BIN: resolve('test/fixtures/fake-claude.mjs'), ZAOS_SMOKE: '1', ZAOS_SMOKE_PROVIDER_URL: `http://127.0.0.1:${provider.port}/v1`, ZAOS_USER_DATA: temp, ZAOS_SMOKE_OUT: resolve('evidence/screenshots') },
        stdio: 'inherit', detached: process.platform !== 'win32',
    });
    await new Promise((resolveExit, reject) => {
        timer = setTimeout(() => {
            failure = new Error('Electron smoke exceeded the overall six minute timeout');
            // SIGTERM lets Electron execute before-quit and stop its supervisor.
            child.kill('SIGTERM');
            setTimeout(() => {
                try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
            }, 5000).unref();
            reject(failure);
        }, 355000);
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 && !failure ? resolveExit() : reject(failure ?? new Error(`Electron smoke failed (${code ?? signal})`)));
    });
    const report = JSON.parse(await readFile('evidence/smoke-report.json', 'utf8'));
    if (!report.results?.ok || report.results.supervisor !== 'stopped' || report.screenshots.length !== 6 || provider.state.calls !== 1) throw new Error('Smoke report did not prove the complete happy path');
    console.log('Electron smoke passed. Evidence: evidence/smoke-report.json');
} catch (e) {
    failure = e;
    console.error(e instanceof Error ? e.message : e);
    await mkdir('evidence', { recursive: true });
    // Keep the detailed main-process report when it already exists for this run.
    let report;
    try { report = JSON.parse(await readFile('evidence/smoke-report.json', 'utf8')); } catch {}
    await writeFile('evidence/smoke-report.json', JSON.stringify({ steps: report?.steps ?? [], screenshots: report?.screenshots ?? [], results: { ...report?.results, ok: false, error: e instanceof Error ? e.message : String(e) } }, null, 2));
    process.exitCode = 1;
} finally {
    clearTimeout(timer);
    await provider?.close();
    if (!failure) await rm(temp, { recursive: true, force: true });
    else console.error(`Smoke userData retained for diagnosis: ${temp}`);
}
