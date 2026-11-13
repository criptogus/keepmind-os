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
  await evaluate(`document.querySelector('.km-task').click()`);
  await delay(400);
  const detail = await evaluate('document.body?.innerText ?? ""');
  if (!detail.includes('Include file references and reproducible steps.')) fail('task drawer missing criteria');
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
  console.log(`SMOKE PASS: electronAPI OK (version=${version}, agents=${Array.isArray(agents) ? agents.length : '?'}, rootChildren=${rootChildren}, uiRendered=true)`);
} catch (err) {
  fail(`CDP evaluation failed: ${err.message}\n${stderrBuf.slice(-2000)}`);
} finally {
  ws.close();
  child.kill('SIGTERM');
  await delay(500);
  if (child.exitCode === null) child.kill('SIGKILL');
}

