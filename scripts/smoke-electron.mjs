import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
// Smoke test: launch the built Electron app, connect over CDP, and verify
// the renderer loaded and the preload bridge (window.electronAPI) works.
// Usage: npm run build && npm run smoke:electron
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(root, 'node_modules', '.bin', 'electron');

const TIMEOUT_MS = 30_000;

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

// 1. Launch Electron with remote debugging enabled.
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', KEEPMIND_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'keepmind-smoke-')) };
delete env.OPENAI_API_KEY;
delete env.ANTHROPIC_API_KEY;
delete env.ELECTRON_RUN_AS_NODE; // must not run as plain Node
let workspaceServer;
const child = spawn(electronBin, ['.', '--remote-debugging-port=0', '--no-sandbox'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderrBuf = '';
let devtoolsWsUrl = null;
child.stderr.on('data', (d) => {
  const s = d.toString();
  stderrBuf += s;
  const m = s.match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) devtoolsWsUrl = m[1];
});
child.stdout.on('data', (d) => process.stdout.write(d));

const deadline = Date.now() + TIMEOUT_MS;
while (!devtoolsWsUrl && Date.now() < deadline) {
  if (child.exitCode !== null) fail(`electron exited early (code ${child.exitCode})\n${stderrBuf.slice(-2000)}`);
  await delay(200);
}
if (!devtoolsWsUrl) fail(`no DevTools endpoint within ${TIMEOUT_MS}ms\n${stderrBuf.slice(-2000)}`);

// Extract the debugging port from the browser WS URL.
const port = new URL(devtoolsWsUrl).port;

// 2. Find the app page target.
let pageWsUrl = null;
for (let i = 0; i < 50 && !pageWsUrl; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (page) pageWsUrl = page.webSocketDebuggerUrl;
  } catch { /* retry */ }
  if (!pageWsUrl) await delay(200);
}
if (!pageWsUrl) fail('renderer page target not found');

// 3. Drive the page over CDP.
const ws = new WebSocket(pageWsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('CDP websocket failed'));
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expr) => {
  const res = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || 'Renderer evaluation error');
  return res.result?.result?.value;
};

