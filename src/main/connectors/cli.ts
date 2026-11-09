import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import type { ConnectorDetection } from '../../shared/types';
export async function resolveCli(id: 'codex' | 'claude', env = process.env) {
    const override = env[`ZAOS_${id.toUpperCase()}_BIN`];
    const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
    if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin'), join(homedir(), '.npm-global/bin'));
    for (const path of override ? [override] : dirs.map(d => join(d, id))) {
        if (!isAbsolute(path)) continue;
        try { await access(path, constants.X_OK); return path; } catch { /* next candidate */ }
    }
    return undefined;
}
export async function detectCli(id: 'codex' | 'claude', spawnProcess: typeof spawn = spawn): Promise<ConnectorDetection> {
    const bin = await resolveCli(id);
    if (!bin) return { installed: false, loggedIn: false };
    return new Promise(resolve => {
        const child = spawnProcess(bin, id === 'codex' ? ['login','status'] : ['auth','status'], { shell: false, stdio: ['ignore','pipe','ignore'] });
        let output = '', oversized = false;
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
        child.stdout.on('data', chunk => { if (output.length + chunk.length > 16384) { oversized = true; child.kill('SIGKILL'); } else output += chunk.toString(); });
        child.on('error', () => { clearTimeout(timer); resolve({ installed: true, loggedIn: false }); });
        child.on('close', code => {
            clearTimeout(timer);
            let authMethod: 'subscription' | 'api-key' | 'unknown' = 'unknown';
            if (id === 'claude') { try { const method = JSON.parse(output).authMethod; authMethod = method === 'api_key' ? 'api-key' : ['claude.ai','oauth','subscription'].includes(method) ? 'subscription' : 'unknown'; } catch { code = 1; } }
            resolve({ installed: true, loggedIn: code === 0 && !oversized, authMethod });
        });
    });
}
export async function startCliLogin(id: 'codex' | 'claude') {
    const bin = await resolveCli(id);
    if (!bin) throw new Error('CLI not installed');
    await new Promise<void>((resolve, reject) => {
        const child = spawn(bin, id === 'codex' ? ['login'] : ['auth','login'], { shell: false, stdio: 'ignore' });
        child.once('error', () => reject(new Error('CLI login failed')));
        child.once('spawn', resolve);
    });
}
