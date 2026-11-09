import type { ConnectorId, ConnectorModel, ConfigureConnector } from '../../shared/types';
export type Step = 'intro' | 'q1' | 'q2' | 'q3' | 'pricing-confirm' | 'q4' | 'summary';
export const roles: Record<string, string> = { researcher: 'Researcher', 'chief-of-staff': 'Chief of Staff', 'marketing-writer': 'Marketing Writer' };
export interface State {
 step: Step; company: string; goalDraft: string; template: string; defaultRole: boolean; connector?: ConnectorId; mode: ConfigureConnector['mode']; model: string; baseUrl: string; connectorOk: boolean; pricingSource?: 'catalog' | 'user'; inputPrice?: number; outputPrice?: number; maxOutputTokens: number; maxRunCents: number; capUsd: number; consent: boolean; telemetry: boolean; monthlyRunCap: number; cliTimeoutSec: number; hasKey: boolean; last4: string; busy: boolean; turns: { step: Step; text: string; editing?: string; connection?: string }[]; editing?: string;
}
export const initialState: State = { step: 'intro', company: '', goalDraft: '', template: '', defaultRole: false, mode: 'api', model: '', baseUrl: '', connectorOk: false, maxOutputTokens: 2048, maxRunCents: 1, capUsd: 0, consent: false, telemetry: false, monthlyRunCap: 30, cliTimeoutSec: 300, hasKey: false, last4: '', busy: false, turns: [] };
export function mapGoal(goal: string) { return /research|investigate/i.test(goal) ? 'researcher' : /coord|brief|plan/i.test(goal) ? 'chief-of-staff' : /writ|market|copy/i.test(goal) ? 'marketing-writer' : 'researcher'; }
export const maskKey = (key: string) => '••••' + key.slice(-4);
export function capCents(capUsd: number) { const cents = Math.round(capUsd * 100); return Number.isSafeInteger(cents) && cents >= 1 && cents <= 100000 ? cents : undefined; }
export const pricingKnown = (s: State) => s.mode === 'cli-subscription' ? Number.isInteger(s.monthlyRunCap) && s.monthlyRunCap >= 1 && s.monthlyRunCap <= 1000 && Number.isInteger(s.cliTimeoutSec) && s.cliTimeoutSec >= 30 && s.cliTimeoutSec <= 1800 : !!s.pricingSource && [s.inputPrice, s.outputPrice].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0);
export const canActivate = (s: State) => !!(s.company.trim() && s.template && s.connectorOk && pricingKnown(s) && capCents(s.capUsd) && s.capUsd > 0 && s.consent && !s.busy);
export type Action = { type: 'answer'; step: Step; value?: string; patch?: Partial<State> } | { type: 'undo' } | { type: 'change'; step: Step; field: string } | { type: 'edit-advanced'; patch: Partial<State> } | { type: 'catalog'; model: string; catalog: ConnectorModel[] };
export function transition(s: State, a: Action): State {
 if (a.type === 'change') return { ...s, step: a.step, editing: a.field, turns: [...s.turns, { step: a.step, text: '', editing: a.field }] };
 if (a.type === 'edit-advanced') return { ...s, ...a.patch, ...(('inputPrice' in a.patch || 'outputPrice' in a.patch) ? { pricingSource: 'user' as const } : {}), ...('model' in a.patch ? { pricingSource: undefined, inputPrice: undefined, outputPrice: undefined, connectorOk: false } : {}) };
 if (a.type === 'catalog') { const m = a.catalog.find(m => m.id === a.model && m.priceKnown); return { ...s, model: a.model, pricingSource: m ? 'catalog' : undefined, inputPrice: m?.inputCentsPerMTok, outputPrice: m?.outputCentsPerMTok, maxOutputTokens: Math.min(m?.maxOutputTokens ?? 2048, 2048) }; }
 if (a.type === 'undo') {
  const turn = [...s.turns].reverse().find(t => !t.editing && t.step !== 'intro' && (!s.editing || t.step < s.step));
  if (!turn) return s;
  const field = turn.step === 'q1' ? 'Workspace' : turn.step === 'q2' ? 'First task' : turn.step === 'q3' ? 'Connector' : 'Monthly cap';
  return transition(s, { type: 'change', step: turn.step, field });
 }
 const next = { ...s, ...a.patch, editing: undefined, turns: [...s.turns, { step: a.step, text: a.value ?? '', ...(a.step === 'q3' ? { connection: s.mode === 'cli-subscription' ? 'Connected through your CLI subscription.' : s.pricingSource === 'catalog' ? `Connected. I’ll use ${s.model} with catalog prices. You can change this under Advanced before activating.` : `I don’t have catalog prices for ${s.model || 'this model'}. Enter input and output price in cents per million tokens, or pick a listed model.` } : {}) }] };
 if (a.step === 'intro') return { ...next, step: 'q1' };
 if (a.step === 'q1') return { ...next, company: (a.value ?? '').trim(), step: 'q2' };
 if (a.step === 'q2') return { ...next, goalDraft: a.value ?? '', template: mapGoal(a.value ?? ''), defaultRole: !/research|investigate|coord|brief|plan|writ|market|copy/i.test(a.value ?? ''), step: 'q3' };
 if (a.step === 'q3') return { ...next, step: pricingKnown(next) ? 'q4' : 'pricing-confirm' };
 if (a.step === 'pricing-confirm') return { ...next, step: 'q4' };
 return { ...next, step: 'summary', maxRunCents: Math.max(1, Math.round(next.capUsd * 100 * .05)) };
}
// Explicit allowlist: credentials can never enter the serialized draft, even via extra runtime properties.
export function serializeDraft(s: State) { return JSON.stringify(Object.fromEntries(Object.keys(initialState).map(k => [k, s[k as keyof State]]))); }
export function restoreDraft(json: string): State { try { const raw = JSON.parse(json); const safe = JSON.parse(serializeDraft({ ...initialState, ...raw })); return { ...initialState, ...safe, busy: false, connectorOk: false }; } catch { return { ...initialState }; } }
