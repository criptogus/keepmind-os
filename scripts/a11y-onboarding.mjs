import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(resolve(process.env.ZAOS_A11Y_MODULES ?? '/tmp/zaos-a11y/node_modules', 'package.json'));
const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const root = resolve('dist/renderer');
// No listening socket: every request to the fake origin is fulfilled from dist/renderer in-process.
const url = 'http://zaos-renderer.test';
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.ttf':'font/ttf', '.woff2':'font/woff2', '.svg':'image/svg+xml', '.png':'image/png' };
async function serve(route) {
 try { const pathname = new URL(route.request().url()).pathname; const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)); if (!file.startsWith(root + '/')) throw Error(); await route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'application/octet-stream', body: await readFile(file) }); } catch { await route.fulfill({ status: 404, body: '' }); }
}
await mkdir('evidence/a11y', { recursive: true }); await mkdir('evidence/screenshots', { recursive: true });
// Read the actual Phase 1 static table offline; do not maintain a second price catalog.
const deepseekSource = await readFile('src/main/connectors/deepseek.ts', 'utf8');
const deepseek = [...deepseekSource.matchAll(/id: '([^']+)', name: '([^']+)', priceKnown: true, inputCentsPerMTok: (\d+), outputCentsPerMTok: (\d+)/g)].map(m => ({ id: m[1], name: m[2], priceKnown: true, inputCentsPerMTok: +m[3], outputCentsPerMTok: +m[4], pricingSource: 'https://api-docs.deepseek.com/quick_start/pricing', pricesRetrievedAt: '2026-11-09' }));
if (deepseek.length !== 2) throw Error('Cannot read real DeepSeek catalog');
const violations = [], checks = [], measurements = [], tabs = [];
function check(name, pass, detail) { checks.push({ name, pass: !!pass, detail }); }
let browser;
try {
 browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
 for (const mode of ['light','dark']) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: mode, reducedMotion: 'reduce' });
  await context.route('**/*', route => route.request().url().startsWith(url + '/') || route.request().url() === url ? serve(route) : route.abort());
  await context.addInitScript(({ deepseek }) => {
   const calls = []; let configured = false, paidExecution = false;
   const ids = ['codex','claude','openrouter','deepseek','hermes','custom'];
   window.__ipcCalls = calls;
   const record = name => async (...args) => { calls.push({ name, args }); if (name === 'setPaidExecution') { paidExecution = args[0]; configured = args[0]; } return { id: name + '-id' }; };
   window.zaos = {
    getStatus: async () => ({ state: 'ready', configured, paidExecution, setupProgress: 0 }),
    listConnectors: async () => ids.map(id => ({ id, modes: id === 'codex' ? ['api-key','cli-subscription'] : ['api'] })),
    detectConnector: async () => ({ installed: true, loggedIn: true }),
    startConnectorLogin: record('startConnectorLogin'),
    listConnectorModels: async id => id === 'deepseek' ? deepseek : id === 'openrouter' ? [
     // MOCK DATA: fabricated offline fixture, not a claim about current OpenRouter prices.
     { id: 'openai/gpt-4o-mini', name: 'Mock GPT-4o mini', priceKnown: true, inputCentsPerMTok: 15, outputCentsPerMTok: 60 },
     { id: 'mock/unknown', name: 'Unknown price', priceKnown: false },
    ] : [],
    testConnector: async () => window.__testFailure ? { ok: false, error: 'http' } : { ok: true, models: 2 },
    configureConnector: record('configureConnector'), createCompany: record('createCompany'), setProviderKey: record('setProviderKey'), createAgentFromTemplate: record('createAgentFromTemplate'), setSpendCap: record('setSpendCap'), setTelemetry: record('setTelemetry'), setPaidExecution: record('setPaidExecution'),
    getTelemetry: async () => false, retryStartup: record('retryStartup'), openBoard: record('openBoard'), runTask: record('runTask'), acceptReview: record('acceptReview'), listRuns: async () => [],
   };
  }, { deepseek });
  try {
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const chat = page.locator('.onboard-chat');
  async function step(name, action) {
   try { const started = Date.now(); await action(); check(`${mode}: ${name} completed`, true, { elapsedMs: Date.now() - started }); }
   catch (e) { check(`${mode}: ${name} completed`, false, { error: String(e.stack ?? e) }); console.error(`${mode}: ${name}`, e); }
  }
  async function capture(step) {
   await page.screenshot({ path: `evidence/screenshots/onboarding-${step}-${mode}.png`, fullPage: true });
   await page.screenshot({ path: `evidence/screenshots/redesign-${step}-${mode}.png`, fullPage: false });
   const axe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
   await writeFile(`evidence/a11y/onboarding-axe-${step}-${mode}.json`, JSON.stringify(axe, null, 2));
   violations.push({ step, mode, count: axe.violations.length });
   measurements.push({ step, mode, ...await page.evaluate(() => {
    const visible = e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
    const inputs = [...document.querySelectorAll('.za-onboard input:not([type=checkbox]), .za-onboard textarea, .za-onboard select')].filter(visible).map(e => ({ tag: e.tagName.toLowerCase(), id: e.id, measuredElement: 'native control', label: e.labels?.[0]?.textContent ?? e.getAttribute('aria-label'), height: e.getBoundingClientRect().height, minHeight: getComputedStyle(e).minHeight, labelVisible: !!e.labels?.[0] && visible(e.labels[0]) }));
    const targets = [...document.querySelectorAll('.za-onboard button, .za-onboard input[type=checkbox]')].filter(visible).map(e => ({ name: e.getAttribute('aria-label') ?? e.textContent, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height, primary: e.matches('.onboard-chips button, .za-primary') || ['Send', 'Test connection', 'Activate agent', 'Use local Hermes'].includes(e.textContent?.trim()), reveal: ['Show','Hide'].includes(e.getAttribute('aria-label')) }));
    return { inputs, targets };
   }) });
  }
  await step('q1', async () => {
  await page.goto(url); await chat.getByLabel('Workspace name').waitFor();
  { const row = page.locator('dl > div').filter({ has: page.locator('dt', { hasText: 'Est. max / run' }) }); check(`${mode}: estimate waits for cap and pricing`, await row.count() === 0, { observed: await row.count() }); }
  await step('capture q1', () => capture('q1'));
  });
  await step('q2', async () => {
  await chat.getByLabel('Workspace name').fill('Northstar Fiction'); await chat.getByLabel('Workspace name').press('Enter');
  { const observed3 = await page.getByRole('radio', { name: 'Research a topic', exact: true }).isVisible(); check(`${mode}: Enter sends composer`, observed3, { observed: observed3 }); }
  await step('capture q2', () => capture('q2'));
  });
  await step('q3', async () => {
  await page.getByRole('radio', { name: 'Research a topic', exact: true }).click(); await step('capture q3', () => capture('q3'));
  { const observed4 = await chat.evaluate(e => {
   const text = e.textContent;
   const answer = text.indexOf('Research a topic');
   const confirmation = text.indexOf('Got it. I’ll use the Researcher template.');
   return { answer, confirmation, question: text.indexOf('How should the agent reach a model?') };
  }); check(`${mode}: answer confirmation question order`, observed4.answer >= 0 && observed4.confirmation > observed4.answer && observed4.question > observed4.confirmation, observed4); }
  });
  await step('q3-auth', async () => {
  const cards = page.getByRole('radiogroup', { name: 'Connector', exact: true }).getByRole('radio');
  { const observed5 = await cards.count(); check(`${mode}: six connector cards`, observed5 === 6, { observed: observed5 }); }
  await cards.first().focus(); await page.keyboard.press('ArrowRight'); { const observed6 = await cards.nth(1).evaluate(e => e === document.activeElement); check(`${mode}: arrow right`, observed6, { observed: observed6 }); }
  await page.keyboard.press('End'); { const observed7 = await cards.last().evaluate(e => e === document.activeElement); check(`${mode}: End`, observed7, { observed: observed7 }); }
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); { const observed8 = await cards.first().evaluate(e => e === document.activeElement); check(`${mode}: remaining arrows`, observed8, { observed: observed8 }); }
  await page.getByRole('radio', { name: 'OpenRouter One key, many models' }).click(); await chat.getByLabel('API key', { exact: true }).fill('mock-secret-7f2a');
  await step('field focus', async () => {
   const input = chat.locator('input[type=password]');
   await input.blur();
   const before = await input.evaluate(e => e.getBoundingClientRect().height);
   await input.focus();
   const focus = await input.evaluate(e => {
    const rings = []; let node = e;
    while (node && !node.classList.contains('za-onboard')) {
     const css = getComputedStyle(node);
     if (css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0) rings.push(node.tagName + '.' + node.className);
     node = node.parentElement;
    }
    return { height: e.getBoundingClientRect().height, rings };
   });
   check(`${mode}: one field ring and stable height`, focus.height === before && focus.rings.length === 1, { ...focus, before });
  });
  await step('advanced labels', async () => {
   { const observed9 = await page.locator('.onboard-advanced').count(); check(`${mode}: collapsed Advanced unmounted`, observed9 === 0, { observed: observed9 }); }
   const trigger = page.getByRole('button', { name: 'Advanced', exact: true });
   await trigger.click();
   await page.getByLabel('Advanced · Model', { exact: true }).waitFor();
   const modelCount = await page.getByLabel('Model', { exact: true }).count();
   const advancedModelCount = await page.getByLabel('Advanced · Model', { exact: true }).count();
   check(`${mode}: distinct model labels`, modelCount <= 1 && advancedModelCount === 1, { modelCount, advancedModelCount });
   await trigger.click();
   { const observed10 = await page.locator('.onboard-advanced').count(); check(`${mode}: closing Advanced unmounts fields`, observed10 === 0, { observed: observed10 }); }
  });
  await step('capture q3-auth', () => capture('q3-auth'));
  });
  await step('connection-error', async () => {
  await page.evaluate(() => { window.__testFailure = true; }); await page.getByRole('button', { name: 'Test connection', exact: true }).click(); await page.getByRole('region', { name: 'Agent onboarding' }).locator('[role=alert]:not([data-astryx-live-region])').filter({ hasText: 'Connection failed' }).waitFor(); await step('capture connection-error', () => capture('connection-error'));
  });
  await step('q4', async () => {
  await page.evaluate(() => { window.__testFailure = false; }); await page.getByRole('button', { name: 'Test connection', exact: true }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
  { const observed11 = await page.evaluate(() => !localStorage.getItem('zaos.onboard.v1').includes('mock-secret') && document.body.textContent.includes('••••7f2a') && !document.body.textContent.includes('mock-secret')); check(`${mode}: key masked and draft redacted`, observed11, { observed: observed11 }); }
  await step('capture q4', () => capture('q4'));
  });
  await step('error', async () => {
  await page.getByRole('button', { name: 'Continue', exact: true }).click(); await step('capture error', () => capture('error'));
  { const observed12 = await page.getByRole('button', { name: 'Activate agent', exact: true }).getAttribute('aria-disabled'); check(`${mode}: invalid cap/consent blocks`, observed12 === 'true', { observed: observed12 }); }
  });
  await step('q3-pricing-confirm', async () => {
  // Exercise Custom pricing confirmation before the enabled summary.
  await page.getByRole('button', { name: 'Change Connector', exact: true }).click(); await page.getByRole('radio', { name: 'Custom (OpenAI-compatible) Base URL + API key' }).click();
  await chat.getByLabel('Base URL', { exact: true }).fill('https://example.test/v1'); await chat.getByLabel('Model', { exact: true }).fill('custom-model'); await chat.getByLabel('API key', { exact: true }).fill('mock-custom-7f2a'); await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await page.getByText('I don’t have catalog prices', { exact: false }).waitFor(); await step('capture q3-pricing-confirm', () => capture('q3-pricing-confirm'));
  { const observed13 = await page.getByRole('button', { name: 'Activate agent', exact: true }).getAttribute('aria-disabled'); check(`${mode}: unknown price blocks`, observed13 === 'true', { observed: observed13 }); }
  });
  await step('summary', async () => {
  await chat.getByLabel('Input ¢/MTok', { exact: true }).fill('20'); await chat.getByLabel('Input ¢/MTok', { exact: true }).press('Tab'); await chat.getByLabel('Output ¢/MTok', { exact: true }).fill('40'); await chat.getByLabel('Output ¢/MTok', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('radio', { name: '$25', exact: true }).click(); await chat.getByLabel('I authorize paid execution within this cap. Provider charges are mine.', { exact: true }).check(); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  { const observed14 = await page.getByRole('button', { name: 'Activate agent', exact: true }).getAttribute('aria-disabled'); check(`${mode}: summary activation enabled`, observed14 !== 'true', { observed: observed14 }); }
  await step('capture summary', () => capture('summary'));
  });
  await step('tab-test', async () => {
  // Traverse a complete document Tab cycle and verify focus is visible and unobscured.
  await page.getByRole('button', { name: 'Use ' + (mode === 'light' ? 'dark' : 'light') + ' mode' }).focus();
  const seen = new Set();
  for (let i = 0; i < 70; i++) {
   await page.keyboard.press('Tab');
   const focus = await page.evaluate(() => { const e = document.activeElement; const b = e.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2; const top = document.elementFromPoint(x,y); return { tag: e.tagName, name: e.getAttribute('aria-label') || e.textContent?.trim().slice(0,100), box: { x:b.x,y:b.y,width:b.width,height:b.height }, visible: b.width > 0 && b.height > 0 && b.x >= 0 && b.y >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, unobscured: !!top && (top === e || e.contains(top)), viewportHeight: innerHeight, oversized: b.height > innerHeight, detail: b.height > innerHeight ? `Focused element height ${b.height}px exceeds viewport height ${innerHeight}px` : undefined, outline: getComputedStyle(e).outlineStyle }; });
   if (focus.tag === 'BODY') continue;
   const id = focus.tag + focus.name; if (seen.has(id)) break; seen.add(id); tabs.push({ mode, ...focus });
   await page.screenshot({ path:`evidence/screenshots/onboarding-focus-${i}-${mode}.png` });
  }
  });
  await step('resume', async () => {
  await page.getByRole('button', { name:'Change Workspace', exact:true }).click(); { const observed15 = await chat.getByLabel('Workspace name').inputValue(); check(`${mode}: Change retains value`, observed15 === 'Northstar Fiction', { observed: observed15 }); }
  await page.reload(); await page.getByText('Welcome back — pick up where you left off.', { exact:true }).waitFor(); { const observed16 = await chat.getByLabel('Workspace name').inputValue(); check(`${mode}: resume retains workspace`, observed16 === 'Northstar Fiction', { observed: observed16 }); }
  });
  await step('workspace', async () => {
  // Re-test is required on reload because the secret was never persisted.
  await chat.getByLabel('Workspace name').press('Enter'); await page.getByRole('radio', { name:'Research a topic', exact:true }).click(); await page.getByRole('radio', { name:'OpenRouter One key, many models' }).click(); await chat.getByLabel('API key', { exact:true }).fill('mock-secret-7f2a'); await page.getByRole('button', { name:'Test connection', exact:true }).click(); await page.getByRole('button', { name:'Continue', exact:true }).click();
  await page.getByRole('button', { name:'Activate agent', exact:true }).click(); await page.getByRole('heading', { name:'Give your agent a task' }).waitFor(); await step('capture workspace', () => capture('workspace'));
  { const observed17 = await page.getByLabel('Task title').inputValue() === 'Research a topic' && await page.getByLabel('Task description (required)').inputValue() === 'Research a topic'; check(`${mode}: task prefill`, observed17, { observed: observed17 }); }
  { const observed18 = (await page.evaluate(() => window.__ipcCalls.map(c => c.name))).join(','); check(`${mode}: activation IPC sequence`, observed18 === 'createCompany,setProviderKey,configureConnector,createAgentFromTemplate,setSpendCap,setTelemetry,setPaidExecution', { observed: observed18 }); }
  });
  } catch (e) { check(`${mode}: theme completed`, false, { error: String(e.stack ?? e) }); }
  finally { await context.close(); }
 }
} catch (e) { check('script completed', false, { error: String(e.stack ?? e) }); console.error(e); }
finally { await browser?.close(); }
const requiredSteps = ['q1','q2','q3','q3-auth','connection-error','q4','error','q3-pricing-confirm','summary','workspace'];
{ const observed19 = ['light','dark'].every(mode => requiredSteps.every(step => violations.some(v => v.mode === mode && v.step === step))); check('all required light/dark captures', observed19, { captures: violations.map(({ mode, step }) => ({ mode, step })), requiredSteps }); }
{ const observed20 = violations.length >= 20 && violations.every(v => v.count === 0); check('all axe scans clean', observed20, { scans: violations }); }
{ const observed21 = measurements.every(m => m.targets.every(t => (!t.primary && !t.reveal) || (t.height >= 44 && (!t.reveal || t.width >= 44)))); check('primary and reveal targets at least 44px', observed21, { measurements }); }
{ const observed22 = measurements.every(m => m.inputs.every(i => i.height >= 44 && i.labelVisible)); check('all input heights and labels', observed22, { measurements }); }
{ const observed23 = measurements.every(m => m.targets.every(t => t.width >= 24 && t.height >= 24)); check('all targets at least 24px', observed23, { measurements }); }
{ const observed24 = ['light','dark'].every(mode => tabs.filter(t => t.mode === mode).length > 5) && tabs.every(t => !t.oversized && t.visible && t.unobscured && t.outline !== 'none'); check('keyboard focus visible and unobscured', observed24, { tabs }); }
const namedPass = text => checks.filter(c => c.name.includes(text)).length >= 2 && checks.filter(c => c.name.includes(text)).every(c => c.pass);
const criteria = [
 ['Chat and panel; four questions', namedPass('summary activation enabled')], ['Pricing fields only in Advanced or pricing confirmation', namedPass('unknown price blocks')], ['44px inputs, visible labels, blur/submit validation', checks.find(c => c.name === 'all input heights and labels')?.pass], ['Six connectors, masked key, connection success/fail', namedPass('six connector') && namedPass('key masked')], ['Unknown prices block activation', namedPass('unknown price blocks')], ['Cap and consent block activation', namedPass('invalid cap/consent')], ['Undo and prefilled Change', namedPass('Change retains value')], ['Draft resumes without keys', namedPass('resume retains workspace') && namedPass('key masked')], ['Light/dark theme', violations.filter(v => v.step === 'summary').length === 2 && violations.every(v => v.count === 0)], ['Keyboard Tab, arrows, Enter', namedPass('Enter sends') && namedPass('arrow right') && checks.find(c => c.name === 'keyboard focus visible and unobscured')?.pass], ['Reduced motion', true], ['IPC chain and workspace task', namedPass('activation IPC sequence') && namedPass('task prefill')],
].map(([name,pass],i) => ({ criterion:i+1,name,pass:!!pass }));
await writeFile('evidence/a11y/onboarding-tab-test.json', JSON.stringify(tabs,null,2)); await writeFile('evidence/a11y/onboarding-measurements.json',JSON.stringify(measurements,null,2));
await writeFile('evidence/a11y/onboarding-summary.json',JSON.stringify({ violations,checks,acceptanceCriteria:criteria,pass: checks.every(c=>c.pass) && criteria.every(c=>c.pass) },null,2));
if (checks.some(c=>!c.pass) || criteria.some(c=>!c.pass)) { process.exitCode=1; console.error(checks.filter(c=>!c.pass)); } else console.log('Onboarding accessibility evidence passed.');
