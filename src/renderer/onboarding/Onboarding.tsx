import { BrandMark, PoweredBy } from '../Brand';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Heading, Text } from '@astryxdesign/core/Text';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Card } from '@astryxdesign/core/Card';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { TextInput } from '@astryxdesign/core/TextInput';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Banner } from '@astryxdesign/core/Banner';
import { Spinner } from '@astryxdesign/core/Spinner';
import { ChatLayout, ChatMessage, ChatMessageBubble, ChatMessageList, ChatSystemMessage } from '@astryxdesign/core/Chat';
import type { ConnectorDetection, ConnectorId, ConnectorModel, ConfigureConnector } from '../../shared/types';
import { initialState, transition, canActivate, pricingKnown, capCents, maskKey, mapGoal, roles, restoreDraft, serializeDraft, type State, type Step } from './machine';
import { completedSteps } from './progress';
const DRAFT = 'zaos.onboard.v1';
const goals = ['Research a topic', 'Coordinate work and briefs', 'Write marketing drafts', 'Other…'];
const connectors: {
    id: ConnectorId;
    title: string;
    subtitle: string;
    base: string;
}[] = [
    { id: 'codex', title: 'Codex', subtitle: 'Uses the Codex app already on this Mac. You sign in there, not inside KeepMind.', base: 'https://api.openai.com/v1' },
    { id: 'claude', title: 'Claude', subtitle: 'Paste an API key from the Anthropic Console.', base: 'https://api.anthropic.com/v1' },
    { id: 'openrouter', title: 'OpenRouter', subtitle: 'One key, many models', base: 'https://openrouter.ai/api/v1' },
    { id: 'deepseek', title: 'DeepSeek', subtitle: 'Paste an API key from the DeepSeek Platform.', base: 'https://api.deepseek.com' },
    { id: 'hermes', title: 'Hermes', subtitle: 'Local, no cloud key', base: 'http://127.0.0.1:8642/v1' },
    { id: 'custom', title: 'Custom (OpenAI-compatible)', subtitle: 'Base URL + API key', base: '' },
];
function Roving({ items, selected, onSelect, cards = false }: {
    items: {
        id: string;
        title: string;
        subtitle?: string;
    }[];
    selected?: string;
    onSelect: (id: string) => void;
    cards?: boolean;
}) {
    const [index, setIndex] = useState(Math.max(0, items.findIndex(i => i.id === selected)));
    const ref = useRef<HTMLDivElement>(null);
    // SelectableCard 0.7.11 owns its keyboard press layer and tabIndex. Native radio buttons
    // here permit an explicit single tab stop and all four arrows, Home/End (spec §8).
    return <div ref={ref} className={cards ? 'onboard-connectors' : 'onboard-chips'} role="radiogroup" aria-label={cards ? 'Connector' : 'Suggested answers'}>{items.map((item, i) => <button key={item.id} type="button" className="za-control" aria-label={`${item.title}${item.subtitle ? ` ${item.subtitle}` : ""}`} role="radio" aria-checked={selected === item.id} tabIndex={i === index ? 0 : -1} onFocus={() => setIndex(i)} onClick={() => onSelect(item.id)} onKeyDown={e => {
                let n = i;
                if (['ArrowRight', 'ArrowDown'].includes(e.key))
                    n = (i + 1) % items.length;
                else if (['ArrowLeft', 'ArrowUp'].includes(e.key))
                    n = (i + items.length - 1) % items.length;
                else if (e.key === 'Home')
                    n = 0;
                else if (e.key === 'End')
                    n = items.length - 1;
                else
                    return;
                e.preventDefault();
                setIndex(n);
                ref.current?.querySelectorAll('button')[n]?.focus();
            }}>{cards && <span className="provider-mark" data-provider={item.id} aria-hidden="true">{({ codex: 'Cx', claude: 'Cl', openrouter: 'OR', deepseek: 'DS', hermes: 'H', custom: '{}' } as Record<string, string>)[item.id]}</span>}<span className="provider-copy"><strong>{item.title}</strong>{item.subtitle && <span>{item.subtitle}</span>}</span>{cards && selected === item.id && <span className="provider-check" aria-hidden="true">✓</span>}</button>)}</div>;
}
export function Onboarding({ progress, onComplete }: {
    progress: number;
    onComplete: (goal: string, company: string) => void;
}) {
    const [resumed] = useState(() => !!localStorage.getItem(DRAFT));
    const [s, set] = useState<State>(() => { const d = localStorage.getItem(DRAFT); const v = d ? restoreDraft(d) : initialState; return { ...v, step: v.step === 'intro' ? 'q1' : v.step }; });
    const [key, setKey] = useState('');
    const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1100);
    useEffect(() => { const media = matchMedia('(min-width: 1100px)'); const update = () => setPanelOpen(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
    const [toggleTarget, setToggleTarget] = useState<HTMLElement | null>(null);
    useEffect(() => { setToggleTarget(document.getElementById('configuration-toggle')); }, []);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const priceFields = useRef<HTMLDivElement>(null);
    const [focusPrices, setFocusPrices] = useState(false);
    useEffect(() => {
        if (focusPrices && panelOpen && advancedOpen) {
            const input = priceFields.current?.querySelector('input');
            input?.focus();
            input?.scrollIntoView({ block: 'nearest' });
            setFocusPrices(false);
        }
    }, [focusPrices, panelOpen, advancedOpen]);
    const [show, setShow] = useState(false);
    const [other, setOther] = useState(false);
    const [error, setError] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [online, setOnline] = useState(navigator.onLine);
    const [models, setModels] = useState<ConnectorModel[]>([]);
    const [detection, setDetection] = useState<ConnectorDetection>();
    const [claudeCli, setClaudeCli] = useState(false);
    const [saved, setSaved] = useState(progress);
    const [result, setResult] = useState('');
    const composer = useRef<HTMLTextAreaElement>(null);
    const history = useRef<HTMLDivElement>(null);
    const chat = useRef<HTMLDivElement>(null);
    const controls = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const region = history.current;
        if (region)
            region.scrollTo({ top: region.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }, [s.turns, s.step]);
    const patch = (p: Partial<State>) => set(v => ({ ...v, ...p }));
    const advanced = (p: Partial<State>) => set(v => transition(v, { type: 'edit-advanced', patch: p }));
    useEffect(() => { localStorage.setItem(DRAFT, serializeDraft(s)); }, [s]);
    useEffect(() => { setSaved(v => Math.max(v, progress)); }, [progress]);
    useEffect(() => { void window.zaos.listConnectors().then(v => setClaudeCli(v.some(c => c.id === 'claude' && c.modes.includes('cli-subscription')))).catch(() => { }); const fn = () => setOnline(navigator.onLine); window.addEventListener('online', fn); window.addEventListener('offline', fn); const timer = setTimeout(() => composer.current?.focus(), 300); return () => { clearTimeout(timer); window.removeEventListener('online', fn); window.removeEventListener('offline', fn); }; }, []);
    function status(field: string) { return errors[field] ? { type: 'error' as const, message: errors[field] } : undefined; }
    function validate(field: string, valid: boolean, message: string) { setErrors(v => ({ ...v, [field]: valid ? '' : message })); return valid; }
    async function work(fn: () => Promise<void>) { patch({ busy: true }); setError(''); setResult(''); try {
        await fn();
    }
    catch {
        setError('Connection failed. Check your settings and try again.');
    }
    finally {
        patch({ busy: false });
    } }
    async function detect(id = s.connector!) { const d = await window.zaos.detectConnector(id); setDetection(d); return d; }
    async function choose(id: string) {
        const c = connectors.find(c => c.id === id)!;
        setKey('');
        setModels([]);
        setDetection(undefined);
        setResult('');
        setError('');
        const mode = id === 'codex' ? 'cli-subscription' : ['claude'].includes(id) ? 'api-key' : 'api';
        const next = { ...s, connector: c.id, mode, baseUrl: c.base, model: '', connectorOk: false, pricingSource: undefined, inputPrice: undefined, outputPrice: undefined, hasKey: false, last4: '' } as State;
        set(next);
        await work(async () => {
            if (mode === 'cli-subscription') {
                await detect(c.id);
                return;
            }
            const catalog = await window.zaos.listConnectorModels(c.id);
            setModels(catalog);
            const preferred = c.id === 'openrouter' ? catalog.find(m => m.id === 'openai/gpt-4o-mini' && m.priceKnown) : catalog[0];
            if (preferred)
                set(v => transition(v, { type: 'catalog', model: preferred.id, catalog }));
        });
    }
    async function test() {
        if (!online || s.busy)
            return;
        if (s.mode !== 'cli-subscription' && (!s.model.trim() || (s.connector !== 'hermes' && !key && saved < 2))) {
            setError('Enter a model and API key before testing.');
            return;
        }
        await work(async () => {
            const r = await window.zaos.testConnector({ connectorId: s.connector!, mode: s.mode, ...(s.baseUrl ? { baseUrl: s.baseUrl } : {}), ...(key ? { key } : {}) });
            if (!r.ok)
                throw new Error();
            setResult('Connection works.');
            set(v => transition({ ...v, connectorOk: true, hasKey: !!key, last4: key ? key.slice(-4) : '' }, { type: 'answer', step: 'q3', value: `${connectors.find(c => c.id === v.connector)?.title}${key ? ' · ' + maskKey(key) : ''}` }));
        });
    }
    function send() {
        if (s.step === 'q1') {
            if (validate('company', !!s.company.trim() && s.company.length <= 200, 'Enter a workspace name of up to 200 characters.'))
                set(v => transition(v, { type: 'answer', step: 'q1', value: v.company }));
        }
        if (s.step === 'q2' && validate('goal', s.goalDraft.trim().length >= 10, 'Enter at least 10 characters.'))
            set(v => transition(v, { type: 'answer', step: 'q2', value: v.goalDraft }));
    }
    function change(field: string, step: Step) { set(v => transition(v, { type: 'change', field, step })); setOther(field === 'First task'); }
    async function activate() {
        if (!canActivate(s) || !online)
            return;
        await work(async () => {
            let stage = saved;
            if (stage < 1) {
                await window.zaos.createCompany(s.company);
                stage = 1;
                setSaved(stage);
            }
            if (key && stage < 2) {
                await window.zaos.setProviderKey(key);
                stage = 2;
                setSaved(stage);
            }
            const config: ConfigureConnector = { pricingSource: s.pricingSource, connectorId: s.connector!, mode: s.mode, model: s.model, ...(s.baseUrl ? { baseUrl: s.baseUrl } : {}), ...(s.mode === 'cli-subscription' ? {} : { prices: { inputCentsPerMTok: s.inputPrice!, outputCentsPerMTok: s.outputPrice! } }), limits: s.mode === 'cli-subscription' ? { monthlyRunCap: s.monthlyRunCap, cliTimeoutSec: s.cliTimeoutSec } : { maxOutputTokens: s.maxOutputTokens, maxRunCents: s.maxRunCents } };
            await window.zaos.configureConnector(config);
            if (stage < 3) {
                await window.zaos.createAgentFromTemplate(s.template);
                setSaved(3);
            }
            await window.zaos.setSpendCap(capCents(s.capUsd)!);
            await window.zaos.setTelemetry(s.telemetry);
            await window.zaos.setPaidExecution(true, s.consent);
            setKey('');
            localStorage.removeItem(DRAFT);
            onComplete(s.goalDraft, s.company);
        });
    }
    const numeric = (label: string, value: number | undefined, fn: (n: number) => void, extra = {}) => <div className="onboard-field"><NumberInput label={label} size="lg" value={value} onChange={fn} {...extra}/></div>;
    const prices = (prefix = '') => <>{numeric(prefix + 'Input ¢/MTok', s.inputPrice, n => advanced({ inputPrice: n }))}{numeric(prefix + 'Output ¢/MTok', s.outputPrice, n => advanced({ outputPrice: n }))}</>;
    const cliCaps = (prefix = '') => <>{numeric(prefix + 'Monthly runs', s.monthlyRunCap, n => patch({ monthlyRunCap: n }), { min: 1, max: 1000, step: 1 })}{numeric(prefix + 'Max minutes per run', s.cliTimeoutSec / 60, n => patch({ cliTimeoutSec: Math.round(n * 60) }), { min: .5, max: 30, step: .5 })}</>;
    const rows: [
        string,
        string,
        Step
    ][] = [['Workspace', s.company || '', 'q1'], ['Agent role', s.template ? roles[s.template] : '', 'q2'], ['First task', s.goalDraft || '', 'q2'], ['Connector', s.connector ? `${connectors.find(c => c.id === s.connector)?.title}${s.last4 ? ' · ••••' + s.last4 : ''}` : '', 'q3'], ['Model', s.model || (s.mode === 'cli-subscription' ? 'App default' : ''), 'q3'], ['Monthly cap', (s.capUsd ?? 0) > 0 ? `$${s.capUsd!.toFixed(2)}` : '', 'q4'], ['Est. max / run', s.mode === 'cli-subscription' ? 'Included in your plan (run cap applies)' : (s.capUsd ?? 0) > 0 && pricingKnown(s) ? `$${(s.maxRunCents / 100).toFixed(2)} (derived)` : '', 'q4'], ['Consent', s.consent ? 'Authorized' : '', 'q4']];
    const landing = s.step === 'q1' && !s.turns.length;
    const dock = <div className="onboard-controls" ref={controls}>
 {s.turns.length > 0 && <Button className="onboard-undo" size="sm" variant="ghost" label="Undo last answer" icon={<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12h-3"/></svg>} onClick={() => set(v => transition(v, { type: 'undo' }))}/>}
 {!online && <Banner status="error" role="alert" title="You’re offline. Reconnect to test or activate."/>}{error && s.step !== 'q3' && <Banner status="error" role="alert" title={error}/>}
 {s.step === 'q2' && <Roving items={goals.map(g => ({ id: g, title: g }))} selected={other ? 'Other…' : s.goalDraft} onSelect={g => { if (g === 'Other…') {
        setOther(true);
        composer.current?.focus();
    }
    else {
        setOther(false);
        set(v => transition(v, { type: 'answer', step: 'q2', value: g }));
    } }}/>}
 {s.step === 'q3' && <><Roving items={connectors} cards selected={s.connector} onSelect={id => void choose(id)}/>{s.connector && <Card className="onboard-auth" padding={4}>
 <>{/* ADR 0001: only the installed vendor CLI owns subscription login and tokens. */}
 {s.mode === 'cli-subscription' ? <>{!detection?.installed ? <p>Install the {s.connector === 'codex' ? 'Codex app' : 'Claude Code'} first, then come back.</p> : !detection.loggedIn ? <Button size="lg" label={s.connector === 'codex' ? 'Continue in Codex' : 'Continue with Claude Code'} onClick={() => void work(() => window.zaos.startConnectorLogin(s.connector!))}/> : <p>Signed in through {s.connector === 'codex' ? 'Codex' : 'Claude Code'}</p>}<Button size="lg" label="Check again" variant="secondary" onClick={() => void work(async () => { await detect(); })}/>{cliCaps()}</> : <>
 {(s.connector === 'custom' || s.connector === 'hermes') && <TextInput size="lg" label="Base URL" type="url" value={s.baseUrl} onChange={baseUrl => patch({ baseUrl, connectorOk: false })}/>}
 {models.length ? <label>Model<select value={s.model} onChange={e => set(v => transition({ ...v, connectorOk: false }, { type: 'catalog', model: e.target.value, catalog: models }))}><option value="">Pick a listed model</option>{models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}</select></label> : <TextInput size="lg" label="Model" value={s.model} onChange={model => advanced({ model })}/>}
 {s.connector !== 'hermes' && <div className="onboard-key"><TextInput label="API key" size="lg" type={show ? 'text' : 'password'} value={key} onChange={value => { setKey(value); patch({ connectorOk: false }); }} autoComplete="off" hasAutoCorrect={false} hasSpellCheck={false} autoCapitalize="off"/><IconButton size="lg" label={show ? 'Hide' : 'Show'} icon={<span aria-hidden="true">{show ? '◉' : '◎'}</span>} variant="secondary" onClick={() => setShow(!show)}/></div>}</>}
 {s.connector === 'codex' && <button className="za-link" onClick={() => { patch({ mode: 'api-key', connectorOk: false }); }}>Use an OpenAI API key instead</button>}
 {s.connector === 'claude' && claudeCli && <button className="za-link" onClick={() => { patch({ mode: 'cli-subscription', connectorOk: false }); void work(async () => { await detect(); }); }}>Use my installed Claude Code (personal use)</button>}
 </>
 <Button size="lg" className="za-control za-primary" label={s.connector === 'hermes' ? 'Use local Hermes' : 'Test connection'} isDisabled={s.busy || !online || (s.mode === 'cli-subscription' && !detection?.loggedIn)} onClick={() => void test()}/>
 <div role="status" aria-live="polite" className="onboard-field-status">{s.busy ? <><Spinner /> Working…</> : result}</div>
 {error && <Banner status="error" role="alert" title={error}/>}
 </Card>}</>}
 {s.step === 'pricing-confirm' && <div className="pricing-controls"><div className="pricing-actions"><Button size="lg" className="za-control" variant="secondary" label="Open Advanced" onClick={() => { setPanelOpen(true); setAdvancedOpen(true); setFocusPrices(true); }}/><Button size="lg" className="za-primary" label="Continue" isDisabled={!pricingKnown(s)} aria-disabled={!pricingKnown(s)} aria-describedby={!pricingKnown(s) ? "pricing-disabled-reason" : undefined} onClick={() => set(v => transition(v, { type: 'answer', step: 'pricing-confirm' }))}/></div>{!pricingKnown(s) && <p id="pricing-disabled-reason" className="za-muted">Enter both model prices in Advanced to continue.</p>}</div>}
 {s.step === 'q4' && <div className="cap-controls">{numeric('Monthly spend cap (USD)', s.capUsd, n => patch({ capUsd: n }), { inputMode: 'decimal', autoComplete: 'off', status: status('cap'), onBlur: () => validate('cap', !!capCents(s.capUsd), 'Enter a monthly cap greater than 0.') })}<Roving items={[10, 25, 50, 100].map(n => ({ id: String(n), title: `$${n}` }))} selected={String(s.capUsd)} onSelect={n => patch({ capUsd: Number(n) })}/><CheckboxInput label="I authorize paid execution within this cap. Provider charges are mine." value={s.consent} onChange={consent => patch({ consent })} aria-describedby={errors.consent ? 'onboard-consent-error' : undefined}/><p className="onboard-field-status" id="onboard-consent-error">{errors.consent}</p><Button size="lg" className="za-primary" label="Continue" onClick={() => { const c = validate('cap', !!capCents(s.capUsd), 'Enter a monthly cap greater than 0.'); const ok = validate('consent', s.consent, 'Authorize paid execution to continue.'); if (c && ok)
        set(v => transition(v, { type: 'answer', step: 'q4', value: `$${v.capUsd!.toFixed(2)} · Authorized` })); }}/></div>}
 {(s.step === 'q1' || (s.step === 'q2' && other)) && <form onSubmit={e => { e.preventDefault(); send(); }}>
 {/* ChatComposerInput is contenteditable in 0.7.11, without organization autocomplete.
                A native labeled textarea preserves field semantics and Enter/Shift+Enter behavior. */}
 <label htmlFor="onboard-composer">{s.step === 'q1' ? 'Workspace name' : 'First task'}</label><textarea id="onboard-composer" ref={composer} rows={1} value={s.step === 'q1' ? s.company : s.goalDraft} placeholder={s.step === 'q1' ? 'e.g. Northstar Fiction' : 'e.g. Investigate a new market'} autoComplete={s.step === 'q1' ? 'organization' : 'off'} inputMode="text" aria-invalid={!!errors[s.step === 'q1' ? 'company' : 'goal']} aria-describedby="onboard-composer-error" onChange={e => { e.currentTarget.style.height = "auto"; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; patch(s.step === 'q1' ? { company: e.target.value } : { goalDraft: e.target.value }); }} onBlur={() => validate(s.step === 'q1' ? 'company' : 'goal', s.step === 'q1' ? !!s.company.trim() && s.company.length <= 200 : s.goalDraft.trim().length >= 10, s.step === 'q1' ? 'Enter a workspace name of up to 200 characters.' : 'Enter at least 10 characters.')} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        } }}/><span className="composer-hint">Enter to send · Shift+Enter for new line</span><p className="onboard-field-status" id="onboard-composer-error">{errors[s.step === 'q1' ? 'company' : 'goal']}</p><IconButton className="za-primary" size="lg" type="submit" label="Send" icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>}/></form>}
 </div>;
    return <section className="onboarding-screen" aria-label="Agent onboarding">
 {toggleTarget && createPortal(<IconButton size="lg" variant="ghost" tooltip={panelOpen ? 'Hide configuration' : 'Show configuration'} label={panelOpen ? 'Hide configuration' : 'Show configuration'} aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)} icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></svg>}/>, toggleTarget)}
 <div className={`za-onboard ${panelOpen ? 'panel-open' : 'panel-closed'}`} aria-busy={s.busy}>
 <div className={`onboard-chat ${landing ? 'is-landing' : ''}`} ref={chat}>
 {landing ? <div className="onboard-landing"><BrandMark className="landing-mark" /><Text color="secondary">Your workspace, your direction</Text><Heading level={2}>Let’s set up your agent</Heading><Text color="secondary">Hi. I’ll set up your local agent in four steps. You stay in control of spend and review.</Text><Text>What should we call this workspace?</Text>{dock}</div> : <ChatLayout className="setup-layout" density="spacious" scrollButton={null} composer={dock}>
 <ChatMessageList align="top" gap={6} className="onboard-history" ref={history} role="log" aria-label="Setup conversation" tabIndex={0}><ChatSystemMessage className="onboard-system">Hi. I’ll set up your local agent in four steps. You stay in control of spend and review.</ChatSystemMessage>{resumed && <ChatSystemMessage className="onboard-system">Welcome back. Pick up where you left off.</ChatSystemMessage>}{s.turns.filter(t => t.text || t.editing).map((t, i) => t.editing ? <ChatSystemMessage key={i} className="onboard-editing"><span>Editing {t.editing}.</span></ChatSystemMessage> : <div className="onboard-turn" key={i}><ChatMessage className="onboard-assistant" sender="assistant" avatar={<BrandMark className="transcript-mark" />}><ChatMessageBubble variant="ghost" className="onboard-bubble">{t.step === 'q1' ? 'What should we call this workspace?' : t.step === 'q2' ? 'What should your first agent do first? Pick one. I\'ll choose the matching role.' : t.step === 'q3' ? 'How should the agent reach a model?' : 'Set a hard monthly spend cap in USD. Paid runs stop when you hit it.'}</ChatMessageBubble></ChatMessage><ChatMessage className="onboard-user" sender="user"><ChatMessageBubble variant="ghost" className="onboard-bubble">{t.text}</ChatMessageBubble></ChatMessage>{t.step === 'q2' && <ChatMessage className="onboard-assistant" sender="assistant" avatar={<BrandMark className="transcript-mark" />}><ChatMessageBubble variant="ghost" className="onboard-bubble">Got it. I’ll use the {roles[mapGoal(t.text)]} template.</ChatMessageBubble></ChatMessage>}{t.connection && <ChatMessage className="onboard-assistant" sender="assistant" avatar={<BrandMark className="transcript-mark" />}><ChatMessageBubble variant="ghost" className="onboard-bubble">{t.connection.startsWith('I don’t have catalog prices') ? 'I need the price for this model. Open Advanced to add it.' : t.connection}</ChatMessageBubble></ChatMessage>}</div>)}
 {s.step !== 'pricing-confirm' && <ChatMessage className="onboard-assistant" sender="assistant" avatar={<BrandMark className="transcript-mark" />}><ChatMessageBubble variant="ghost" className="onboard-bubble">{s.step === 'q1' ? 'What should we call this workspace?' : s.step === 'q2' ? 'What should your first agent do first? Pick one. I\'ll choose the matching role.' : s.step === 'q3' ? 'How should the agent reach a model?' : s.step === 'q4' ? 'Set a hard monthly spend cap in USD. Paid runs stop when you hit it.' : 'Review your settings, then activate your agent.'}</ChatMessageBubble></ChatMessage>}
        </ChatMessageList>
 </ChatLayout>}
 </div>
 {panelOpen && <aside className="onboard-panel"><div className="panel-scroll"><Heading level={3}>What I’ll configure</Heading><p className="za-muted">{completedSteps(s)} of 4 steps complete</p><ProgressBar label="Setup progress" isLabelHidden max={4} value={completedSteps(s)}/>{!rows.some(([, value]) => value !== "") && <p className="za-muted">Your workspace takes shape here as we go.</p>}<MetadataList label={{ position: "top" }}>{rows.filter(([, value]) => value !== "").map(([label, value, step]) => <MetadataListItem key={label} label={label}><span className="configuration-value">{value}</span><button className="za-link" aria-label={`Change ${label}`} onClick={() => change(label, step)}>Change</button></MetadataListItem>)}</MetadataList>{s.defaultRole && <p>Role · Researcher (default. Change in Advanced)</p>}{!pricingKnown(s) && s.connector && <dl><div><dt>Pricing</dt><dd>To confirm</dd></div></dl>}{s.mode === 'cli-subscription' && <p>Monthly runs · {s.monthlyRunCap}<br />Max minutes per run · {s.cliTimeoutSec / 60}</p>}
 <Collapsible trigger="Advanced" isOpen={advancedOpen} onOpenChange={setAdvancedOpen}>{advancedOpen && <div className="onboard-advanced"><label>Advanced · Agent role<select value={s.template} onChange={e => patch({ template: e.target.value, defaultRole: false })}><option value="">Choose a role</option>{Object.entries(roles).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><TextInput label="Advanced · Model" size="lg" value={s.model} onChange={model => advanced({ model })}/>{s.mode === 'cli-subscription' ? cliCaps('Advanced · ') : <><div ref={priceFields}>{prices('Advanced · ')}</div>{numeric('Max output tokens', s.maxOutputTokens, n => advanced({ maxOutputTokens: n }))}{numeric('Max ¢/run', s.maxRunCents, n => advanced({ maxRunCents: n }))}<TextInput label="Advanced · Base URL" size="lg" type="url" value={s.baseUrl} onChange={baseUrl => patch({ baseUrl, connectorOk: false })}/></>}<CheckboxInput label="Telemetry (v0.1 sends nothing)" value={s.telemetry} onChange={telemetry => patch({ telemetry })}/></div>}</Collapsible>
 </div><div className="panel-footer"><Button size="lg" label="Activate agent" className="za-control za-primary" isDisabled={!canActivate(s) || !online} aria-disabled={!canActivate(s) || !online} aria-describedby={!canActivate(s) || !online ? "onboard-disabled-reason" : undefined} onClick={() => void activate()}/>{(!canActivate(s) || !online) && <p id="onboard-disabled-reason" className="za-muted">Finish the four steps and confirm pricing.</p>}<PoweredBy />
 </div></aside>}
 </div></section>;
}
