// Launches the INSTALLED KeepMind OS.app with CDP and evaluates an expression.
// Usage: node scripts/check-update.mjs [expr]
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const APP = '/Applications/KeepMind OS.app/Contents/MacOS/KeepMind OS';
const expr = process.argv[2] || 'window.electronAPI.updateCheck()';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(APP, ['--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let wsUrl = null;
child.stderr.on('data', (d) => {
  const m = d.toString().match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) wsUrl = m[1];
});

const deadline = Date.now() + 30_000;
while (!wsUrl && Date.now() < deadline) await delay(200);
if (!wsUrl) { console.error('no devtools endpoint'); child.kill(); process.exit(1); }

const port = new URL(wsUrl).port;
let pageWs = null;
for (let i = 0; i < 60 && !pageWs; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find((t) => t.type === 'page');
    if (page) pageWs = page.webSocketDebuggerUrl;
  } catch {}
  if (!pageWs) await delay(250);
}
if (!pageWs) { console.error('no page target'); child.kill(); process.exit(1); }

const ws = new WebSocket(pageWs);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('eval timeout')), 300_000);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === 1) {
      clearTimeout(timer);
      resolve(msg.result?.result?.value ?? msg.result);
    }
  };
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: expr, awaitPromise: true, returnByValue: true },
  }));
});

console.log(JSON.stringify(result, null, 2));
ws.close();
// Give quitAndInstall time to swap the bundle before we touch the process.
await delay(8000);
child.kill('SIGTERM');
await delay(1000);
if (child.exitCode === null) child.kill('SIGKILL');