try {
  // Wait for the React app to mount and preload to expose the bridge.
  let apiReady = false;
  for (let i = 0; i < 50 && !apiReady; i++) {
    apiReady = await evaluate('typeof window.electronAPI === "object" && typeof window.electronAPI.getVersion === "function"');
    if (!apiReady) await delay(200);
  }
  if (!apiReady) fail('window.electronAPI bridge not exposed');

  const version = await evaluate('window.electronAPI.getVersion()');
  const agents = await evaluate('window.electronAPI.getAgents()');
  const rootChildren = await evaluate('document.getElementById("root")?.childElementCount ?? 0');
  // Wait for React to actually render the shell (preload exposes the bridge
  // before the renderer finishes mounting).
  let html = '';
  for (let i = 0; i < 50; i++) {
    html = await evaluate('document.body?.innerHTML ?? ""');
    if (/keepmind os/i.test(html)) break;
    await delay(200);
  }

  if (!/keepmind os/i.test(html)) {
    fail(`renderer did not produce expected UI (html length=${html.length})`);
  }

  const task = await evaluate(`(async () => {
    const agent = await window.electronAPI.createAgent({ name: 'Maintainer', model: 'gpt-4o-mini', temperature: 0, maxTokens: 100, systemPrompt: 'Read only', tools: [] });
    const task = await window.electronAPI.workCreate({ goal: 'Review repository documentation', agentId: agent.id, project: 'KeepMind OS', criteria: 'Include file references and reproducible steps.' });
    await window.electronAPI.workAction(task.id, 'comment', 'Ready for a developer review.');
    await window.electronAPI.updateSettings({ onboardingCompleted: true });
    localStorage.setItem('km-tour-done', '1'); localStorage.setItem('km-lang', 'en');
    return task;
  })()`);
  if (!task?.id) fail('work task not created through preload');
  await send('Page.reload');
  for (let i = 0; i < 50; i++) {
    const text = await evaluate('document.body?.innerText ?? ""');
    if (text?.includes('Review repository documentation')) break;
    await delay(200);
  }
  const rendered = await evaluate('document.body?.innerText ?? ""');
  if (!rendered?.includes('Your work, moving forward.') || !rendered.includes('Review repository documentation')) fail('workspace did not render persisted task');
  if (!rendered.includes('Need your decision') || !rendered.includes('Now')) fail('focus overview not rendered');
  if (!(await evaluate(`!!document.querySelector('.km-sidebar .km-nav-more summary')`))) fail('advanced navigation disclosure missing');
  mkdirSync(path.join(root, 'evidence'), { recursive: true });
  const overview = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(root, 'evidence/focus-desktop.png'), Buffer.from(overview.result.data, 'base64'));
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`[...document.querySelectorAll('[data-command-result]')].some(el => el.textContent.includes('Review repository documentation'))`)) break;
    await delay(100);
  }
  const openedTask = await evaluate(`(() => { const button = [...document.querySelectorAll('[data-command-result]')].find(el => el.textContent.includes('Review repository documentation')); if (!button) return false; button.click(); return true; })()`);
  if (!openedTask) fail('command search could not open persisted task');
  await delay(400);
  const detail = await evaluate('document.body?.innerText ?? ""');
  if (!detail.includes('Include file references and reproducible steps.')) fail('task drawer missing criteria');
  const plan = await evaluate(`window.electronAPI.workPreview(${JSON.stringify(task.id)})`);
  if (plan.agentName !== 'Maintainer' || !Array.isArray(plan.tools)) fail('execution plan unavailable');
  await evaluate(`window.electronAPI.workAction(${JSON.stringify(task.id)}, 'run')`);
  let cp;
  for (let i = 0; i < 50; i++) {
    const saved = await evaluate(`window.electronAPI.workList()`);
    if (saved.tasks.find(t => t.id === task.id)?.status === 'blocked') {
      cp = await evaluate(`window.electronAPI.workCheckpoint(${JSON.stringify(task.id)})`);
      break;
    }
    await delay(200);
  }
  if (!cp?.available) fail('failed run did not preserve its checkpoint');
  for (let i = 0; i < 50; i++) {
    if ((await evaluate('document.body?.innerText ?? ""')).includes('Resume checkpoint')) break;
    await delay(200);
  }
  if (!(await evaluate('document.body?.innerText ?? ""')).includes('Resume checkpoint')) fail('checkpoint resume action not visible');

  mkdirSync(path.join(root, 'evidence'), { recursive: true });
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (screenshot.result?.data) writeFileSync(path.join(root, 'evidence/workspace-smoke.png'), Buffer.from(screenshot.result.data, 'base64'));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Emulation.setDeviceMetricsOverride', { width: 780, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(500);
  if (await evaluate(`getComputedStyle(document.querySelector('.km-sidebar')).display !== 'none'`)) fail('narrow screen sidebar not collapsed');
  const narrow = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(root, 'evidence/focus-narrow.png'), Buffer.from(narrow.result.data, 'base64'));
  // Exercise the actual Electron bridge against the shared server, then a second client.
  const serverDir = mkdtempSync(path.join(tmpdir(), 'keepmind-server-smoke-'));
  const serverConfig = path.join(serverDir, 'workspace.json');
  const aliceToken = 'smoke-alice-token-'.repeat(3); const bobToken = 'smoke-bob-token-'.repeat(3);
  writeFileSync(serverConfig, JSON.stringify({ version: 1, workspace: serverDir,
    agents: [{ id: 'shared-agent', name: 'Shared maintainer', model: 'gpt-4o-mini', prompt: 'Read only', monthlyBudgetUsd: 5 }],
    server: { port: 0, principals: [
      { id: 'alice', tokenEnv: 'KM_SMOKE_ALICE', role: 'contributor', projects: ['Shared'], agents: ['shared-agent'] },
      { id: 'bob', tokenEnv: 'KM_SMOKE_BOB', role: 'reviewer', projects: ['Shared'], agents: ['shared-agent'] }
    ] } }));
  workspaceServer = spawn(process.execPath, ['dist/runner/cli.mjs', '--config', serverConfig, '--serve', '--data-dir', path.join(serverDir, 'data')], {
    cwd: root, env: { ...env, KM_SMOKE_ALICE: aliceToken, KM_SMOKE_BOB: bobToken }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverPort;
  workspaceServer.stdout.on('data', d => { const m = d.toString().match(/listening on (\d+)/); if (m) serverPort = Number(m[1]); });
  workspaceServer.stderr.on('data', () => {});
  for (let i = 0; i < 100 && !serverPort; i++) await delay(100);
  if (!serverPort) fail('shared server did not start');
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  await evaluate(`window.electronAPI.workspaceConnect(${JSON.stringify(serverUrl)}, ${JSON.stringify(aliceToken)})`);
  const shared = await evaluate(`window.electronAPI.workCreate({ goal: 'Collaborative release review', project: 'Shared', agentId: 'shared-agent' })`);
  const peer = await fetch(serverUrl + '/v1/call', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bobToken }, body: JSON.stringify({ method: 'work:action', args: [shared.id, 'comment', 'Reviewed by Bob', shared.revision] }) });
  if (!peer.ok) fail('second collaborator could not comment');
  const sharedContext = await evaluate('window.electronAPI.workContext()');
  if (sharedContext.connection.mode !== 'remote' || sharedContext.snapshot.tasks[0].events.at(-1).actorId !== 'bob') fail('remote state did not synchronize');
  await send('Page.reload');
  for (let i = 0; i < 80; i++) { if ((await evaluate('document.body?.innerText ?? ""')).includes('Collaborative release review')) break; await delay(100); }
  if (!/shared workspace/i.test(await evaluate('document.body?.innerText ?? ""'))) fail('shared workspace indicator missing');
  const sharedShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(root, 'evidence/shared-workspace.png'), Buffer.from(sharedShot.result.data, 'base64'));
  await evaluate('window.electronAPI.workspaceDisconnect()');
  const localAgain = await evaluate('window.electronAPI.workList()');
  if (!localAgain.tasks.some(t => t.id === task.id) || localAgain.tasks.some(t => t.id === shared.id)) fail('local and remote data were mixed');
  console.log(`SMOKE PASS: electronAPI OK (version=${version}, agents=${Array.isArray(agents) ? agents.length : '?'}, rootChildren=${rootChildren}, uiRendered=true)`);
} catch (err) {
  fail(`CDP evaluation failed: ${err.message}\n${stderrBuf.slice(-2000)}`);
} finally {
  ws.close();
  workspaceServer?.kill('SIGTERM');
  child.kill('SIGTERM');
  await delay(500);
  if (child.exitCode === null) child.kill('SIGKILL');
}

