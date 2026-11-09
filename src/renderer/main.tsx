import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './design/zero-agency-theme.css';
import './ui.css';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { TextInput } from '@astryxdesign/core/TextInput';
import { monthlyUsdToCents } from './amount';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ZaosAPI, ProviderConfig, TaskResult } from '../shared/types';

declare global { interface Window { zaos: ZaosAPI } }
type Status = Awaited<ReturnType<ZaosAPI['getStatus']>>;
const money = (cents: number) => `$${(cents / 100).toFixed(4).replace(/0{1,2}$/, '')}`;
function App() {
    const [mode, setMode] = useState<'light' | 'dark'>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const [manual, setManual] = useState(false);
    const [status, setStatus] = useState<Status>({ state: 'starting', paidExecution: false });
    const [message, setMessage] = useState('Starting the local workspace…');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [company, setCompany] = useState('');
    const [template, setTemplate] = useState('researcher');
    const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
    const [model, setModel] = useState('');
    const [inputPrice, setInputPrice] = useState('');
    const [outputPrice, setOutputPrice] = useState('');
    const [maxTokens, setMaxTokens] = useState('512');
    const [maxRun, setMaxRun] = useState('5');
    const [key, setKey] = useState('');
    const [cap, setCap] = useState('');
    const [consent, setConsent] = useState(false);
    const [telemetry, setTelemetry] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [result, setResult] = useState<TaskResult>();
    const [progress, setProgress] = useState(0);
    useEffect(() => {
        const media = matchMedia('(prefers-color-scheme: dark)');
        const update = () => { if (!manual) setMode(media.matches ? 'dark' : 'light'); };
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, [manual]);
    useEffect(() => {
        let active = true;
        const update = async () => {
            try { const s = await window.zaos.getStatus(); if (active) { setStatus(s); setProgress(p => Math.max(p, s.setupProgress ?? 0)); if (s.lastResult) setResult(s.lastResult); } }
            catch (e) { if (active) setError(String(e)); }
        };
        void update(); const timer = setInterval(() => { void update(); }, 500);
        return () => { active = false; clearInterval(timer); };
    }, []);
    useEffect(() => { if (status.state === 'ready') void window.zaos.getTelemetry().then(setTelemetry).catch(() => {}); }, [status.state]);
    async function action(label: string, fn: () => Promise<unknown>) {
        setBusy(true); setError(''); setMessage(label);
        try { await fn(); setStatus(await window.zaos.getStatus()); setMessage('Ready for your next decision.'); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); setMessage('Action stopped. Review the reason below.'); }
        finally { setBusy(false); }
    }
    const provider: ProviderConfig = { baseUrl, model, inputCentsPerMTok: Number(inputPrice), outputCentsPerMTok: Number(outputPrice), maxOutputTokens: Number(maxTokens), maxRunCents: Number(maxRun) };
    async function setup() {
        const cents = monthlyUsdToCents(cap);
        if (!consent) throw new Error('Explicit spend consent is required.');
        // Each successful step is retained so a validation error can be corrected without recreating resources.
        if (progress < 1) { await window.zaos.createCompany(company); setProgress(1); }
        if (progress < 2) { await window.zaos.setProviderKey(key); setKey(''); setProgress(2); }
        if (progress < 3) { await window.zaos.createAgentFromTemplate(template, provider); setProgress(3); }
        await window.zaos.setSpendCap(cents);
        await window.zaos.setTelemetry(telemetry);
        await window.zaos.setPaidExecution(true, consent);
    }
    const operational = status.state === 'ready';
    return <div className="zero-agency-os"><Theme theme={neutralTheme} mode={mode}><main className="za-screen">
        <header><div><p className="eyebrow">ZERO AGENCY OS · LOCAL WORKSPACE</p><h1>Human direction.<br/>Agent execution.</h1></div><Button data-mode-toggle label={mode === 'light' ? 'Use dark mode' : 'Use light mode'} variant="secondary" onClick={() => { setManual(true); setMode(mode === 'light' ? 'dark' : 'light'); }} /></header>
        <div className="status-line" role="status" aria-live="polite">{operational ? `${status.paidExecution ? 'Paid execution enabled' : 'Paid execution disabled'} · ${busy ? message : 'Local service ready'}` : `Local service: ${status.state}`}</div>
        {error && <p className="notice" role="alert">{error}</p>}
        {!operational ? <Card className="za-card"><p className="eyebrow">01 / STARTUP</p><h2>Preparing your local workspace</h2><p>Starting Paperclip, signing in the operator, and checking spend policies before execution becomes available.</p><p role="status" aria-live="polite">{status.lastError ?? 'Your data stays on this device. First startup can take a few minutes.'}</p>{status.state !== 'starting' && <Button label="Retry startup" isDisabled={busy} onClick={() => void action('Retrying startup…', () => window.zaos.retryStartup())} />}{status.logTail && <details><summary>Local service log tail</summary><pre>{status.logTail}</pre></details>}</Card>
        : !status.configured ? <Card className="za-card"><p className="eyebrow">02 / SETUP</p><h2>Build a workspace with boundaries</h2><p className="za-muted">Bring your provider key. Set a hard monthly cap. Every draft waits for your review.</p>
            <form onSubmit={e => { e.preventDefault(); void action('Configuring your workspace…', async () => { await setup(); setProgress(4); }); }}>
                <fieldset disabled={busy}><legend>Workspace and agent</legend><div className="grid">
                    <TextInput label="Company name" value={company} onChange={setCompany} isRequired isDisabled={progress >= 1} />
                    <label>Agent template<select value={template} onChange={e => setTemplate(e.target.value)} disabled={progress >= 3}><option value="researcher">Researcher</option><option value="chief-of-staff">Chief of Staff</option><option value="marketing-writer">Marketing Writer</option></select></label>
                </div></fieldset>
                <fieldset disabled={busy || progress >= 3}><legend>OpenAI-compatible provider</legend><div className="grid">
                    <TextInput label="Provider base URL" type="url" value={baseUrl} onChange={setBaseUrl} isRequired />
                    <TextInput label="Model" value={model} onChange={setModel} isRequired />
                    <TextInput label="Input price (cents / million tokens)" value={inputPrice} onChange={setInputPrice} inputMode="decimal" isRequired />
                    <TextInput label="Output price (cents / million tokens)" value={outputPrice} onChange={setOutputPrice} inputMode="decimal" isRequired />
                    <TextInput label="Maximum output tokens" value={maxTokens} onChange={setMaxTokens} inputMode="numeric" isRequired />
                    <TextInput label="Maximum cost per run (cents)" value={maxRun} onChange={setMaxRun} inputMode="decimal" isRequired />
                    <TextInput label={progress >= 2 ? 'API key saved securely' : 'Provider API key'} type="password" value={key} onChange={setKey} isRequired={progress < 2} isDisabled={progress >= 2} />
                </div></fieldset>
                <fieldset disabled={busy}><legend>Spend and privacy</legend><TextInput label="Monthly spend cap (USD)" value={cap} onChange={setCap} inputMode="decimal" isRequired />
                    <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required/>I authorize paid execution within this cap. Provider charges are mine.</label>
                    <label className="check"><input type="checkbox" checked={telemetry} onChange={e => setTelemetry(e.target.checked)}/>Opt in to telemetry preference (v0.1 sends nothing)</label>
                </fieldset><Button type="submit" label="Create workspace and enable execution" isDisabled={busy} />
            </form></Card>
        : <div className="workspace"><Card className="za-card"><p className="eyebrow">03 / WORKSPACE</p><h2>Give your agent a task</h2><p className="za-muted">Drafts stay in review until you accept them.</p>
            <form onSubmit={e => { e.preventDefault(); void action('Agent is working. Waiting for usage reconciliation…', async () => setResult(await window.zaos.runTask(title, description))); }}>
                <fieldset disabled={busy}><TextInput label="Task title" value={title} onChange={setTitle} isRequired/><label>Task description<textarea value={description} onChange={e => setDescription(e.target.value)} required rows={4}/></label></fieldset>
                <Button type="submit" label={busy ? 'Working…' : 'Run task'} isDisabled={busy || !status.paidExecution}/>
            </form>
            {result && <section aria-labelledby="result-heading"><h3 id="result-heading">{result.status === 'accepted' ? 'Review accepted' : result.status === 'succeeded' ? 'Ready for human review' : 'Execution stopped'}</h3><pre className="result">{result.result || 'No result was returned. Open the board to inspect the run.'}</pre><p>Run cost: {money(result.costCents)}</p><p>Spent: {money(result.spent)} / {money(result.cap)} monthly cap</p>{result.status === 'succeeded' && result.issueId && <Button label="Accept review" isDisabled={busy} onClick={() => void action('Accepting review…', () => window.zaos.acceptReview(result.issueId!))}/>}</section>}
        </Card><aside><Card className="za-card"><h2>Execution controls</h2><p>Monthly cap: {money(status.cap ?? 0)}</p><p>Unpriced usage blocks future execution. Disabling execution pauses the agent.</p><div className="actions"><Button label="Open Paperclip board" variant="secondary" onClick={() => void action('Opening board…', () => window.zaos.openBoard())}/><Button label="Disable paid execution" variant="secondary" isDisabled={busy || !status.paidExecution} onClick={() => void action('Pausing agent…', () => window.zaos.setPaidExecution(false, false))}/>{!status.paidExecution && <><label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>I authorize paid execution within the saved cap.</label><Button label="Enable paid execution" isDisabled={busy || !consent} onClick={() => void action('Checking spend policy…', () => window.zaos.setPaidExecution(true, consent))}/></>}</div></Card></aside></div>}
        <footer>Private by default. Human approval by design. <span className="za-muted">MVP v0.1 · Telemetry sends nothing.</span></footer>
    </main></Theme></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
