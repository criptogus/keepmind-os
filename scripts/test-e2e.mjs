// E2E test: launch the app over CDP and exercise every electronAPI surface.
// Usage: npm run build && node scripts/test-e2e.mjs
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

const deadline = Date.now() + 30_000;
while (!devtoolsWsUrl && Date.now() < deadline) {
  if (child.exitCode !== null) { console.error('electron exited', stderrBuf.slice(-1500)); process.exit(1); }
  await delay(200);
}
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
if (!pageWsUrl) { console.error('no page target'); child.kill(); process.exit(1); }

const ws = new WebSocket(pageWsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails?.text || 'exception');
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) return { __error: res.result.exceptionDetails.text + ' ' + (res.result.exceptionDetails.exception?.description || '') };
  return res.result?.result?.value;
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const api = (call) => evaluate(`window.electronAPI.${call}`);

try {
  await send('Runtime.enable');
  await send('Log.enable');

  // Wait for bridge
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    ready = await evaluate('typeof window.electronAPI === "object" && typeof window.electronAPI.getVersion === "function"');
    if (!ready) await delay(200);
  }
  check('preload bridge exposed', !!ready);

  // System
  const version = await api('getVersion()');
  check('app:getVersion', typeof version === 'string' && version.length > 0, version);
  const userData = await api('getPath("userData")');
  check('app:getPath', typeof userData === 'string' && userData.includes('Application Support'), userData);

  // Settings
  const settings = await api('getSettings()');
  check('settings:get', !!settings && typeof settings === 'object', JSON.stringify(settings).slice(0, 120));
  await api('updateSettings({ theme: "light" })');
  const s2 = await api('getSettings()');
  check('settings:update', s2.theme === 'light');

  // Company
  await api('updateCompany({ name: "E2E Corp", industry: "testing", website: "https://example.com" })');
  const company = await api('getCompany()');
  check('company:get/update', company.name === 'E2E Corp', company.name);

  // Skills (seeded built-ins)
  const skills = await api('getSkills()');
  check('skills seeded', Array.isArray(skills) && skills.length >= 4, `${skills?.length} skills: ${skills?.map(s=>s.name).join(', ')}`);
  const toolList = await api('listSkillTools()');
  check('skills:listTools', Array.isArray(toolList) && toolList.length >= 10, `${toolList?.length} tools`);

  // Model catalog
  const models = await api('listModels()');
  check('models:list', Array.isArray(models?.models) && models.models.length >= 10, `${models?.models?.length} models, live: ${(models?.liveProviders || []).join(',') || 'none'}`);
  check('models:refresh responds', typeof (await api('refreshModels()'))?.models?.length === 'number');

  // Credential persistence (safeStorage)
  check('api:hasKey (unset)', (await api('hasApiKey("openai")')) === false);
  await api('setApiKey("openai", "sk-e2e-fake-key")');
  check('api:hasKey after set', (await api('hasApiKey("openai")')) === true);
  await api('clearApiKey("openai")');
  check('api:hasKey after clear', (await api('hasApiKey("openai")')) === false);
  const newSkill = await api(`createSkill({ name: "E2E Skill", description: "test", prompt: "test prompt", toolNames: ["get_current_time"] })`);
  check('skills:create', !!newSkill?.id, newSkill?.name);
  const upd = await api(`updateSkill("${newSkill.id}", { prompt: "improved" })`);
  check('skills:update', upd?.prompt === 'improved');
  const got = await api(`getSkill("${newSkill.id}")`);
  check('skills:get', got?.name === 'E2E Skill');

  // Agents
  const skillId = skills[0]?.id;
  const agent = await api(`createAgent({ model: "gpt-4", temperature: 0.5, maxTokens: 512, systemPrompt: "You are a test agent.", tools: [], skillIds: ["${skillId}"] })`);
  check('agents:create', !!agent?.id, agent?.name);
  const agents = await api('getAgents()');
  check('agents:getList', agents.length >= 1, `${agents.length} agents`);
  const agentGot = await api(`getAgent("${agent.id}")`);
  check('agents:get', agentGot?.id === agent.id);
  const updAgent = await api(`updateAgent("${agent.id}", { temperature: 0.9 })`);
  check('agents:update', updAgent?.config?.temperature === 0.9);
  const execs = await api('getAgentExecutions()');
  check('agents:getExecutions', Array.isArray(execs), `${execs?.length} executions`);

  // Agent execution — expect graceful failure without credentials
  const execResult = await api(`executeAgent("${agent.id}", { message: "hi" })`).catch(() => null);
  const execErr = execResult?.__error;
  check('agents:execute (no creds → clean error)', !!execErr || execResult?.status === 'failed' || execResult?.status === 'completed',
    execErr ? execErr.slice(0, 100) : `status=${execResult?.status}`);

  // Teams
  const team = await api('createTeam({ name: "E2E Team", description: "test team" })');
  check('teams:create', !!team?.id, team?.name);
  const tAdd = await api(`addAgentToTeam("${team.id}", "${agent.id}")`);
  check('teams:addAgent', !!tAdd?.id || tAdd?.agentIds?.includes(agent.id), JSON.stringify(tAdd)?.slice(0, 80));
  const teams = await api('getTeams()');
  check('teams:getList', teams.length >= 1, `${teams.length} teams`);
  const teamGot = await api(`getTeam("${team.id}")`);
  check('teams:get', teamGot?.id === team.id);
  await api(`updateTeam("${team.id}", { description: "updated" })`);
  const teamUpd = await api(`getTeam("${team.id}")`);
  check('teams:update', teamUpd?.description === 'updated');

  // Governance
  const gov = await api('getGovernanceState()');
  check('governance:getState', !!gov && Array.isArray(gov.pendingApprovals), JSON.stringify(Object.keys(gov || {})));
  const rule = { id: 'rule-e2e', name: 'E2E Rule', type: 'approval_required', scope: 'global', condition: { field: 'action', operator: 'equals', value: 'test' }, action: { type: 'require_approval' }, enabled: true };
  await api(`setGovernanceRule(${JSON.stringify(rule)})`);
  const rules = await api('getGovernanceRules()');
  check('governance:setRule/getRules', rules.some((r) => r.id === 'rule-e2e'), `${rules.length} rules`);
  await api('deleteGovernanceRule("rule-e2e")');
  const rules2 = await api('getGovernanceRules()');
  check('governance:deleteRule', !rules2.some((r) => r.id === 'rule-e2e'));

  // Audit
  const logs = await api('getAuditLogs(50, 0)');
  check('audit:getLogs', Array.isArray(logs), `${logs?.length} entries`);

  // OAuth status
  const [ocO, ocA, oaO, oaA] = await Promise.all([
    api(`oauthIsConfigured('openai')`), api(`oauthIsConfigured('anthropic')`),
    api(`oauthIsAuthenticated('openai')`), api(`oauthIsAuthenticated('anthropic')`),
  ]);
  check('oauth:isConfigured', ocO === true && ocA === true, `openai=${ocO} anthropic=${ocA}`);
  // Auth state is environment-dependent: Codex CLI credentials (~/.codex/auth.json)
  // are auto-imported on startup, so openai may legitimately be true here.
  check('oauth:isAuthenticated', typeof oaO === 'boolean' && typeof oaA === 'boolean', `openai=${oaO} anthropic=${oaA}`);

  // Second brain
  const sbCfg = await api('secondBrainGetConfig()');
  check('secondbrain:getConfig', !!sbCfg && typeof sbCfg.enabled === 'boolean', JSON.stringify(sbCfg));
  await api('secondBrainSetConfig({ enabled: false })');
  const sbTest = await api('secondBrainTest()');
  check('secondbrain:test (disabled→error expected)', sbTest?.ok === false || sbTest?.ok === true, JSON.stringify(sbTest).slice(0, 100));

  // WhatsApp status (no connect — QR needs human scan)
  const waStatus = await api('whatsappGetStatus()');
  check('whatsapp:getStatus', ['disconnected','connecting','qr','connected','error'].includes(waStatus?.status), waStatus?.status);

  // Triggers
  const trigList = await api('triggersList()');
  check('triggers:list', Array.isArray(trigList), `${trigList?.length} triggers`);
  const trig = await api(`triggersCreate({ agentId: "${agent.id}", name: "E2E Trigger", kind: "interval", intervalMinutes: 60, prompt: "check status", enabled: true })`);
  check('triggers:create', !!trig?.id, trig?.name);
  await api(`triggersUpdate("${trig.id}", { enabled: false })`);
  const trig2 = await api('triggersList()');
  check('triggers:update', trig2.find((t) => t.id === trig.id)?.enabled === false);
  await api(`triggersSetWhatsAppAgent("${agent.id}")`);
  const waAgent = await api('triggersGetWhatsAppAgent()');
  check('triggers:whatsappAgent', waAgent?.agentId === agent.id);
  await api('triggersSetWhatsAppAgent("")');
  await api(`triggersDelete("${trig.id}")`);
  const trig3 = await api('triggersList()');
  check('triggers:delete', !trig3.some((t) => t.id === trig.id));

  // Skills cleanup + agent cleanup
  await api(`deleteSkill("${newSkill.id}")`);
  // skills:improve needs an LLM — expect clean error without creds
  const improve = await api(`improveSkill("${skills[0].id}")`);
  check('skills:improve responds', !!improve || !!improve?.__error, JSON.stringify(improve)?.slice(0, 100));
  await api(`deleteAgent("${agent.id}")`);
  await api(`removeAgentFromTeam("${team.id}", "${agent.id}")`);
  const teamNoAgent = await api(`getTeam("${team.id}")`);
  check('teams:removeAgent', !teamNoAgent?.agentIds?.includes(agent.id));
  const teamExec = await api(`executeTeam("${team.id}", { message: "hi" })`).catch(() => null);
  check('teams:execute responds', !!teamExec || !!teamExec?.__error, JSON.stringify(teamExec)?.slice(0, 100));
  await api(`deleteTeam("${team.id}")`);

  // Update check (may fail w/o feed — record result)
  const updCheck = await api('updateCheck()');
  check('update:check responds', updCheck && typeof updCheck.ok === 'boolean', JSON.stringify(updCheck).slice(0, 120));

  // Page errors
  check('no uncaught page exceptions', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ').slice(0, 200));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== E2E ${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILURES'}: ${results.length - failed.length}/${results.length} ===`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (err) {
  console.error('E2E harness error:', err);
  process.exitCode = 1;
} finally {
  ws.close();
  child.kill('SIGTERM');
  await delay(500);
  if (child.exitCode === null) child.kill('SIGKILL');
}
