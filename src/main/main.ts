import { app, BrowserWindow, ipcMain, safeStorage, session, nativeTheme } from 'electron';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectEncryptor } from './encryption';
import { Supervisor } from './supervisor';
import { runtimePaths } from './paths';
import { resolveNode } from './node-runtime';
import { pickPorts } from './ports';
import { createConfig, writeConfig } from './paperclip-config';
import { instanceSecrets, readEncrypted, writeEncrypted } from './instance-secrets';
import { authenticateOperator } from './operator-auth';
import { PaperclipClient } from './paperclip-client';
import { Orchestrator } from './orchestrator';
import type { WorkspaceState } from './orchestrator';
import { registerIpc } from './ipc';
import type { Encryptor, ZaosAPI, TaskResult } from '../shared/types';

if (process.env.ZAOS_USER_DATA) app.setPath('userData', resolve(process.env.ZAOS_USER_DATA));
const smoke = process.env.ZAOS_SMOKE === '1';
const paths = runtimePaths(app.getAppPath(), app.isPackaged);
let window: BrowserWindow;
let board: BrowserWindow | undefined;
let supervisor: Supervisor | undefined;
let orchestrator: Orchestrator | undefined;
let workspace: WorkspaceState = { managedAgentIds: [], telemetry: false };
let ready = false, booting = false, quitting = false, stopped = false;
let error: string | undefined;
let origin = '';
let encryptor: Encryptor;
let lastResult: TaskResult | undefined;
const steps: string[] = [], screenshots: string[] = [];
const userData = app.getPath('userData');
const home = join(userData, 'paperclip');
const statePath = join(userData, 'zaos/workspace.json');
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'";

