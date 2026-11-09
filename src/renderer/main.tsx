import { Onboarding } from './onboarding/Onboarding';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './design/zero-agency-theme.css';
import './ui.css';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Badge } from '@astryxdesign/core/Badge';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ZaosAPI, TaskResult } from '../shared/types';
declare global {
    interface Window {
        zaos: ZaosAPI;
    }
}
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
    const [consent, setConsent] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [result, setResult] = useState<TaskResult>();
    const [progress, setProgress] = useState(0);
    useEffect(() => {
        const media = matchMedia('(prefers-color-scheme: dark)');
        const update = () => { if (!manual)
            setMode(media.matches ? 'dark' : 'light'); };
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, [manual]);
    useEffect(() => {
        let active = true;
        const update = async () => {
            try {
                const s = await window.zaos.getStatus();
                if (active) {
                    setStatus(s);
                    setProgress(p => Math.max(p, s.setupProgress ?? 0));
                    if (s.lastResult)
                        setResult(s.lastResult);
                }
            }
            catch (e) {
                if (active)
                    setError(String(e));
            }
        };
        void update();
        const timer = setInterval(() => { void update(); }, 500);
        return () => { active = false; clearInterval(timer); };
    }, []);
    function clearField(field: string) {
        setFieldErrors(current => { const next = { ...current }; delete next[field]; return next; });
    }
    function focusInvalid() {
        requestAnimationFrame(() => screenRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    }
    function validateFields(errors: Record<string, string>) {
        setFieldErrors(errors);
        if (!Object.keys(errors).length)
            return true;
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
        const fields: [
            RegExp,
            string
        ][] = [
            [/provider (?:base )?url|baseUrl/i, 'baseUrl'], [/model/i, 'model'],
            [/inputCentsPerMTok|input price/i, 'inputPrice'], [/outputCentsPerMTok|output price/i, 'outputPrice'],
            [/maxOutputTokens|output limit|maximum output tokens/i, 'maxTokens'], [/maxRunCents|cost per run/i, 'maxRun'],
            [/provider key|API key|BYOK key/i, 'key'], [/monthly cap|spend cap|^cap must/i, 'cap'],
            [/consent/i, 'consent'], [/company name/i, 'company'], [/template/i, 'template'],
            [/task title/i, 'title'], [/task description/i, 'description'],
        ];
        const field = fields.find(([pattern]) => pattern.test(message))?.[1];
        if (field) {
            setFieldErrors(current => ({ ...current, [field]: message }));
            focusInvalid();
        }
    }
    async function action(label: string, fn: () => Promise<unknown>) {
        setBusy(true);
        setError('');
        setMessage(label);
        try {
            await fn();
            setStatus(await window.zaos.getStatus());
            setMessage('Ready for your next decision.');
        }
        catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            setError(reason);
            mapApiError(reason);
            setMessage('Action stopped. Review the reason below.');
        }
        finally {
            setBusy(false);
        }
    }
    function runTask() {
        const errors: Record<string, string> = {};
        if (!title.trim() || title.length > 300)
            errors.title = 'Enter a task title of up to 300 characters.';
        if (!description.trim() || description.length > 50000)
            errors.description = 'Enter a task description of up to 50,000 characters.';
        if (validateFields(errors))
            void action('Agent is working. Waiting for usage reconciliation…', async () => setResult(await window.zaos.runTask(title, description)));
    }
    const operational = status.state === 'ready';
    return <div className="zero-agency-os"><Theme theme={neutralTheme} mode={mode}><div className="za-screen" ref={screenRef}>
        <a className="za-skip" href="#workspace-content">Skip to content</a>
        <header className="app-topbar"><div className="app-brand"><span className="brand-mark" aria-hidden="true">Z</span><h1>Zero Agency OS</h1></div>
        <div className="topbar-actions"><div className="status-line" role="status" aria-live="polite"><StatusDot variant={operational ? 'neutral' : 'warning'} label={operational ? 'Ready' : 'Starting'}/>{operational ? `${status.paidExecution ? 'Paid execution enabled' : 'Paid execution disabled'} · ${busy ? message : 'Local service ready'}` : `Local service: ${status.state}`}</div>
        <span id="configuration-toggle"/><IconButton size="lg" data-mode-toggle label={mode === 'light' ? 'Use dark mode' : 'Use light mode'} icon={<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{mode === 'light' ? <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/> : <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>}</svg>} variant="ghost" onClick={() => { setManual(true); setMode(mode === 'light' ? 'dark' : 'light'); }}/></div></header>
        {error && <p id="action-error" className="notice" role="alert">{error}</p>}
        <main id="workspace-content" tabIndex={-1}>
        {!operational ? <Card className="za-card startup-card"><Spinner /><h2>Preparing your local workspace</h2><p>Starting Paperclip, signing in the operator, and checking spend policies before execution becomes available.</p><p role="status" aria-live="polite">{status.lastError ?? 'Your data stays on this device. First startup can take a few minutes.'}</p>{status.state !== 'starting' && <Button className="za-control za-primary" label="Retry startup" isDisabled={busy} onClick={() => void action('Retrying startup…', () => window.zaos.retryStartup())}/>}{status.logTail && <Collapsible trigger="Local service log tail"><pre>{status.logTail}</pre></Collapsible>}</Card>
            : !status.configured ? <Onboarding progress={progress} onComplete={goal => { setTitle(goal.slice(0, 300)); setDescription(goal); void window.zaos.getStatus().then(setStatus); }}/>
                : <div className="workspace"><div className="workspace-main"><Card className="za-card task-card"><header className="task-header"><span className="workspace-symbol" aria-hidden="true">↗</span><Heading level={2}>Give your agent a task</Heading><Text color="secondary">Drafts stay in review until you accept them.</Text></header>
            <form noValidate aria-busy={busy} onSubmit={e => { e.preventDefault(); runTask(); }}>
                <fieldset disabled={busy}><label>Task title<input value={title} aria-invalid={!!fieldErrors.title} aria-describedby={fieldErrors.title ? "title-error" : undefined} onChange={e => { setTitle(e.target.value); clearField("title"); }} required/></label>{nativeError("title")}<label>Task description (required)<textarea aria-invalid={!!fieldErrors.description} aria-describedby={fieldErrors.description ? "description-error" : undefined} value={description} onChange={e => { setDescription(e.target.value); clearField("description"); }} required rows={6}/></label>{nativeError("description")}</fieldset>
                <div className="task-footer"><span className="za-muted">You review every draft.</span><Button className="za-control za-primary" type="submit" label={busy ? 'Working…' : 'Run task'} isDisabled={busy || !status.paidExecution}/></div>
            </form>
            <p id="task-result-status" role="status" aria-live="polite">{result ? 'Task finished. Review is ready below.' : ''}</p>
            {!result && <div className="task-empty"><EmptyState isCompact title="Ready when you are" description="No task yet. Give your agent a task." icon={<span className="empty-icon">◇</span>}/></div>}
            {result && <section className="result-card" aria-labelledby="result-heading"><Badge label={result.status} variant="neutral"/><h3 id="result-heading">{result.status === 'accepted' ? 'Review accepted' : result.status === 'succeeded' ? 'Ready for human review' : 'Execution stopped'}</h3><pre className="result">{result.result || 'The task returned no text. Open the board to inspect the run.'}</pre><p>Run cost: {money(result.costCents)}</p><p>Spent: {money(result.spent)} / {money(result.cap)} monthly cap</p><ProgressBar label="Monthly spend" isLabelHidden value={result.spent} max={Math.max(1, result.cap)}/>{result.status !== 'succeeded' && result.status !== 'accepted' && <Button className="za-control za-primary" label="Retry" isDisabled={busy || !status.paidExecution} onClick={runTask}/>} {result.status === 'succeeded' && result.issueId && <Button className="za-control za-primary" label="Accept review" isDisabled={busy} onClick={() => void action('Accepting review…', () => window.zaos.acceptReview(result.issueId!))}/>}</section>}
        </Card></div><aside aria-labelledby="execution-controls-title"><Card className="za-card"><h2 id="execution-controls-title">Execution controls</h2><MetadataList className="control-metadata" label={{ position: "top" }}><MetadataListItem label="Monthly cap">{money(status.cap ?? 0)}</MetadataListItem><MetadataListItem label="Spent">{money(result?.spent ?? 0)}</MetadataListItem><MetadataListItem label="Paid execution"><Badge label={status.paidExecution ? "Enabled" : "Paused"} variant="neutral"/></MetadataListItem></MetadataList><p>Unpriced usage blocks future execution. Disabling execution pauses the agent.</p><div className="actions"><Button className="za-control" label="Open Paperclip board" variant="secondary" onClick={() => void action('Opening board…', () => window.zaos.openBoard())}/><Button className="za-control" label="Disable paid execution" variant="secondary" isDisabled={busy || !status.paidExecution} onClick={() => void action('Pausing agent…', () => window.zaos.setPaidExecution(false, false))}/>{!status.paidExecution && <><label className="check"><input type="checkbox" aria-invalid={!!fieldErrors.consent} aria-describedby={fieldErrors.consent ? "consent-error" : undefined} checked={consent} onChange={e => { setConsent(e.target.checked); clearField("consent"); }}/>I authorize paid execution within the saved cap.</label>{nativeError("consent")}<Button className="za-control za-primary" label="Enable paid execution" isDisabled={busy || !consent} onClick={() => void action('Checking spend policy…', () => window.zaos.setPaidExecution(true, consent))}/></>}</div></Card></aside></div>}
        </main>

    </div></Theme></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
