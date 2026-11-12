// Captures renderer console errors/exceptions over CDP.
// Usage: node scripts/capture-console.mjs
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(root, 'node_modules', '.bin', 'electron');

const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronBin, ['.', '--remote-debugging-port=0', '--no-sandbox'], {
  cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
});

let devtoolsWsUrl = null;
let stderrBuf = '';
child.stderr.on('data', (d) => {
  const s = d.toString();
  stderrBuf += s;
  const m = s.match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) devtoolsWsUrl = m[1];
});
child.stdout.on('data', (d) => process.stdout.write(d));

const deadline = Date.now() + 30_000;
while (!devtoolsWsUrl && Date.now() < deadline) await delay(200);
if (!devtoolsWsUrl) { console.error('no devtools'); process.exit(1); }

const port = new URL(devtoolsWsUrl).port;
let pageWsUrl = null;
for (let i = 0; i < 50 && !pageWsUrl; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (page) pageWsUrl = page.webSocketDebuggerUrl;
  } catch {}
  if (!pageWsUrl) await delay(200);
}
if (!pageWsUrl) { console.error('no page'); process.exit(1); }

const ws = new WebSocket(pageWsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    console.log('EXCEPTION:', d.text, d.exception?.description?.slice(0, 600) ?? '', d.url ? `@${d.url}:${d.lineNumber}` : '');
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const p = msg.params;
    if (p.type === 'error' || p.type === 'warning') {
      const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500);
      console.log(`CONSOLE.${p.type.toUpperCase()}:`, text);
    }
  }
  if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    if (e.level === 'error' || e.level === 'warning') {
      console.log(`LOG.${e.level.toUpperCase()}:`, (e.text || '').slice(0, 500), e.url ? `@${e.url}` : '');
    }
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Log.enable');

// Let the app mount, then click through the main sections to surface errors.
await delay(5000);
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

const sections = ['agents', 'teams', 'skills', 'governance', 'logs', 'settings', 'advanced'];
for (const s of sections) {
  await evaluate(`document.querySelector('[data-tour="nav-${s}"]')?.click()`);
  await delay(1500);
}
// Governance rules tab
await evaluate(`[...document.querySelectorAll('button')].find(b => /rules|regras/i.test(b.textContent))?.click()`);
await delay(1200);
// Open first agent card (editor with avatar picker)
await evaluate(`document.querySelector('[data-tour="nav-agents"]')?.click()`);
await delay(800);
await evaluate(`document.querySelector('main [class*="mantine-Card-root"], main .mantine-Card-root')?.dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
await delay(1500);
// Open executions tab inside editor if present
await evaluate(`[...document.querySelectorAll('[role="tab"], button')].find(b => /exec|execu/i.test(b.textContent))?.click()`);
await delay(1500);
await delay(3000);
console.log('DONE capturing. stderr tail:', stderrBuf.slice(-500));
ws.close();
child.kill('SIGTERM');
await delay(500);
if (child.exitCode === null) child.kill('SIGKILL');
process.exit(0);
