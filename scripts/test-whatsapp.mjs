// Smoke test: launch the real app over CDP, start WhatsApp, collect events.
// Usage: npm run build && node scripts/test-whatsapp.mjs
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
child.stderr.on('data', (d) => {
  const m = d.toString().match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) devtoolsWsUrl = m[1];
});

const deadline = Date.now() + 30_000;
while (!devtoolsWsUrl && Date.now() < deadline) await delay(200);
if (!devtoolsWsUrl) { console.error('no devtools'); child.kill(); process.exit(1); }

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
if (!pageWsUrl) { console.error('no page'); child.kill(); process.exit(1); }

const ws = new WebSocket(pageWsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

await send('Runtime.enable');
await delay(3000);

// Install event collector + start WhatsApp
await evaluate(`(() => {
  window.__waEvents = [];
  window.__waUnsub = window.electronAPI.onWhatsAppEvent((e) => {
    window.__waEvents.push({ type: e.type, status: e.status, hasQr: !!e.qrDataUrl, error: e.error });
  });
  return 'ok';
})()`);

const startResult = await evaluate(`window.electronAPI.whatsappStart().then(s => JSON.stringify(s)).catch(e => 'ERR:' + e.message)`);
console.log('whatsappStart →', startResult);

// Wait for QR or status events (Baileys handshake can take a few seconds)
for (let i = 0; i < 30; i++) {
  await delay(1000);
  const events = await evaluate('JSON.stringify(window.__waEvents)');
  const parsed = JSON.parse(events || '[]');
  if (parsed.some((e) => e.type === 'qr' || e.status === 'error')) break;
}

const events = await evaluate('JSON.stringify(window.__waEvents)');
const status = await evaluate('window.electronAPI.whatsappGetStatus().then(s => JSON.stringify(s))');
console.log('events:', events);
console.log('status:', status);

await evaluate('window.__waUnsub && window.__waUnsub()');
child.kill();
process.exit(0);
