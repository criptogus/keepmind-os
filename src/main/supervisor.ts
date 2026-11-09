import { withNodePath } from './node-runtime';
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { SupervisorState } from '../shared/types';
export interface SupervisorOptions {
    node: string;
    nodeDir?: string;
    entry: string;
    dataDir: string;
    port: number;
    secrets: Record<string, string>;
    spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
    fetch?: typeof fetch;
    bootTimeoutMs?: number;
    graceMs?: number;
    backoffMs?: number;
    pollMs?: number;
    onState?: (state: SupervisorState) => void;
}
export class Supervisor {
    state: SupervisorState = 'stopped';
    lastError?: string;
    private child?: ChildProcess;
    private quitting = false;
    private restarts = 0;
    private generation = 0;
    private timer?: ReturnType<typeof setTimeout>;
    constructor(private options: SupervisorOptions) {
    }
    private transition(state: SupervisorState, error?: string) {
        this.state = state;
        this.lastError = error;
        this.options.onState?.(state);
    }
    async start() {
        if (this.child || this.state === 'starting')
            return;
        this.quitting = false;
        clearTimeout(this.timer);
        this.restarts = 0;
        await this.boot();
    }
    private async boot() {
        const o = this.options;
        const generation = ++this.generation;
        this.transition('starting');
        let child: ChildProcess;
        try {
            child = (o.spawn ?? nodeSpawn)(o.node, [o.entry, 'run', '-d', o.dataDir], { env: withNodePath({ ...process.env, ...o.secrets, HOST: '127.0.0.1', PORT: String(o.port), PAPERCLIP_HOME: o.dataDir, PAPERCLIP_INSTANCE_ID: 'default', PAPERCLIP_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' }, o.nodeDir), stdio: 'ignore' });
            this.child = child;
        }
        catch {
            this.transition('unavailable', 'Unable to spawn Paperclip');
            return;
        }
        const exited = () => {
            if (this.child !== child)
                return;
            this.child = undefined;
            if (this.quitting)
                return;
            this.generation++;
            this.transition('crashed', 'Paperclip exited');
            if (this.restarts < 3) {
                const delay = (o.backoffMs ?? 1000) * 2 ** this.restarts++;
                this.timer = setTimeout(() => {
                    void this.boot();
                }, delay);
            }
        };
        child.once('exit', exited);
        child.once('error', exited);
        const deadline = Date.now() + (o.bootTimeoutMs ?? 180000);
        while (!this.quitting && this.generation === generation && Date.now() < deadline) {
            try {
                const response = await (o.fetch ?? fetch)(`http://127.0.0.1:${o.port}/api/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
                const data = await response.json();
                if (response.ok && data.status === 'ok' && this.generation === generation) {
                    this.transition('ready');
                    return;
                }
            }
            catch {
            }
            await new Promise(r => setTimeout(r, o.pollMs ?? 250));
        }
        if (!this.quitting && generation === this.generation) {
            this.transition('unavailable', 'Paperclip health check timed out');
            await this.killChild();
        }
    }
    private async killChild() {
        const child = this.child;
        if (!child)
            return;
        this.child = undefined;
        await new Promise<void>(resolve => {
            let timer: ReturnType<typeof setTimeout>;
            const done = () => {
                clearTimeout(timer);
                resolve();
            };
            child.once('exit', done);
            timer = setTimeout(() => {
                child.kill('SIGKILL');
            }, this.options.graceMs ?? 5000);
            if (!child.kill('SIGTERM'))
                done();
        });
    }
    async stop() {
        this.quitting = true;
        this.generation++;
        clearTimeout(this.timer);
        await this.killChild();
        this.transition('stopped');
    }
}
