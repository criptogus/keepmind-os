import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
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
const evidenceDir = path.resolve(process.argv.includes('--evidence-dir') ? process.argv[process.argv.indexOf('--evidence-dir') + 1] : path.join(root, 'evidence'));
mkdirSync(evidenceDir, { recursive: true });
const checks = [];
let failure = null;

function fail(msg) {
  throw new Error(msg);
}

// 1. Launch Electron with remote debugging enabled.
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', KEEPMIND_DISABLE_CLI_AUTH: '1', KEEPMIND_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'keepmind-smoke-')) };
delete env.OPENAI_API_KEY;
delete env.ANTHROPIC_API_KEY;
delete env.ELECTRON_RUN_AS_NODE; // must not run as plain Node
// Seed a synthetic completed delivery using the production storage/domain code.
// This fixture never invokes a provider and is confined to the temporary data dir.
const fixtureBundle = await build({ stdin: { contents: `export { StorageManager } from './src/main/storage/StorageManager.ts'; export { WorkManager } from './src/main/work/WorkManager.ts';`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false });
const { StorageManager, WorkManager } = await import('data:text/javascript;base64,' + Buffer.from(fixtureBundle.outputFiles[0].text).toString('base64'));
const fixtureStorage = new StorageManager(path.join(env.KEEPMIND_DATA_DIR, 'data'));
const fixtureWork = new WorkManager(fixtureStorage);
const fixtureAgentId = 'ux-fixture-agent';
fixtureStorage.saveAgent({ id: fixtureAgentId, name: 'Assistente', description: 'Synthetic smoke fixture', config: { model: 'gpt-4o-mini', temperature: 0, maxTokens: 100, systemPrompt: 'Read only', tools: [] }, capabilities: [], permissions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
const fixtureTask = fixtureWork.create({ goal: 'Preparar o resumo do projeto', agentId: fixtureAgentId, project: 'Projeto exemplo', criteria: 'Resumo e próximos passos.', reviewRequired: true }, 'system');
await fixtureWork.run(fixtureTask.id, async () => ({ id: 'ux-fixture-execution', agentId: fixtureAgentId, status: 'completed', input: {}, progress: 100, output: { content: '# Resumo do projeto\n\nO pedido foi organizado em **três próximos passos**.\n\n- Confirmar o escopo com a equipe.\n- Revisar a documentação.\n- Preparar a primeira entrega.\n\n## Fontes\n\n[Documentação do projeto](https://github.com/criptogus/keepmind-os)\n\n| Etapa | Estado |\n| --- | --- |\n| Planejamento | Pronto |\n| Revisão | Próxima etapa |' } }));
for (let i = 0; i < 8; i++) fixtureStorage.saveAuditLog({ id: `table-fixture-${i}`, timestamp: new Date().toISOString(), agentId: fixtureAgentId, agentName: 'Assistente', action: 'agent_review', input: { request: 'Resumo de atendimento e próximos passos para a equipe. '.repeat(6) }, output: i === 0 ? null : { summary: 'Entrega preparada para revisão', details: 'Informações complementares. '.repeat(8) }, metadata: {} });
const webhookProbe = createServer();
await new Promise(resolve => webhookProbe.listen(0, '127.0.0.1', resolve));
const webhookPort = webhookProbe.address().port;
await new Promise(resolve => webhookProbe.close(resolve));
fixtureStorage.setSetting('webhook.port', String(webhookPort));
fixtureStorage.setSetting('theme', 'light');
fixtureStorage.setSetting('language', 'pt');
fixtureStorage.close();
let workspaceServer;
let providerServer;
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
    if (/keepmind/i.test(html)) break;
    await delay(200);
  }

  if (!/keepmind/i.test(html)) {
    fail(`renderer did not produce expected UI (html length=${html.length})`);
  }

  // Guide a nontechnical customer from their business problem to a real team and draft.
  const onboarding = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(evidenceDir, 'onboarding-request.png'), Buffer.from(onboarding.result.data, 'base64'));
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent === 'Divulgar meu negócio')).click()`);
  await delay(100);
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent === 'Sugerir meu time')).click()`);
  await delay(200);
  const teamSuggestion = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(evidenceDir, 'onboarding-team.png'), Buffer.from(teamSuggestion.result.data, 'base64'));
  if ((await evaluate('window.electronAPI.getTeams()')).length) fail('suggestion created a team before confirmation');
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent === 'Definir a primeira entrega')).click()`);
  await delay(200);
  const firstDelivery = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(evidenceDir, 'onboarding-connection.png'), Buffer.from(firstDelivery.result.data, 'base64'));
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent === 'Criar time e salvar primeiro pedido')).click()`);
  for (let i = 0; i < 50; i++) { if (await evaluate(`!!document.querySelector('.km-workbench')`)) break; await delay(100); }
  if (!(await evaluate(`!!document.querySelector('.km-workbench')`))) fail('business onboarding without credentials failed');
  if ((await evaluate('window.electronAPI.getAgentExecutions()')).length) fail('onboarding unexpectedly executed work');
  const guidedTeams = await evaluate('window.electronAPI.getTeams()');
  if (guidedTeams.length !== 1 || guidedTeams[0].agentIds.length !== 3) fail('confirmed team was not persisted with specialists');
  const guidedWork = await evaluate('window.electronAPI.workContext()');
  const firstDraft = guidedWork.snapshot.tasks.find(t => t.project === 'Time de marketing');
  if (!firstDraft || firstDraft.status !== 'backlog' || firstDraft.agentId !== guidedTeams[0].agentIds[0]) fail('first request was not saved as a coordinator draft');
  checks.push('business-problem-to-team', 'team-confirmation-before-creation', 'first-delivery-draft-without-execution', 'onboarding-without-credentials');
  const task = await evaluate(`(async () => {
    const agent = await window.electronAPI.createAgent({ name: 'Maintainer', model: 'gpt-4o-mini', temperature: 0, maxTokens: 100, systemPrompt: 'Read only', tools: [] });
    const task = await window.electronAPI.workCreate({ goal: 'Review repository documentation', agentId: agent.id, project: 'KeepMind OS', criteria: 'Include file references and reproducible steps.' });
    await window.electronAPI.workAction(task.id, 'comment', 'Ready for a developer review.');
    await window.electronAPI.updateSettings({ onboardingCompleted: true });
    localStorage.setItem('km-tour-done', '1'); await window.electronAPI.updateSettings({language:'en'}); localStorage.setItem('km-lang', 'en');
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
  if (!rendered?.includes('Conversations') || !rendered.includes('Review repository documentation')) fail('workspace did not render persisted task');
  if (!(await evaluate(`!!document.querySelector('[aria-label="Filter conversations"]')`))) fail('conversation filters missing');
  if (!(await evaluate(`!!document.querySelector('.km-sidebar .km-nav-more summary')`))) fail('advanced navigation disclosure missing');
  mkdirSync(evidenceDir, { recursive: true });
  const overview = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(evidenceDir, 'focus-desktop.png'), Buffer.from(overview.result.data, 'base64'));
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
  if (!cp?.available) { const state = await evaluate('window.electronAPI.workList()'); fail('failed run did not preserve its checkpoint: ' + JSON.stringify(state.tasks.find(t => t.id === task.id))); }
  for (let i = 0; i < 50; i++) {
    if ((await evaluate('document.body?.innerText ?? ""')).includes('Resume checkpoint')) break;
    await delay(200);
  }
  if (!(await evaluate('document.body?.innerText ?? ""')).includes('Resume checkpoint')) fail('checkpoint resume action not visible');

  mkdirSync(evidenceDir, { recursive: true });
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (screenshot.result?.data) writeFileSync(path.join(evidenceDir, 'workspace-smoke.png'), Buffer.from(screenshot.result.data, 'base64'));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await evaluate(`document.querySelectorAll('.km-task')[0]?.closest('[data-tour="content"]')?.scrollTo(0, 0)`);
  await evaluate(`([...document.querySelectorAll('.km-task')].find(el => el.textContent.includes('Preparar o resumo'))).click()`);
  await delay(400);
  if (!(await evaluate(`!!document.querySelector('.km-document h1') && !!document.querySelector('.km-document table')`))) fail('delivery Markdown not rendered');
  const deliveryShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(evidenceDir, 'delivery-desktop.png'), Buffer.from(deliveryShot.result.data, 'base64'));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  checks.push('delivery-markdown');
  const pdf = await evaluate(`window.electronAPI.exportMaterial('pdf','Plano de negócio','Proposta de ação e revisão para o cliente.')`);
  if (String.fromCharCode(...pdf.slice(0,5)) !== '%PDF-') fail('PDF export is not a PDF');
  const ppt = await evaluate(`window.electronAPI.exportMaterial('pptx','Plano de negócio','Proposta de ação e revisão para o cliente.')`);
  if (ppt[0] !== 80 || ppt[1] !== 75 || ppt.length < 1000) fail('PowerPoint export is not a ZIP package');
  checks.push('real-pdf-export','real-pptx-export');
  await evaluate(`([...document.querySelectorAll('.km-task')].find(el => el.textContent.includes('Preparar o resumo'))).click()`);
  await delay(300);
  if (!(await evaluate(`!!document.querySelector('.km-chat-composer') && !!document.querySelector('.km-chat-user')`))) fail('chat conversation missing');
  const approvalStyle = await evaluate(`(() => {const b=document.querySelector('.km-approve-action');if(!b)return null;const s=getComputedStyle(b);return {background:s.backgroundColor,text:s.color,label:b.textContent};})()`);
  if (!approvalStyle || approvalStyle.background !== 'rgb(196, 255, 61)' || approvalStyle.text !== 'rgb(17, 17, 17)' || !approvalStyle.label.includes('v1')) fail('lime approval or version label missing');
  await evaluate(`document.querySelector('.km-approve-action').scrollIntoView({block:'center'})`);await delay(200);
  const approvalShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'approval-lime.png'),Buffer.from(approvalShot.result.data,'base64'));
  checks.push('lime-approval-version');

  await evaluate(`([...document.querySelectorAll('button')].find(b => ['Abrir material', 'Open material'].includes(b.textContent))).click()`);
  await delay(200);
  if (!(await evaluate(`!!document.querySelector('.km-paper-preview')`))) fail('material preview missing');
  const materialPreview = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(path.join(evidenceDir,'material-preview.png'),Buffer.from(materialPreview.result.data,'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await delay(200);
  await evaluate(`document.querySelector('.km-material-panel button').click()`);
  checks.push('chat-and-material-preview');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await delay(200);
  const contrast = await evaluate(`(() => { const el=document.querySelector('.km-task-title'); const style=getComputedStyle(el); const bg=getComputedStyle(el.closest('.km-task')); return {text:style.color,background:bg.backgroundColor}; })()`);
  const luminance = color => { const rgb = color.match(/[\d.]+/g).slice(0,3).map(Number).map(v => {v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;}); return rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722; };
  const ratio = (a,b) => { const x=luminance(a), y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  if (ratio(contrast.text, contrast.background) < 4.5) fail('task title contrast below 4.5:1');
  checks.push('light-title-contrast');
  await evaluate(`window.electronAPI.updateSettings({theme:'dark'})`);
  await send('Page.reload');
  await delay(700);
  if ((await evaluate(`document.documentElement.getAttribute('data-mantine-color-scheme')`)) !== 'dark') fail('persisted dark theme not applied');
  const darkShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(evidenceDir, 'focus-dark.png'), Buffer.from(darkShot.result.data, 'base64'));
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);await delay(300);
  const searchDark=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'search-dark.png'),Buffer.from(searchDark.result.data,'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await delay(200);
  const darkContrast = await evaluate(`(() => { const el=document.querySelector('.km-task-title'); return {text:getComputedStyle(el).color,background:getComputedStyle(el.closest('.km-task')).backgroundColor}; })()`);
  if (ratio(darkContrast.text, darkContrast.background) < 4.5) fail('dark title contrast below 4.5:1');
  checks.push('dark-theme-and-contrast');
  await evaluate(`window.electronAPI.updateSettings({theme:'auto'})`);
  await send('Page.reload'); await delay(500);
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{name:'prefers-color-scheme',value:scheme}] }); await delay(200);
    if (await evaluate(`document.documentElement.getAttribute('data-mantine-color-scheme')`) !== scheme) fail('automatic theme did not follow system');
  }
  checks.push('automatic-system-theme');
  await evaluate(`window.electronAPI.updateSettings({theme:'light'})`);
  await send('Page.reload'); await delay(600);
  const command = async label => {
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'k',ctrlKey:true,bubbles:true}))`);
    await delay(200);
    await evaluate(`(() => {const el=document.querySelector('[role=combobox][aria-controls]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(label)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`); await delay(100);
    const clicked = await evaluate(`(() => {const b=[...document.querySelectorAll('[data-command-result]')].find(b => b.dataset.commandLabel === ${JSON.stringify(label)}); if(!b)return false;b.click();return true;})()`);
    if (!clicked) fail('command unavailable: ' + label);
    await delay(350);
  };
  const webhook = await evaluate(`window.electronAPI.triggersCreate({agentId:${JSON.stringify(fixtureAgentId)},name:'Incoming complaint fixture',kind:'webhook',prompt:'Analyze the incoming complaint',enabled:true,autonomy:'draft'})`);
  const webhookUrl = `http://127.0.0.1:${webhookPort}/webhook/${webhook.webhookToken}`;
  const postEvent = payload => fetch(webhookUrl,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'smoke-event-1'},body:JSON.stringify(payload)});
  if ((await postEvent({complaint:'Delivery was late'})).status !== 202) fail('webhook intake failed');
  if ((await postEvent({complaint:'Delivery was late'})).status !== 202) fail('webhook retry failed');
  const incoming = await evaluate(`window.electronAPI.workList().then(s=>s.tasks.filter(t=>t.source?.eventId==='smoke-event-1'))`);
  if(incoming.length!==1 || incoming[0].source.payload.complaint!=='Delivery was late' || incoming[0].status!=='backlog') fail('webhook payload lost or duplicate task created');
  if ((await postEvent({complaint:'Different payload'})).status !== 503) fail('changed event key accepted');
  if ((await fetch(`http://127.0.0.1:${webhookPort}/webhook/%E0`,{method:'POST'})).status !== 400) fail('malformed webhook path not rejected');
  const longText = 'Customer report. '.repeat(300);
  const postText = body => fetch(webhookUrl,{method:'POST',headers:{'Idempotency-Key':'smoke-text-1'},body});
  if ((await postText(longText+'original')).status !== 202 || (await postText(longText+'changed')).status !== 503) fail('text payload truncated or conflict missed');
  const textTask = await evaluate(`window.electronAPI.workList().then(s=>s.tasks.find(t=>t.source?.eventId==='smoke-text-1'))`);
  if(textTask.source.payload!==longText+'original') fail('text webhook source not preserved');
  if((await fetch(webhookUrl,{method:'POST',body:'a'.repeat(256*1024+1)})).status!==413) fail('oversize webhook accepted');
  await evaluate(`window.electronAPI.triggersDelete(${JSON.stringify(webhook.id)})`);
  checks.push('webhook-payload-durable-draft-and-deduplication');
  await command('History');
  if (!(await evaluate(`document.querySelectorAll('.km-data-table tbody tr').length >= 8`))) fail('history table unavailable');
  await evaluate(`document.querySelector('.km-table-details summary').click()`);
  if (!(await evaluate(`document.querySelector('.km-table-details[open] pre').textContent.length > 60`))) fail('audit details remain truncated');
  const tableShot = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(path.join(evidenceDir, 'history-table-light.png'), Buffer.from(tableShot.result.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
  await delay(200);
  if (!(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 2`))) fail('history table overflows narrow viewport');
  const tableNarrow = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(path.join(evidenceDir, 'history-table-narrow.png'), Buffer.from(tableNarrow.result.data,'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
  checks.push('audit-table-details-and-narrow-layout');
  await evaluate(`window.electronAPI.updateSettings({theme:'dark'})`); await send('Page.reload'); await delay(500);
  await command('History');
  const tableDark = await send('Page.captureScreenshot',{format:'png'});
  writeFileSync(path.join(evidenceDir,'history-table-dark.png'),Buffer.from(tableDark.result.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false}); await delay(200);
  const tableDarkNarrow = await send('Page.captureScreenshot',{format:'png'});
  writeFileSync(path.join(evidenceDir,'history-table-dark-narrow.png'),Buffer.from(tableDarkNarrow.result.data,'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
  await evaluate(`window.electronAPI.updateSettings({theme:'light'})`); await send('Page.reload'); await delay(500);
  await command('Conversations');
  const searchText=async value=>{await evaluate(`(() => {const el=document.querySelector('.km-search-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(120);};
  const searchKey=async key=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});};
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);await delay(350);
  const searchDefault=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'search-after.png'),Buffer.from(searchDefault.result.data,'base64'));
  await searchText('resumo projeto');
  if(await evaluate(`document.querySelectorAll('[data-command-result]').length`)!==1)fail('multi-word search failed');
  await searchKey('ArrowDown');
  if(!(await evaluate(`document.activeElement===document.querySelector('.km-search-input input') && !!document.activeElement.getAttribute('aria-activedescendant')`)))fail('search keyboard lost input focus');
  await searchKey('Enter');await delay(350);
  if(!(await evaluate(`!!document.querySelector('.km-document h1')`)))fail('search Enter did not open selected conversation');
  checks.push('search-keyboard-and-multi-word');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);await delay(300);
  await searchText('zzzz-no-result');
  if(!(await evaluate(`!!document.querySelector('.km-search-empty')`)))fail('search empty state missing');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});await delay(200);
  if(await evaluate(`document.querySelector('.km-search-modal').scrollWidth>document.querySelector('.km-search-modal').clientWidth+2`))fail('search overflow on narrow window');
  const searchNarrow=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'search-empty-narrow.png'),Buffer.from(searchNarrow.result.data,'base64'));
  await send('Emulation.clearDeviceMetricsOverride');await delay(150);
  const clearPoint=await evaluate(`(() => {const r=document.querySelector('.km-search-input button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...clearPoint,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...clearPoint,button:'left',clickCount:1});await delay(100);
  if(await evaluate(`document.querySelector('.km-search-input input').value`)!=='')fail('pointer clear button failed');
  await searchKey('Escape');await delay(250);
  checks.push('search-empty-and-narrow');
  const searchContext=await evaluate('window.electronAPI.workContext()');
  let searchPhase='loading';
  providerServer=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const request=JSON.parse(body);res.setHeader('Content-Type','application/json');
    if(request.method==='work:context'){res.end(JSON.stringify({value:{...searchContext,connection:{mode:'remote',actor:'search-fixture',role:'contributor'}}}));return;}
    if(request.method==='work:list'){
      if(searchPhase==='loading')await delay(900);
      if(searchPhase==='error'){res.writeHead(503);res.end(JSON.stringify({error:'Controlled search failure'}));return;}
      res.end(JSON.stringify({value:searchContext.snapshot}));return;
    }
    res.end(JSON.stringify({value:{available:false,steps:[]}}));
  });
  await new Promise(resolve=>providerServer.listen(0,'127.0.0.1',resolve));
  await evaluate(`window.electronAPI.workspaceConnect('http://127.0.0.1:${providerServer.address().port}','search-fixture-token-for-isolated-testing')`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);await delay(250);
  if(!(await evaluate(`document.querySelector('.km-search-feedback').innerText.includes('Loading')`)))fail('search loading state missing');
  await searchKey('ArrowDown');await searchKey('ArrowDown');await searchKey('ArrowDown');
  const selectedBeforeLoad=await evaluate(`document.querySelector('.km-search-result[aria-selected=true]').dataset.commandLabel`);
  await delay(900);
  if(await evaluate(`document.querySelector('.km-search-result[aria-selected=true]').dataset.commandLabel`)!==selectedBeforeLoad)fail('async search replaced keyboard selection');
  await searchKey('Escape');await delay(250);
  searchPhase='error';
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);await delay(250);
  if(!(await evaluate(`document.querySelector('.km-search-feedback').innerText.includes('unavailable')`)))fail('search error state missing');
  searchPhase='ok';await evaluate(`document.querySelector('.km-search-feedback button').click()`);await delay(250);
  if(await evaluate(`document.querySelector('.km-search-feedback').innerText.includes('unavailable')`))fail('search retry failed');
  await searchKey('Escape');await delay(250);
  await evaluate('window.electronAPI.workspaceDisconnect()');
  await new Promise(resolve=>providerServer.close(resolve));providerServer=null;
  await delay(3200);
  checks.push('search-loading-error-and-retry');
  await command('New request');
  await command('Agents');
  await command('Conversations');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'k',ctrlKey:true,bubbles:true}))`); await delay(200);
  await evaluate(`([...document.querySelectorAll('[data-command-result]')].find(b=>b.textContent.includes('Preparar o resumo'))).click()`); await delay(350);
  if (!(await evaluate(`!!document.querySelector('.km-document h1')`))) fail('stale new-request command hid delivery');
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await command('Create agent');
  if (!(await evaluate(`!!document.querySelector('[role="dialog"]')`))) fail('create-agent command did not open wizard');
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await command('Conversations'); await command('Agents');
  if (await evaluate(`!!document.querySelector('[role="dialog"]')`)) fail('stale create-agent command reopened wizard');
  await command('Approvals');
  if (!(await evaluate(`document.body.innerText.includes('Pending approvals') || document.body.innerText.includes('No pending')`))) fail('approvals page not reachable');
  await command('Skills');
  if (!(await evaluate(`!!document.querySelector('.km-sak-panel') && document.body.innerText.includes('Connect my account')`))) fail('skills OAuth connection card missing');
  const sak = await evaluate(`window.electronAPI.sakStatus()`);
  if (sak.connected || sak.pending) fail('isolated smoke unexpectedly inherited a skill account');
  const sakShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'skills-connection.png'),Buffer.from(sakShot.result.data,'base64'));
  checks.push('skills-oauth-disconnected');
  const compatibleProfile = { id: 'smoke-compatible', kind: 'custom', name: 'Conexão de teste', baseUrl: 'http://127.0.0.1:9/v1', model: 'fixture', inputUsdPerMillion: 1, outputUsdPerMillion: 2, maxOutputTokens: 100, maxRunUsd: 1 };
  await evaluate(`window.electronAPI.saveCompatibleProvider(${JSON.stringify(compatibleProfile)})`);
  const compatibleModels = await evaluate('window.electronAPI.listModels()');
  if (!compatibleModels.models.some(model => model.id === 'compatible/smoke-compatible')) fail('compatible provider missing from model picker');
  if (!(await evaluate(`window.electronAPI.isModelConfigured('compatible/smoke-compatible')`))) fail('compatible account readiness incorrectly requires native OAuth');
  await command('Advanced');
  await evaluate(`document.querySelector('[data-compatible-settings]').click()`); await delay(300);
  if (!(await evaluate('document.body.innerText')).includes('Conexão de teste')) fail('compatible connection is not visible');
  await evaluate(`document.querySelector('[data-compatible-settings]').scrollIntoView({block:'start'})`);
  const compatibleShot = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(path.join(evidenceDir, 'compatible-providers.png'), Buffer.from(compatibleShot.result.data, 'base64'));
  await evaluate(`document.querySelector('[data-company-settings]').click()`); await delay(250);
  if (!(await evaluate('document.body.innerText')).includes('Company ID')) fail('company binding form unavailable');
  if ((await evaluate('window.electronAPI.listCompanyBrains()')).length !== 0) fail('unexpected automatic company binding');
  await evaluate(`window.electronAPI.removeCompatibleProvider('smoke-compatible')`);
  if ((await evaluate('window.electronAPI.listCompatibleProviders()')).length) fail('compatible disconnect did not persist');
  checks.push('compatible-provider-bridge-and-picker', 'company-memory-explicit-binding');

  await command('Conversations');
  checks.push('quick-actions-consumed-and-approvals-accessible');
  for (const scheme of ['light', 'dark']) {
    await evaluate(`window.electronAPI.updateSettings({theme:${JSON.stringify(scheme)}})`);
    await send('Page.reload'); await delay(500);
    for (const page of ['Conversations', 'Agents', 'Approvals', 'Settings']) {
      await command(page); await delay(250);
      const colors = await evaluate(`({ body:getComputedStyle(document.body).backgroundColor, lime:getComputedStyle(document.documentElement).getPropertyValue('--km-lime').trim() })`);
      if (colors.lime !== '#c4ff3d' || colors.body !== (scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(17, 17, 17)')) fail('inconsistent page color: ' + page + ' ' + scheme + ' ' + JSON.stringify(colors));
      const shot = await send('Page.captureScreenshot', {format:'png'});
      writeFileSync(path.join(evidenceDir, page.toLowerCase() + '-' + scheme + '.png'), Buffer.from(shot.result.data, 'base64'));
    }
  }
  await evaluate(`window.electronAPI.updateSettings({theme:'light'})`); await send('Page.reload'); await delay(500);
  await command('Conversations');
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const motion = await evaluate(`(() => {const element=document.createElement('div');element.className='km-chat-message';document.body.appendChild(element);const value=getComputedStyle(element).animationDuration;element.remove();return value;})()`);
  if (parseFloat(motion) > .001) fail('reduced motion ignored');
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  checks.push('cross-area-palette-light-dark', 'reduced-motion');

  await evaluate(`window.electronAPI.updateSettings({language:'pt'})`); await send('Page.reload'); await delay(500);
  const portuguese = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(path.join(evidenceDir, 'workspace-pt.png'), Buffer.from(portuguese.result.data, 'base64'));
  await evaluate(`([...document.querySelectorAll('.km-task')].find(b=>b.textContent.includes('Preparar o resumo'))).click()`); await delay(300);
  const portugueseDelivery = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(path.join(evidenceDir, 'delivery-pt.png'), Buffer.from(portugueseDelivery.result.data, 'base64'));
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await evaluate(`window.electronAPI.updateSettings({language:'en'})`); await send('Page.reload'); await delay(500);
  await send('Emulation.setDeviceMetricsOverride', { width: 780, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(500);
  if (await evaluate(`getComputedStyle(document.querySelector('.km-sidebar')).display !== 'none'`)) fail('narrow screen sidebar not collapsed');
  const narrow = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(evidenceDir, 'focus-narrow.png'), Buffer.from(narrow.result.data, 'base64'));
  checks.push('narrow-layout');

  // Language is changed through the visible picker and survives a renderer restart.
  await send('Emulation.clearDeviceMetricsOverride');
  const pickLanguage = async label => {
    await evaluate(`document.querySelector('.km-language-picker input').click()`); await delay(100);
    if (!(await evaluate(`(() => {const option=[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()===${JSON.stringify(label)}); if(!option)return false;option.click();return true;})()`))) fail('language option missing: '+label);
    await delay(300);
  };
  await pickLanguage('Português (Brasil)');
  if ((await evaluate('window.electronAPI.getSettings()')).language !== 'pt') fail('language not persisted');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);await delay(300);
  if(!(await evaluate(`document.querySelector('.km-search-modal').innerText.includes('Buscar no KeepMind')`)))fail('Portuguese search interface missing');
  const searchPt=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'search-pt.png'),Buffer.from(searchPt.result.data,'base64'));
  await searchKey('Escape');await delay(200);
  await command('Habilidades');
  if (!(await evaluate(`document.querySelector('.km-sak-panel').innerText`)).includes('Conectar minha conta')) fail('Portuguese skill interface missing');
  await pickLanguage('English');
  if (!(await evaluate(`document.querySelector('.km-sak-panel').innerText`)).includes('Connect my account')) fail('skill interface did not follow live language change');
  await send('Page.reload'); await delay(600);
  if (await evaluate('document.documentElement.lang') !== 'en') fail('language changed after restart');
  await command('Skills');
  const skillCopy=await evaluate(`document.querySelector('.km-sak-panel').innerText`);
  if (/Conectar minha conta|CATÁLOGO DE HABILIDADES/.test(skillCopy)) fail('mixed skill interface language');
  checks.push('language-picker-persistence','skills-follow-interface-language');

  // Drafts must survive navigation and remain associated with their own conversation.
  const fillText = async (selector,value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('input missing');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await command('New request');
  await fillText('textarea[aria-label="Your request"]','Draft retained while connecting');
  await command('Settings'); await command('Conversations');
  if (await evaluate(`document.querySelector('textarea[aria-label="Your request"]').value`) !== 'Draft retained while connecting') fail('navigation lost new request draft');
  await send('Emulation.setDeviceMetricsOverride', { width: 780, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`([...document.querySelectorAll('.km-conversation-stage button')].find(b=>b.textContent==='Connect my AI')).click()`); await delay(200);
  if (!(await evaluate(`document.querySelector('.km-context-connection').checkVisibility()`))) fail('narrow contextual connection hidden');
  checks.push('narrow-contextual-connection');
  if (!(await evaluate(`document.querySelector('.km-context-connection')?.innerText`)).includes('Sign in with')) fail('contextual connection missing');
  await evaluate(`([...document.querySelectorAll('.km-context-connection button')].find(b=>b.textContent==='Back to conversation')).click()`); await delay(100);
  if (await evaluate(`document.querySelector('textarea[aria-label="Your request"]').value`) !== 'Draft retained while connecting') fail('connection lost draft');
  await send('Emulation.clearDeviceMetricsOverride');
  await evaluate(`([...document.querySelectorAll('.km-conversation-stage button')].find(b=>b.textContent==='Build a team for a new challenge')).click()`); await delay(100);
  await fillText('.km-business-guide textarea','Keep my team setup context');
  await evaluate(`document.querySelector('.km-task').click()`); await delay(100);
  await command('New request');
  await evaluate(`([...document.querySelectorAll('.km-conversation-stage button')].find(b=>b.textContent==='Build a team for a new challenge')).click()`); await delay(100);
  if (await evaluate(`document.querySelector('.km-business-guide textarea').value`) !== 'Keep my team setup context') fail('team setup draft lost');
  checks.push('team-setup-draft-preservation');
  await evaluate(`([...document.querySelectorAll('.km-task')].find(b=>b.textContent.includes('Preparar o resumo'))).click()`); await delay(200);
  await fillText('.km-chat-composer textarea','Keep this unsent adjustment');
  await command('Settings'); await command('Conversations');
  if (await evaluate(`document.querySelector('.km-chat-composer textarea').value`) !== 'Keep this unsent adjustment') fail('navigation lost adjustment');
  if (await evaluate(`!!document.querySelector('.mantine-Drawer-root')`)) fail('conversation still uses a drawer');
  await evaluate(`([...document.querySelectorAll('.km-task')].find(b=>b.textContent.includes('Review repository'))).click()`); await delay(100);
  if (await evaluate(`document.querySelector('.km-chat-composer textarea').value`) !== '') fail('draft leaked between conversations');
  await evaluate(`([...document.querySelectorAll('.km-task')].find(b=>b.textContent.includes('Preparar o resumo'))).click()`); await delay(100);
  if (await evaluate(`document.querySelector('.km-chat-composer textarea').value`) !== 'Keep this unsent adjustment') fail('switching conversations lost draft');
  checks.push('persistent-conversation-and-drafts','contextual-connection-preserves-request');

  // Complete real IPC/execution/HTTP paths against a deterministic local provider.
  const providerRequests=[]; let deliveryCalls=0;
  providerServer=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    if(req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
    const request=JSON.parse(body); providerRequests.push(request);
    const number=providerRequests.length;
    const dialogue = request.messages.some(m => String(m.content).includes('conversationMode'));
    let content;
    if (dialogue) {
      if (request.tools?.length) fail('conversation exposed execution tools');
      const context = JSON.parse(request.messages.findLast(m => m.role === 'user').content);
      const reply = context.conversationMode === 'prepare'
        ? context.conversation.some(t => t.text === 'A one-page proposal')
          ? {intent:'ready',reply:'I will prepare a one-page proposal with scope and next steps.'}
          : {intent:'clarify',reply:'What format would be most useful?',choices:['A one-page proposal','A detailed document']}
        : context.task === 'Use a shorter timeline' ? {intent:'revise',reply:'I will shorten the timeline in a new version.'}
        : context.task === 'Not quite right' ? {intent:'ambiguous',reply:'Would you like an explanation or a change to the proposal?'}
        : {intent:'answer',reply:'The proposal includes scope and next steps. No delivery has been changed.'};
      content=context.task==='Malformed reply fixture'?'not valid JSON':JSON.stringify(reply);
    } else { deliveryCalls++; content=deliveryCalls===1?'# Client proposal\n\nInitial scope and next steps.':'# Client proposal\n\nRevised scope with a shorter timeline.'; }
    await delay(400);
    if (!request.stream) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({id:'fixture-'+number,object:'chat.completion',model:'fixture',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50}})); return; }
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write(`data: ${JSON.stringify({id:'fixture-'+number,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{content},finish_reason:null}]})}\n\n`);
    res.write(`data: ${JSON.stringify({id:'fixture-'+number,object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:30}})}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>providerServer.listen(0,'127.0.0.1',resolve));
  const localProfile={id:'conversation-fixture',kind:'custom',name:'Local flow fixture',baseUrl:`http://127.0.0.1:${providerServer.address().port}/v1`,model:'fixture',inputUsdPerMillion:1,outputUsdPerMillion:1,maxOutputTokens:200,maxRunUsd:1};

  const flowAgent=await evaluate(`window.electronAPI.createAgent({name:'Proposal assistant',model:'compatible/conversation-fixture',temperature:0,maxTokens:200,systemPrompt:'Prepare the requested proposal.',tools:[]})`);
  await command('New request'); await delay(3200);
  await evaluate(`document.querySelector('[aria-label="Team or assistant"]').click()`);await delay(100);
  await evaluate(`([...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()==='Proposal assistant')).click()`);await delay(200);
  if (!(await evaluate(`document.querySelector('.km-command').innerText`)).includes('Connect my AI')) fail('unconfigured model should need connection');
  await command('Settings');
  await evaluate(`window.electronAPI.saveCompatibleProvider(${JSON.stringify(localProfile)})`);
  await command('Conversations'); await delay(200);
  if (!(await evaluate(`document.querySelector('.km-command').innerText`)).includes('Send request')) fail('returning from Settings did not refresh provider readiness');
  checks.push('settings-provider-readiness');
  await fillText('textarea[aria-label="Your request"]','Prepare a client proposal for a small business');
  await evaluate(`([...document.querySelectorAll('.km-command button')].find(b=>b.textContent==='Send request')).click()`);
  let flow;
  const waitFlow = async predicate => {
    for(let i=0;i<100;i++){flow=(await evaluate('window.electronAPI.workList()')).tasks.find(t=>t.agentId===flowAgent.id);if(flow && predicate(flow))return;await delay(150);}
    fail('conversation did not reach expected state: '+JSON.stringify(flow));
  };
  const clickDecision = async text => {
    for(let i=0;i<50;i++){if(await evaluate(`!![...document.querySelectorAll('.km-decision-card button')].find(b=>b.textContent===${JSON.stringify(text)})`))break;await delay(100);}
    await evaluate(`([...document.querySelectorAll('.km-decision-card button')].find(b=>b.textContent===${JSON.stringify(text)})).click()`);
  };
  const sendMessage = async text => {
    await delay(1100);
    await fillText('.km-chat-composer textarea',text); await delay(100);
    await evaluate(`([...document.querySelectorAll('.km-chat-composer button')].find(b=>b.textContent==='Send message')).click()`);
  };
  await waitFlow(t=>t.conversation?.decision?.kind==='clarify');
  if(deliveryCalls)fail('preparation started work before confirmation');
  await delay(1100);
  const clarificationShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'conversation-clarification.png'),Buffer.from(clarificationShot.result.data,'base64'));
  await clickDecision('Write my answer');
  if(!(await evaluate(`document.activeElement===document.querySelector('.km-chat-composer textarea')`)))fail('clarification did not focus free-text answer');
  await send('Emulation.setDeviceMetricsOverride',{width:780,height:900,deviceScaleFactor:1,mobile:false});await delay(200);
  if(await evaluate(`document.querySelector('.km-conversation-stage').scrollWidth>document.querySelector('.km-conversation-stage').clientWidth+2`))fail('decision card overflow on narrow window');
  const narrowDecision=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'conversation-decision-narrow.png'),Buffer.from(narrowDecision.result.data,'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
  checks.push('decision-free-text-focus-and-narrow-layout');
  await clickDecision('A one-page proposal');
  await waitFlow(t=>t.conversation?.decision?.kind==='start');
  if(deliveryCalls)fail('clarification started work before confirmation');
  await delay(300);
  const briefShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'conversation-brief.png'),Buffer.from(briefShot.result.data,'base64'));
  await clickDecision('Start delivery');
  await waitFlow(t=>t.status==='review');
  for(let i=0;i<50;i++){if(await evaluate(`!!document.querySelector('.km-approve-action')`))break;await delay(100);}
  await sendMessage('Why did you include next steps?');
  await waitFlow(t=>!t.conversation?.pending && t.conversation?.turns.at(-1)?.text.includes('No delivery has been changed'));
  if(flow.deliveries.length!==1||deliveryCalls!==1)fail('question changed the delivery');
  await sendMessage('Malformed reply fixture');
  await waitFlow(t=>!!t.conversation?.error && !t.conversation.pending);
  if(flow.deliveries.length!==1 || deliveryCalls!==1)fail('invalid reply changed the delivery');
  checks.push('conversation-error-preserves-delivery');
  const callsBeforeThanks=providerRequests.length;
  await sendMessage('Thanks');
  await waitFlow(t=>t.conversation?.turns.at(-1)?.text.includes('You are welcome'));
  if(providerRequests.length!==callsBeforeThanks)fail('acknowledgement called the model');
  await sendMessage('Not quite right');
  await waitFlow(t=>t.conversation?.decision?.kind==='intent');
  await clickDecision('Keep as a comment');
  await waitFlow(t=>!t.conversation?.decision && t.conversation?.turns.at(-1)?.text.includes('Comment saved'));
  if(flow.deliveries.length!==1||flow.acceptedAt)fail('comment changed/approved delivery');
  checks.push('clarification-before-execution','explicit-start-decision','question-preserves-delivery','acknowledgement-without-model-call','ambiguous-message-decision');
  await sendMessage('Use a shorter timeline');
  await waitFlow(t=>t.deliveries?.length===2&&t.status==='review');
  if(deliveryCalls!==2||!JSON.stringify(providerRequests.at(-1)).includes('Use a shorter timeline'))fail('revision duplicate call or missing adjustment');
  for(let i=0;i<50;i++){if((await evaluate(`document.querySelector('.km-approve-action')?.textContent`))?.includes('v2'))break;await delay(100);}
  if (!(await evaluate(`document.querySelector('.km-approve-action')?.textContent`))?.includes('v2')) fail('v2 approval label missing');
  if (!(await evaluate(`document.querySelector('.km-chat-history').innerText`)).includes('Previous delivery'))fail('v1 history missing');
  await delay(350);
  const revisionShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'conversation-v2.png'),Buffer.from(revisionShot.result.data,'base64'));
  await evaluate(`document.querySelector('.km-approve-action').click()`);await delay(300);
  const accepted=(await evaluate('window.electronAPI.workList()')).tasks.find(t=>t.id===flow.id);
  if(accepted.status!=='done'||!accepted.acceptedAt)fail('delivery approval did not persist');
  checks.push('request-to-delivery-over-provider-http','single-send-revision-v2','approve-version-with-history');
  await new Promise(resolve=>providerServer.close(resolve));providerServer=null;

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
  if (!(await evaluate(`document.querySelector('.km-conversation-list').innerText.includes('Collaborative release review')`))) fail('shared conversation missing');
  const sharedShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(evidenceDir, 'shared-workspace.png'), Buffer.from(sharedShot.result.data, 'base64'));
  await evaluate('window.electronAPI.workspaceDisconnect()');
  const localAgain = await evaluate('window.electronAPI.workList()');
  if (!localAgain.tasks.some(t => t.id === task.id) || localAgain.tasks.some(t => t.id === shared.id)) fail('local and remote data were mixed');
  checks.push('shared-workspace-isolation', 'checkpoint-recovery', 'persisted-task-search');
  if (checks.length < 44) fail('incomplete UI checks');
  console.log(`SMOKE PASS: electronAPI OK (version=${version}, agents=${Array.isArray(agents) ? agents.length : '?'}, rootChildren=${rootChildren}, uiRendered=true)`);
} catch (err) {
  failure = err.message; console.error(`SMOKE FAIL: ${err.message}`); process.exitCode = 1;
} finally {
  writeFileSync(path.join(evidenceDir, 'ux-report.json'), JSON.stringify({passed: !failure && checks.length >= 44, checks, failure, fixture: 'synthetic; no live providers', timestamp: new Date().toISOString()}, null, 2));
  ws.close();
  workspaceServer?.kill('SIGTERM');
  providerServer?.close();
  child.kill('SIGTERM');
  await delay(500);
  if (child.exitCode === null) child.kill('SIGKILL');
}

