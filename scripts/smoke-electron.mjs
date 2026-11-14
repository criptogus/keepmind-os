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
fixtureStorage.setSetting('theme', 'light');
fixtureStorage.close();
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
const reopenAdmin = async () => {
  for (let i = 0; i < 50; i++) { if (await evaluate(`!!document.querySelector('[data-tour="chat-composer"]')`)) break; await delay(100); }
  await evaluate(`document.querySelector('[data-tour="chat-admin"]')?.click()`);
  await delay(300);
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
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent === 'Vender mais')).click()`);
  await evaluate(`(() => { const el = document.querySelector('.km-business-guide textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Vender minhas palestras de inovação para diretores de RH.'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await delay(200);
  const teamSuggestion = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(evidenceDir, 'onboarding-team.png'), Buffer.from(teamSuggestion.result.data, 'base64'));
  if ((await evaluate('window.electronAPI.getTeams()')).length) fail('suggestion created a team before confirmation');
  if (await evaluate(`document.querySelector('.km-business-guide details').open`)) fail('technical settings should start collapsed');
  await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent === 'Criar meu time')).click()`);
  // Chat-first shell is the landing surface; open Admin to reach the workbench.
  for (let i = 0; i < 50; i++) { if (await evaluate(`!!document.querySelector('[data-tour="chat-composer"]')`)) break; await delay(100); }
  if (!(await evaluate(`!!document.querySelector('[data-tour="chat-composer"]')`))) fail('chat shell did not render after onboarding');
  await evaluate(`document.querySelector('[data-tour="chat-admin"]')?.click()`);
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
    localStorage.setItem('km-tour-done', '1'); localStorage.setItem('km-lang', 'en');
    return task;
  })()`);
  if (!task?.id) fail('work task not created through preload');
  await send('Page.reload');
  for (let i = 0; i < 50; i++) { if (await evaluate(`!!document.querySelector('[data-tour="chat-composer"]')`)) break; await delay(100); }
  await evaluate(`document.querySelector('[data-tour="chat-admin"]')?.click()`);
  for (let i = 0; i < 50; i++) {
    const text = await evaluate('document.body?.innerText ?? ""');
    if (text?.includes('Review repository documentation')) break;
    await delay(200);
  }
  const rendered = await evaluate('document.body?.innerText ?? ""');
  if (!rendered?.includes('Ready to work with your team?') || !rendered.includes('Review repository documentation')) fail('workspace did not render persisted task');
  if (!rendered.includes('Need your decision') || !rendered.includes('Delivered')) fail('focus overview not rendered');
  if (!(await evaluate(`!!document.querySelector('.km-sidebar .km-nav-more summary')`))) fail('advanced navigation disclosure missing');
  mkdirSync(evidenceDir, { recursive: true });
  const overview = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(root, 'evidence/focus-desktop.png'), Buffer.from(overview.result.data, 'base64'));
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`[...document.querySelectorAll('[data-command-result]')].some(el => el.textContent.includes('Review repository documentation'))`)) break;
    await delay(100);
  }
  const openedTask = await evaluate(`(() => { const button = [...document.querySelectorAll('[data-command-result]')].find(el => el.textContent.includes('Review repository documentation')); if (!button) return false; button.click(); return true; })()`);
  if (!openedTask) fail('command search could not open persisted task');
  let detail = '';
  for (let i = 0; i < 50; i++) {
    detail = await evaluate('document.body?.innerText ?? ""');
    if (detail.includes('Include file references and reproducible steps.')) break;
    await delay(100);
  }
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
  if (screenshot.result?.data) writeFileSync(path.join(root, 'evidence/workspace-smoke.png'), Buffer.from(screenshot.result.data, 'base64'));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await evaluate(`document.querySelectorAll('.km-task')[0]?.closest('[data-tour="content"]')?.scrollTo(0, 0)`);
  await evaluate(`([...document.querySelectorAll('.km-task')].find(el => el.textContent.includes('Preparar o resumo'))).click()`);
  await delay(400);
  if (!(await evaluate(`!!document.querySelector('.km-document h1') && !!document.querySelector('.km-document table')`))) fail('delivery Markdown not rendered');
  const deliveryShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(root, 'evidence/delivery-desktop.png'), Buffer.from(deliveryShot.result.data, 'base64'));
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
  const approvalEl = await evaluate(`!!document.querySelector('.km-approve-action')`);
  if (!approvalEl) {
    const dbg = await evaluate('document.body?.innerText?.slice(0, 3000) ?? ""');
    fail('approve-action missing; page text: ' + dbg.replace(/\n/g, ' | ').slice(0, 1200));
  }
  const approvalStyle = await evaluate(`(() => {const b=document.querySelector('.km-approve-action');const s=getComputedStyle(b);return {background:s.backgroundColor,text:s.color,label:b.textContent};})()`);
  if (!approvalStyle || approvalStyle.background !== 'rgb(196, 255, 61)' || approvalStyle.text !== 'rgb(17, 17, 17)' || !approvalStyle.label.includes('v1')) fail('lime approval or version label missing');
  await evaluate(`document.querySelector('.km-approve-action').scrollIntoView({block:'center'})`);await delay(200);
  const approvalShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(evidenceDir,'approval-lime.png'),Buffer.from(approvalShot.result.data,'base64'));
  checks.push('lime-approval-version');

  await evaluate(`([...document.querySelectorAll('button')].find(b => ['Visualizar / exportar', 'Preview / export'].includes(b.textContent))).click()`);
  await delay(200);
  if (!(await evaluate(`!!document.querySelector('.km-paper-preview')`))) fail('material preview missing');
  const materialPreview = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(path.join(evidenceDir,'material-preview.png'),Buffer.from(materialPreview.result.data,'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await delay(200);
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
  await reopenAdmin();
  if ((await evaluate(`document.documentElement.getAttribute('data-mantine-color-scheme')`)) !== 'dark') fail('persisted dark theme not applied');
  const darkShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(root, 'evidence/focus-dark.png'), Buffer.from(darkShot.result.data, 'base64'));
  const darkContrast = await evaluate(`(() => { const el=document.querySelector('.km-task-title'); return {text:getComputedStyle(el).color,background:getComputedStyle(el.closest('.km-task')).backgroundColor}; })()`);
  if (ratio(darkContrast.text, darkContrast.background) < 4.5) fail('dark title contrast below 4.5:1');
  checks.push('dark-theme-and-contrast');
  await evaluate(`window.electronAPI.updateSettings({theme:'auto'})`);
  await send('Page.reload'); await delay(500);
  await reopenAdmin();
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{name:'prefers-color-scheme',value:scheme}] }); await delay(200);
    if (await evaluate(`document.documentElement.getAttribute('data-mantine-color-scheme')`) !== scheme) fail('automatic theme did not follow system');
  }
  checks.push('automatic-system-theme');
  await evaluate(`window.electronAPI.updateSettings({theme:'light'})`);
  await send('Page.reload'); await delay(600);
  await reopenAdmin();
  const command = async label => {
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'k',ctrlKey:true,bubbles:true}))`);
    await delay(200);
    const clicked = await evaluate(`(() => {const b=[...document.querySelectorAll('[data-command-result]')].find(b => b.textContent === ${JSON.stringify(label)}); if(!b)return false;b.click();return true;})()`);
    if (!clicked) fail('command unavailable: ' + label);
    await delay(350);
  };
  await command('New request');
  await command('Agents');
  await command('Workspace');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'k',ctrlKey:true,bubbles:true}))`); await delay(200);
  await evaluate(`([...document.querySelectorAll('[data-command-result]')].find(b=>b.textContent.includes('Preparar o resumo'))).click()`); await delay(350);
  if (!(await evaluate(`!!document.querySelector('.km-document h1')`))) fail('stale new-request command hid delivery');
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await command('Create agent');
  if (!(await evaluate(`!!document.querySelector('[role="dialog"]')`))) fail('create-agent command did not open wizard');
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await command('Workspace'); await command('Agents');
  if (await evaluate(`!!document.querySelector('[role="dialog"]')`)) fail('stale create-agent command reopened wizard');
  await command('Approvals');
  if (!(await evaluate(`document.body.innerText.includes('Pending approvals') || document.body.innerText.includes('No pending')`))) fail('approvals page not reachable');
  await command('Skills');
  if (!(await evaluate(`document.body.innerText.includes('Search skills') && document.body.innerText.includes('My skills')`))) fail('searchable installed skills library missing');
  await evaluate(`Array.from(document.querySelectorAll('[role=tab]')).find(el => el.textContent.includes('SuperAgentSkill')).click()`);
  await delay(250);
  if (!(await evaluate(`!!document.querySelector('.km-sak-panel') && document.body.innerText.includes('Conectar minha conta')`))) fail('skills OAuth connection card missing');
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

  await command('Workspace');
  checks.push('quick-actions-consumed-and-approvals-accessible');
  for (const scheme of ['light', 'dark']) {
    await evaluate(`window.electronAPI.updateSettings({theme:${JSON.stringify(scheme)}})`);
    await send('Page.reload'); await delay(500);
    await reopenAdmin();
    for (const page of ['Home', 'Agents', 'Approvals', 'Settings']) {
      await command(page); await delay(250);
      const colors = await evaluate(`({ body:getComputedStyle(document.body).backgroundColor, lime:getComputedStyle(document.documentElement).getPropertyValue('--km-lime').trim() })`);
      if (colors.lime !== '#c4ff3d' || colors.body !== (scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(17, 17, 17)')) fail('inconsistent page color: ' + page + ' ' + scheme + ' ' + JSON.stringify(colors));
      const shot = await send('Page.captureScreenshot', {format:'png'});
      writeFileSync(path.join(evidenceDir, page.toLowerCase() + '-' + scheme + '.png'), Buffer.from(shot.result.data, 'base64'));
    }
  }
  await evaluate(`window.electronAPI.updateSettings({theme:'light'})`); await send('Page.reload'); await delay(500);
  await reopenAdmin();
  await command('Workspace');
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const motion = await evaluate(`(() => {const element=document.createElement('div');element.className='km-chat-message';document.body.appendChild(element);const value=getComputedStyle(element).animationDuration;element.remove();return value;})()`);
  if (parseFloat(motion) > .001) fail('reduced motion ignored');
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  checks.push('cross-area-palette-light-dark', 'reduced-motion');

  await evaluate(`localStorage.setItem('km-lang', 'pt')`); await send('Page.reload'); await delay(500);
  await reopenAdmin();
  const portuguese = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(path.join(evidenceDir, 'workspace-pt.png'), Buffer.from(portuguese.result.data, 'base64'));
  await evaluate(`([...document.querySelectorAll('.km-task')].find(b=>b.textContent.includes('Preparar o resumo'))).click()`); await delay(300);
  const portugueseDelivery = await send('Page.captureScreenshot', {format:'png'});
  writeFileSync(path.join(evidenceDir, 'delivery-pt.png'), Buffer.from(portugueseDelivery.result.data, 'base64'));
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await evaluate(`localStorage.setItem('km-lang', 'en')`); await send('Page.reload'); await delay(500);
  // Chat-first shell has no .km-sidebar; reopen Admin for the narrow-layout check.
  for (let i = 0; i < 50; i++) { if (await evaluate(`!!document.querySelector('[data-tour="chat-composer"]')`)) break; await delay(100); }
  await evaluate(`document.querySelector('[data-tour="chat-admin"]')?.click()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 780, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(500);
  if (await evaluate(`getComputedStyle(document.querySelector('.km-sidebar')).display !== 'none'`)) fail('narrow screen sidebar not collapsed');
  const narrow = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(root, 'evidence/focus-narrow.png'), Buffer.from(narrow.result.data, 'base64'));
  checks.push('narrow-layout');
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
  await reopenAdmin();
  for (let i = 0; i < 80; i++) { if ((await evaluate('document.body?.innerText ?? ""')).includes('Collaborative release review')) break; await delay(100); }
  if (!/shared workspace|espaço compartilhado/i.test(await evaluate('document.body?.innerText ?? ""'))) fail('shared workspace indicator missing');
  const sharedShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(root, 'evidence/shared-workspace.png'), Buffer.from(sharedShot.result.data, 'base64'));
  await evaluate('window.electronAPI.workspaceDisconnect()');
  const localAgain = await evaluate('window.electronAPI.workList()');
  if (!localAgain.tasks.some(t => t.id === task.id) || localAgain.tasks.some(t => t.id === shared.id)) fail('local and remote data were mixed');
  checks.push('shared-workspace-isolation', 'checkpoint-recovery', 'persisted-task-search');
  if (checks.length < 22) fail('incomplete UI checks');
  console.log(`SMOKE PASS: electronAPI OK (version=${version}, agents=${Array.isArray(agents) ? agents.length : '?'}, rootChildren=${rootChildren}, uiRendered=true)`);
} catch (err) {
  failure = err.message; console.error(`SMOKE FAIL: ${err.message}`); process.exitCode = 1;
} finally {
  writeFileSync(path.join(evidenceDir, 'ux-report.json'), JSON.stringify({passed: !failure && checks.length >= 22, checks, failure, fixture: 'synthetic; no live providers', timestamp: new Date().toISOString()}, null, 2));
  ws.close();
  workspaceServer?.kill('SIGTERM');
  child.kill('SIGTERM');
  await delay(500);
  if (child.exitCode === null) child.kill('SIGKILL');
}

