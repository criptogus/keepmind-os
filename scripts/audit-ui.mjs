// UI audit: launch the real app over CDP, click every sidebar section,
// and report console errors, page errors, and visible error text per tab.
// Usage: npm run build && node scripts/audit-ui.mjs
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
const consoleErrors = [];
const pageErrors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    consoleErrors.push(msg.params.args?.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || '').slice(0, 300));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return res.result?.result?.value;
};

await send('Runtime.enable');
await send('Log.enable');

// Wait for app mount (dashboard or onboarding)
for (let i = 0; i < 60; i++) {
  const ready = await evaluate(`document.body.innerText.length > 50`);
  if (ready) break;
  await delay(300);
}
await delay(1500);

// If onboarding wizard is showing, complete it minimally is not possible (needs inputs);
// instead report what we see and skip nav (wizard covers screen).
const hasWizard = await evaluate(`document.body.innerText.includes('Welcome to KeepMind OS')`);
console.log(`ONBOARDING_WIZARD=${hasWizard}`);
if (hasWizard) {
  // Mark onboarding complete and reload to reach the main shell
  await evaluate(`window.electronAPI.updateSettings({'onboarding.completed': 'true'}).then(() => true).catch(() => false)`);
  await evaluate(`location.reload()`);
  await delay(4000);
}

const sections = ['agents', 'teams', 'governance', 'logs', 'settings', 'advanced', 'dashboard'];
const results = {};

for (const section of sections) {
  const before = consoleErrors.length + pageErrors.length;
  // click the sidebar button whose text matches the section label
  const clicked = await evaluate(`(() => {
    const labels = {agents:'Agents',teams:'Teams',governance:'Governance',logs:'Activity Logs',settings:'Settings',advanced:'Advanced',dashboard:'Dashboard'};
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => x.textContent.trim().startsWith(labels['${section}']));
    if (b) { b.click(); return true; } return false;
  })()`);
  await delay(1800);
  const info = await evaluate(`(() => {
    const text = document.body.innerText;
    const errLines = text.split('\\n').filter(l => /error|fail|missing|undefined|not found|exception|sqlite|database/i.test(l) && l.length < 200).slice(0, 8);
    // content area = everything after the sidebar; grab a snippet for eyeballing
    const snippet = text.replace(/\\s+/g, ' ').slice(0, 500);
    return { errLines, textLen: text.length, snippet };
  })()`);
  results[section] = {
    clicked,
    newErrors: (consoleErrors.length + pageErrors.length) - before,
    visibleErrors: info.errLines,
    snippet: info.snippet,
  };
}

console.log('=== AUDIT RESULTS ===');
for (const [k, v] of Object.entries(results)) {
  console.log(`\\n[${k}] clicked=${v.clicked} newConsoleErrors=${v.newErrors}`);
  console.log(`   text: ${v.snippet}`);
  for (const e of v.visibleErrors) console.log(`   ! ${e}`);
}
console.log('\\n=== CONSOLE/PAGE ERRORS (all) ===');
const allErr = [...new Set([...consoleErrors, ...pageErrors])];
allErr.slice(0, 30).forEach(e => console.log('  *', e));
if (!allErr.length) console.log('  (none)');

child.kill();
process.exit(0);
