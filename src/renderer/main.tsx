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
import { useEffect, useRef, useState } from 'react';
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
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const screenRef = useRef<HTMLDivElement>(null);
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
    function clearField(field: string) {
        setFieldErrors(current => { const next = { ...current }; delete next[field]; return next; });
    }
    function focusInvalid() {
        requestAnimationFrame(() => screenRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    }
    function validateFields(errors: Record<string, string>) {
        setFieldErrors(errors);
        if (!Object.keys(errors).length) return true;
        setError('Review the highlighted fields before continuing.');
        focusInvalid();
        return false;
    }
    function fieldStatus(field: string) {
        return fieldErrors[field] ? { type: 'error' as const, message: fieldErrors[field] } : undefined;
    }
    function nativeError(field: string) {
        return fieldErrors[field] && <p id={`${field}-error`} role="alert">{fieldErrors[field]}</p>;
    }
    function mapApiError(message: string) {
        // Only attach errors whose wording identifies a specific field.
        const fields: [RegExp, string][] = [
            [/provider (?:base )?url|baseUrl/i, 'baseUrl'], [/model/i, 'model'],
            [/inputCentsPerMTok|input price/i, 'inputPrice'], [/outputCentsPerMTok|output price/i, 'outputPrice'],
            [/maxOutputTokens|output limit|maximum output tokens/i, 'maxTokens'], [/maxRunCents|cost per run/i, 'maxRun'],
            [/provider key|API key|BYOK key/i, 'key'], [/monthly cap|spend cap|^cap must/i, 'cap'],
            [/consent/i, 'consent'], [/company name/i, 'company'], [/template/i, 'template'],
            [/task title/i, 'title'], [/task description/i, 'description'],
        ];
        const field = fields.find(([pattern]) => pattern.test(message))?.[1];
        if (field) { setFieldErrors(current => ({ ...current, [field]: message })); focusInvalid(); }
    }
    async function action(label: string, fn: () => Promise<unknown>) {
        setBusy(true); setError(''); setMessage(label);
        try { await fn(); setStatus(await window.zaos.getStatus()); setMessage('Ready for your next decision.'); }
        catch (e) { const reason = e instanceof Error ? e.message : String(e); setError(reason); mapApiError(reason); setMessage('Action stopped. Review the reason below.'); }
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
    function submitSetup() {
        const errors: Record<string, string> = {};
        if (progress < 1 && (!company.trim() || company.length > 200)) errors.company = 'Enter a company name of up to 200 characters.';
        if (progress < 2 && (!key.trim() || key.length > 8192)) errors.key = 'Enter a provider API key of up to 8,192 characters.';
        if (progress < 3) {
            if (!['researcher', 'chief-of-staff', 'marketing-writer'].includes(template)) errors.template = 'Choose an agent template.';
            try {
                const url = new URL(baseUrl);
                if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.username || url.password || url.search || url.hash) throw new Error();
            } catch { errors.baseUrl = 'Enter an HTTPS provider URL or HTTP URL on 127.0.0.1, without credentials, query, or fragment.'; }
            if (!model.trim() || model.length > 200) errors.model = 'Enter a model name of up to 200 characters.';
            for (const [field, value, label] of [['inputPrice', inputPrice, 'input price'], ['outputPrice', outputPrice, 'output price'], ['maxRun', maxRun, 'maximum cost per run']] as const) {
                if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0) errors[field] = `Enter a positive ${label}.`;
            }
            if (!maxTokens.trim() || !Number.isSafeInteger(Number(maxTokens)) || Number(maxTokens) <= 0) errors.maxTokens = 'Enter a positive whole number of output tokens.';
        }
        try { monthlyUsdToCents(cap); } catch (e) { errors.cap = e instanceof Error ? e.message : String(e); }
        if (!consent) errors.consent = 'Authorize paid execution within this cap to continue.';
        if (validateFields(errors)) void action('Configuring your workspace…', async () => { await setup(); setProgress(4); });
    }
    function runTask() {
        const errors: Record<string, string> = {};
        if (!title.trim() || title.length > 300) errors.title = 'Enter a task title of up to 300 characters.';
        if (!description.trim() || description.length > 50000) errors.description = 'Enter a task description of up to 50,000 characters.';
        if (validateFields(errors)) void action('Agent is working. Waiting for usage reconciliation…', async () => setResult(await window.zaos.runTask(title, description)));
    }
    const operational = status.state === 'ready';
    return <div className="zero-agency-os"><Theme theme={neutralTheme} mode={mode}><div className="za-screen" ref={screenRef}>
        <a className="za-skip" href="#workspace-content">Skip to content</a>
        <header><div><p className="eyebrow">ZERO AGENCY OS · LOCAL WORKSPACE</p><h1>Human direction.<br/>Agent execution.</h1></div><Button className="za-control" data-mode-toggle label={mode === 'light' ? 'Use dark mode' : 'Use light mode'} variant="secondary" onClick={() => { setManual(true); setMode(mode === 'light' ? 'dark' : 'light'); }} /></header>
        <div className="status-line" role="status" aria-live="polite">{operational ? `${status.paidExecution ? 'Paid execution enabled' : 'Paid execution disabled'} · ${busy ? message : 'Local service ready'}` : `Local service: ${status.state}`}</div>
        {error && <p id="action-error" className="notice" role="alert">{error}</p>}
        <main id="workspace-content" tabIndex={-1}>
        {!operational ? <Card className="za-card"><p className="eyebrow">01 / STARTUP</p><h2>Preparing your local workspace</h2><p>Starting Paperclip, signing in the operator, and checking spend policies before execution becomes available.</p><p role="status" aria-live="polite">{status.lastError ?? 'Your data stays on this device. First startup can take a few minutes.'}</p>{status.state !== 'starting' && <Button className="za-control za-primary" label="Retry startup" isDisabled={busy} onClick={() => void action('Retrying startup…', () => window.zaos.retryStartup())} />}{status.logTail && <details><summary>Local service log tail</summary><pre>{status.logTail}</pre></details>}</Card>
        : !status.configured ? <Card className="za-card"><p className="eyebrow">02 / SETUP</p><h2>Build a workspace with boundaries</h2><p className="za-muted">Bring your provider key. Set a hard monthly cap. Every draft waits for your review.</p>
            <form noValidate aria-busy={busy} onSubmit={e => { e.preventDefault(); submitSetup(); }}>
                <fieldset disabled={busy}><legend>Workspace and agent</legend><div className="grid">
                    <TextInput label="Company name" value={company} status={fieldStatus("company")} onChange={value => { setCompany(value); clearField("company"); }} isRequired isDisabled={progress >= 1} disabledMessage="Saved; locked for this setup" />
                    <div><label>Agent template<select value={template} onChange={e => { setTemplate(e.target.value); clearField("template"); }} disabled={progress >= 3} aria-invalid={!!fieldErrors.template} aria-describedby={[fieldErrors.template && "template-error", progress >= 3 && "template-locked"].filter(Boolean).join(" ") || undefined}><option value="researcher">Researcher</option><option value="chief-of-staff">Chief of Staff</option><option value="marketing-writer">Marketing Writer</option></select></label>{nativeError("template")}{progress >= 3 && <p id="template-locked">Saved; locked for this setup</p>}</div>
                </div></fieldset>
                <fieldset disabled={busy || progress >= 3}><legend>OpenAI-compatible provider</legend><div className="grid">
                    <TextInput label="Provider base URL" type="url" value={baseUrl} status={fieldStatus("baseUrl")} onChange={value => { setBaseUrl(value); clearField("baseUrl"); }} isRequired />
                    <TextInput label="Model" value={model} status={fieldStatus("model")} onChange={value => { setModel(value); clearField("model"); }} isRequired />
                    <TextInput label="Input price (cents / million tokens)" value={inputPrice} status={fieldStatus("inputPrice")} onChange={value => { setInputPrice(value); clearField("inputPrice"); }} inputMode="decimal" isRequired />
                    <TextInput label="Output price (cents / million tokens)" value={outputPrice} status={fieldStatus("outputPrice")} onChange={value => { setOutputPrice(value); clearField("outputPrice"); }} inputMode="decimal" isRequired />
                    <TextInput label="Maximum output tokens" value={maxTokens} status={fieldStatus("maxTokens")} onChange={value => { setMaxTokens(value); clearField("maxTokens"); }} inputMode="numeric" isRequired />
                    <TextInput label="Maximum cost per run (cents)" value={maxRun} status={fieldStatus("maxRun")} onChange={value => { setMaxRun(value); clearField("maxRun"); }} inputMode="decimal" isRequired />
                    <TextInput label={progress >= 2 ? 'API key saved securely' : 'Provider API key'} type="password" value={key} status={fieldStatus("key")} onChange={value => { setKey(value); clearField("key"); }} isRequired={progress < 2} isDisabled={progress >= 2} disabledMessage="Saved; locked for this setup" />
                </div></fieldset>
                <fieldset disabled={busy}><legend>Spend and privacy</legend><TextInput label="Monthly spend cap (USD)" value={cap} status={fieldStatus("cap")} onChange={value => { setCap(value); clearField("cap"); }} inputMode="decimal" isRequired />
                    <label className="check"><input type="checkbox" aria-invalid={!!fieldErrors.consent} aria-describedby={fieldErrors.consent ? "consent-error" : undefined} checked={consent} onChange={e => { setConsent(e.target.checked); clearField("consent"); }} required/>I authorize paid execution within this cap. Provider charges are mine. (required)</label>{nativeError("consent")}
                    <label className="check"><input type="checkbox" checked={telemetry} onChange={e => setTelemetry(e.target.checked)}/>Opt in to telemetry preference (v0.1 sends nothing)</label>
                </fieldset><Button className="za-control za-primary" type="submit" label="Create workspace and enable execution" isDisabled={busy} />
            </form></Card>
        : <div className="workspace"><Card className="za-card"><p className="eyebrow">03 / WORKSPACE</p><h2>Give your agent a task</h2><p className="za-muted">Drafts stay in review until you accept them.</p>
            <form noValidate aria-busy={busy} onSubmit={e => { e.preventDefault(); runTask(); }}>
                <fieldset disabled={busy}><TextInput label="Task title" value={title} status={fieldStatus("title")} onChange={value => { setTitle(value); clearField("title"); }} isRequired/><label>Task description (required)<textarea aria-invalid={!!fieldErrors.description} aria-describedby={fieldErrors.description ? "description-error" : undefined} value={description} onChange={e => { setDescription(e.target.value); clearField("description"); }} required rows={4}/></label>{nativeError("description")}</fieldset>
                <Button className="za-control za-primary" type="submit" label={busy ? 'Working…' : 'Run task'} isDisabled={busy || !status.paidExecution}/>
            </form>
            <p id="task-result-status" role="status" aria-live="polite">{result ? 'Task finished. Review is ready below.' : ''}</p>
            {!result && <p>No task yet. Give your agent a task.</p>}
            {result && <section aria-labelledby="result-heading"><h3 id="result-heading">{result.status === 'accepted' ? 'Review accepted' : result.status === 'succeeded' ? 'Ready for human review' : 'Execution stopped'}</h3><pre className="result">{result.result || 'The task returned no text. Open the board to inspect the run.'}</pre><p>Run cost: {money(result.costCents)}</p><p>Spent: {money(result.spent)} / {money(result.cap)} monthly cap</p>{result.status !== 'succeeded' && result.status !== 'accepted' && <Button className="za-control za-primary" label="Retry" isDisabled={busy || !status.paidExecution} onClick={runTask}/>} {result.status === 'succeeded' && result.issueId && <Button className="za-control za-primary" label="Accept review" isDisabled={busy} onClick={() => void action('Accepting review…', () => window.zaos.acceptReview(result.issueId!))}/>}</section>}
        </Card><aside aria-labelledby="execution-controls-title"><Card className="za-card"><h2 id="execution-controls-title">Execution controls</h2><p>Monthly cap: {money(status.cap ?? 0)}</p><p>Unpriced usage blocks future execution. Disabling execution pauses the agent.</p><div className="actions"><Button className="za-control" label="Open Paperclip board" variant="secondary" onClick={() => void action('Opening board…', () => window.zaos.openBoard())}/><Button className="za-control" label="Disable paid execution" variant="secondary" isDisabled={busy || !status.paidExecution} onClick={() => void action('Pausing agent…', () => window.zaos.setPaidExecution(false, false))}/>{!status.paidExecution && <><label className="check"><input type="checkbox" aria-invalid={!!fieldErrors.consent} aria-describedby={fieldErrors.consent ? "consent-error" : undefined} checked={consent} onChange={e => { setConsent(e.target.checked); clearField("consent"); }}/>I authorize paid execution within the saved cap.</label>{nativeError("consent")}<Button className="za-control za-primary" label="Enable paid execution" isDisabled={busy || !consent} onClick={() => void action('Checking spend policy…', () => window.zaos.setPaidExecution(true, consent))}/></>}</div></Card></aside></div>}
        </main>
        <footer>Private by default. Human approval by design. <span className="za-muted">MVP v0.1 · Telemetry sends nothing.</span></footer>
    </div></Theme></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