async function logTail() {
    try {
        const dir = join(home, 'instances/default/logs');
        const files = (await readdir(dir)).filter(f => f.endsWith('.log')).sort();
        return files.length ? (await readFile(join(dir, files.at(-1)!), 'utf8')).slice(-6000) : '';
    } catch { return ''; }
}
let bootPromise: Promise<void> | undefined;
async function boot() {
    if (booting || quitting) return;
    booting = true; ready = false; error = undefined; orchestrator = undefined;
    try {
        board?.close();
        lastResult = undefined;
        await supervisor?.stop();
        encryptor = selectEncryptor(safeStorage, process.platform, smoke, message => { console.warn(message); steps.push(message); });
        workspace = await readEncrypted<WorkspaceState>(statePath, encryptor) ?? { managedAgentIds: [], telemetry: false };
        if (quitting) return;
        const secrets = await instanceSecrets(userData, encryptor);
        const node = await resolveNode();
        const ports = await pickPorts();
        origin = `http://127.0.0.1:${ports.server}`;
        // Existing credentials mean signup must stay disabled, including during startup.
        const credentials = await readEncrypted(join(userData, 'zaos/operator.json'), encryptor);
        const config = createConfig(home, ports.server, ports.postgres, !!credentials);
        await writeConfig(home, config);
        supervisor = new Supervisor({ node: node.binary, entry: paths.entry, dataDir: home, port: ports.server, secrets,
            onState: state => { if (state !== 'ready') ready = false; } });
        if (quitting) return;
        await supervisor.start();
        if (quitting) return;
        if (supervisor.state !== 'ready') throw new Error(supervisor.lastError ?? 'Paperclip is unavailable');
        const client = new PaperclipClient(origin);
        await authenticateOperator(client, userData, encryptor, async () => {
            config.auth.disableSignUp = true;
            await writeConfig(home, config);
        });
        // Restart ensures disableSignUp takes effect before exposing operational UI.
        await supervisor.stop();
        if (quitting) return;
        await supervisor.start();
        if (quitting) return;
        if (supervisor.state !== 'ready') throw new Error(supervisor.lastError ?? 'Paperclip restart failed');
        await authenticateOperator(client, userData, encryptor, async () => {});
        orchestrator = new Orchestrator(client, workspace, { node: node.binary, runnerPath: paths.runner, cwd: paths.cwd },
            s => writeEncrypted(statePath, s, encryptor), () => ({ state: ready ? supervisor!.state : 'starting' }));
        if (workspace.companyId) await orchestrator.startupAudit();
        ready = true;
    } catch (e) { error = e instanceof Error ? e.message : 'Startup failed'; }
    finally { booting = false; }
}
function core() {
    if (!ready || !orchestrator || supervisor?.state !== 'ready') throw new Error('Workspace is unavailable; restart the local service first');
    return orchestrator;
}
function secureWindow(target: BrowserWindow, allowed: (url: string) => boolean) {
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    target.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault(); });
    target.webContents.on('will-frame-navigate', (event) => { if (!allowed(event.url)) event.preventDefault(); });
    target.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
    target.webContents.on('will-attach-webview', event => event.preventDefault());
    target.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    target.webContents.session.setPermissionCheckHandler(() => false);
}
async function openBoard() {
    core();
    if (board && !board.isDestroyed()) { board.focus(); return; }
    const partition = session.fromPartition('persist:zaos-board');
    partition.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    partition.setPermissionCheckHandler(() => false);
    const credentials = await readEncrypted<{ email: string; password: string }>(join(userData, 'zaos/operator.json'), encryptor);
    if (!credentials) throw new Error('Operator credentials are unavailable');
    const response = await partition.fetch(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: credentials.email, password: credentials.password }), redirect: 'error' });
    if (!response.ok) throw new Error(`Board sign-in failed (${response.status})`);
    board = new BrowserWindow({ width: 1280, height: 900, title: 'Paperclip board', webPreferences: { partition: 'persist:zaos-board', contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    const boardOrigin = origin;
    secureWindow(board, url => { try { return new URL(url).origin === boardOrigin; } catch { return false; } });
    const css = await readFile(paths.identity, 'utf8');
    const contents = board.webContents;
    let identityKey: string | undefined;
    let identityApplication = Promise.resolve();
    const applyIdentity = () => {
        identityApplication = identityApplication.then(async () => {
            if (contents.isDestroyed()) return;
            if (identityKey) await contents.removeInsertedCSS(identityKey);
            identityKey = await contents.insertCSS(css);
        });
        return identityApplication;
    };
    contents.on('dom-ready', () => { void applyIdentity().catch(console.error); });
    contents.on('did-finish-load', () => { void applyIdentity().catch(console.error); });
    contents.on('did-navigate-in-page', () => { void applyIdentity().catch(console.error); });
    board.on('closed', () => { board = undefined; });
    await board.loadURL(`${origin}/`);
    await applyIdentity();
    if (process.env.ZAOS_BOARD_A11Y === '1') {
        const axeSource = await readFile('/tmp/zaos-a11y/node_modules/axe-core/axe.min.js', 'utf8');
        await mkdir(resolve('evidence/a11y'), { recursive: true });
        const hadDark = await contents.executeJavaScript("document.documentElement.classList.contains('dark')");
        const collectProbe = (dark: boolean) => contents.executeJavaScript(`(${(async (dark: boolean) => {
            document.documentElement.classList.toggle('dark', dark);
            await new Promise(resolve => setTimeout(resolve, 300));
            const elements = Array.from(document.querySelectorAll('[class*="text-muted-foreground"], [class*="text-muted"]')).slice(0, 80).map(element => {
                const style = getComputedStyle(element);
                let parent = element.parentElement;
                let parentBackground = 'transparent';
                while (parent) {
                    const background = getComputedStyle(parent).backgroundColor;
                    if (background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
                        parentBackground = background;
                        break;
                    }
                    parent = parent.parentElement;
                }
                return { tag: element.tagName, className: element.getAttribute('class') ?? '', textContent: (element.textContent ?? '').slice(0, 60), color: style.color, opacity: style.opacity, fill: style.fill, parentBackground };
            });
            return { elements, background: getComputedStyle(document.body).backgroundColor };
        }).toString()})(${JSON.stringify(dark)})`);
        const runAxe = () => contents.executeJavaScript(`(async () => {
            if (!window.axe) { (0, eval)(${JSON.stringify(axeSource)}); }
            const { violations, passes, incomplete } = await window.axe.run(document, {
                runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] }
            });
            return {
                violations,
                passes: passes.length,
                incomplete: incomplete.map(({ id, impact, description, help, helpUrl, nodes }) => ({
                    id, impact, description, help, helpUrl, nodes: nodes.length
                })),
                colorContrastViolations: violations.filter(({ id }) => id === 'color-contrast').length,
                url: location.href
            };
        })()`);
        try {
            for (let attempt = 0; attempt < 3; attempt++) {
                contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
                contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            }
            await new Promise(resolve => setTimeout(resolve, 200));
            await contents.executeJavaScript(`(async () => {
                const deadline = Date.now() + 5000;
                while (Date.now() < deadline) {
                    const labels = document.querySelectorAll('[class*="text-muted-foreground"], [class*="text-muted"]');
                    if (Array.from(labels).some(element =>
                        /^(Work|Org|Agents)$/.test((element.textContent ?? '').trim()) ||
                        element.matches('span.text-muted-foreground.tabular-nums')
                    )) return;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                throw new Error('Board dashboard muted labels did not appear within 5 seconds');
            })()`);
            const light = await collectProbe(false);
            await writeFile(resolve('evidence/a11y/board-axe-light.png'), (await contents.capturePage()).toPNG());
            const lightAxe = await runAxe();
            await writeFile(resolve('evidence/a11y/board-axe-light.json'), JSON.stringify(lightAxe, null, 2));
            const dark = await collectProbe(true);
            const darkSupported = light.background !== dark.background || light.elements.some((element: { parentBackground: string }, index: number) => {
                const other = dark.elements[index];
                // Text overrides alone do not establish a usable dark surface.
                return other && element.parentBackground !== other.parentBackground;
            });
            await writeFile(resolve('evidence/a11y/board-axe-dark.png'), (await contents.capturePage()).toPNG());
            const darkAxe = { ...await runAxe(), darkSupported };
            await writeFile(resolve('evidence/a11y/board-axe-dark.json'), JSON.stringify(darkAxe, null, 2));
            const summarize = (result: typeof lightAxe) => ({
                violations: result.violations.length,
                colorContrastViolations: result.colorContrastViolations,
                passes: result.passes,
            });
            await writeFile(resolve('evidence/a11y/board-axe-summary.json'), JSON.stringify({
                light: summarize(lightAxe),
                dark: { ...summarize(darkAxe), darkSupported },
            }, null, 2));
            const probe = { light: { elements: light.elements }, dark: { darkSupported, elements: dark.elements } };
            console.log('ZAOS_BOARD_A11Y_PROBE ' + JSON.stringify(probe));
            await writeFile(resolve('evidence/a11y/board-dom-probe.json'), JSON.stringify(probe.light, null, 2));
            await writeFile(resolve('evidence/a11y/board-dom-probe-dark.json'), JSON.stringify(probe.dark, null, 2));
        } finally {
            await contents.executeJavaScript(`document.documentElement.classList.toggle('dark', ${JSON.stringify(hadDark)})`);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
}
const api: ZaosAPI = {
    testConnector: payload => core().testConnector(payload),
    listConnectors: async () => core().listConnectors(), detectConnector: id => core().detectConnector(id), startConnectorLogin: id => core().startConnectorLogin(id), listConnectorModels: id => core().listConnectorModels(id), configureConnector: config => core().configureConnector(config),
    getStatus: async () => ({ state: error ? 'unavailable' : ready ? supervisor!.state : booting ? 'starting' : supervisor?.state === 'ready' ? 'unavailable' : supervisor?.state ?? 'starting', lastError: error ?? supervisor?.lastError,
        paidExecution: ready && !!orchestrator?.getStatus().paidExecution, configured: !!workspace.agentId && !!workspace.cap, setupProgress: workspace.agentId ? 3 : workspace.secretId ? 2 : workspace.companyId ? 1 : 0, cap: workspace.cap,
        lastResult, logTail: error || supervisor?.state === 'crashed' ? await logTail() : '' }),
    retryStartup: async () => { bootPromise = boot(); await bootPromise; }, openBoard,
    createCompany: name => core().createCompany(name), createAgentFromTemplate: (id, p) => core().createAgentFromTemplate(id, p),
    setProviderKey: key => core().setProviderKey(key), setSpendCap: cap => core().setSpendCap(cap), setPaidExecution: (on, consent) => core().setPaidExecution(on, consent),
    runTask: async (title, description) => { lastResult = await core().runTask(title, description); return lastResult; },
    acceptReview: async id => { const accepted = await core().acceptReview(id); if (lastResult?.issueId === id) lastResult = { ...lastResult, status: 'accepted' }; return accepted; },
    listRuns: () => core().listRuns(), getTelemetry: async () => core().getTelemetry(), setTelemetry: on => core().setTelemetry(on),
};
async function capture(name: string, target = window) {
    const out = resolve(process.env.ZAOS_SMOKE_OUT ?? 'evidence/screenshots');
    await mkdir(out, { recursive: true });
    await new Promise(r => setTimeout(r, 800));
    const filename = join(out, `${name}.png`);
    await writeFile(filename, (await target.webContents.capturePage()).toPNG());
    screenshots.push(filename); steps.push(`Captured ${name}`);
}
async function modeToggle() {
    await window.webContents.executeJavaScript("document.querySelector('[data-mode-toggle]').click()");
}
async function runSmoke(bootPromise: Promise<void>) {
    let failure: unknown;
    let connectorChecks: unknown;
    try {
        await capture('startup');
        await bootPromise;
        core();
        const connectors = await api.listConnectors();
        const codexDetection = await api.detectConnector('codex');
        connectorChecks = { connectors, codex: codexDetection };
        if (connectors.length !== 6 || !codexDetection.loggedIn) throw new Error('Connector smoke detection failed');
        steps.push('Six connectors listed; fake Codex CLI detected and logged in');
        steps.push('Supervisor ready; operator authenticated; startup audit complete');
        window.setSize(1280, 820);
        await capture('setup-light'); await modeToggle(); await capture('setup-dark'); await modeToggle();
        await api.createCompany('Northstar Fictional Studio');
        await api.setProviderKey('mock-smoke-key');
        await api.createAgentFromTemplate('researcher', { baseUrl: process.env.ZAOS_SMOKE_PROVIDER_URL!, model: 'mock', inputCentsPerMTok: 100, outputCentsPerMTok: 200, maxOutputTokens: 100, maxRunCents: 1 });
        await api.setSpendCap(100); await api.setTelemetry(false); await api.setPaidExecution(true, true); steps.push('Company, Researcher, mock provider, $1 cap and consent configured');
        window.setSize(1280, 820);
        const result = await api.runTask('Research a fictional market', 'Draft a brief for a fictional local studio.');
        if (result.status !== 'succeeded' || !result.issueId || !result.result) throw new Error(`Smoke run ${result.status}: ${result.result}`);
        steps.push('Task succeeded with priced result');
        await capture('workspace-light'); await modeToggle(); await capture('workspace-dark');
        await api.acceptReview(result.issueId); steps.push('Human review accepted');
        await openBoard(); await capture('paperclip-board', board!);
        await api.setPaidExecution(false, false);
    } catch (e) { failure = e; process.exitCode = 1; }
    await supervisor?.stop(); stopped = true;
    steps.push('Supervisor stopped');
    await mkdir(resolve('evidence'), { recursive: true });
    await writeFile(resolve('evidence/smoke-report.json'), JSON.stringify({ steps, connectorChecks, results: { ok: !failure, error: failure instanceof Error ? failure.message : failure ? String(failure) : undefined, task: lastResult, supervisor: supervisor?.state }, screenshots }, null, 2));
    app.exit(failure ? 1 : 0);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
    app.on('before-quit', event => {
        if (stopped) return;
        event.preventDefault();
        if (quitting) return;
        quitting = true; ready = false;
        void (async () => { await supervisor?.stop(); await bootPromise; await supervisor?.stop(); stopped = true; app.quit(); })();
    });
    app.on('window-all-closed', () => app.quit());
    void app.whenReady().then(async () => {
        if (smoke) { nativeTheme.themeSource = 'light'; const timeout = setTimeout(() => { error = 'Smoke timed out'; app.quit(); }, 350000); timeout.unref(); }
        const ownedUrl = pathToFileURL(paths.renderer).href;
        window = new BrowserWindow({ width: 1280, height: 820, minWidth: 960, minHeight: 640, title: 'Zero Agency OS', webPreferences: { preload: paths.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
        secureWindow(window, url => url === ownedUrl);
        window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
            callback({ responseHeaders: { ...details.responseHeaders, ...(details.url.startsWith('file://') ? { 'Content-Security-Policy': [csp] } : {}) } });
        });
        registerIpc(ipcMain, api, { url: ownedUrl, contents: window.webContents, mainFrame: () => window.webContents.mainFrame });
        await window.loadURL(ownedUrl);
        // Let Startup paint before beginning the potentially expensive first boot.
        bootPromise = boot();
        if (smoke) await runSmoke(bootPromise);
    }).catch(e => { console.error(e); app.quit(); });
}
