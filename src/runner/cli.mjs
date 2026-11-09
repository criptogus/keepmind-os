import { withNodePath } from './node-path.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
export function childEnvironment(env) {
    return Object.fromEntries(['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR','SHELL','USERPROFILE','APPDATA','LOCALAPPDATA','SystemRoot','XDG_CONFIG_HOME'].filter(k => typeof env[k] === 'string').map(k => [k, env[k]]));
}
export async function executeCli(id, bin, model, prompt, timeoutSec, env = process.env, spawnProcess = spawn) {
    if (!['codex','claude'].includes(id) || !isAbsolute(bin) || !Number.isInteger(timeoutSec) || timeoutSec < 30 || timeoutSec > 1800) throw new Error('Invalid CLI configuration');
    const args = id === 'codex' ? ['exec','--sandbox','read-only','--skip-git-repo-check','--ephemeral','--json', ...(model ? ['-m',model] : []), '-'] : ['-p','--output-format','json','--no-session-persistence','--max-turns','1', ...(model ? ['--model',model] : [])];
    const cwd = await mkdtemp(join(tmpdir(), 'zaos-cli-'));
    try {
        const out = await new Promise((resolve, reject) => {
            const child = spawnProcess(bin, args, { cwd, env: withNodePath(childEnvironment(env), env.ZAOS_NODE_RUNTIME_DIR), shell: false, stdio: ['pipe','pipe','ignore'] });
            let output = '', bytes = 0, failed = false, killTimer;
            const stop = () => { if (failed) return; failed = true; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 1000); };
            const timer = setTimeout(stop, timeoutSec * 1000);
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 1024 * 1024) stop(); else output += chunk.toString(); });
            child.stdin.on('error', () => {});
            child.on('error', () => { clearTimeout(timer); clearTimeout(killTimer); reject(new Error('CLI execution failed')); });
            child.on('close', code => { clearTimeout(timer); clearTimeout(killTimer); code === 0 && !failed ? resolve(output) : reject(new Error('CLI execution failed')); });
            child.stdin.end(prompt);
        });
        let result, usage;
        if (id === 'claude') { const data = JSON.parse(out); if (data.is_error) throw new Error(); result = data.result; usage = data.usage; }
        else for (const line of out.split('\n').filter(Boolean)) { const data = JSON.parse(line); if (data.type === 'item.completed' && data.item?.type === 'agent_message') result = data.item.text; if (data.type === 'turn.completed') usage = data.usage; }
        if (typeof result !== 'string') throw new Error();
        const token = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
        return { result, inputTokens: token(usage?.input_tokens), outputTokens: token(usage?.output_tokens) };
    } catch { throw new Error('CLI execution failed'); }
    finally { await rm(cwd, { recursive: true, force: true }); }
}
