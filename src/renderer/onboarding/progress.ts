import { capCents, pricingKnown, type State } from './machine';

export function completedSteps(s: State): number {
    const answered = (step: State['step']) => s.turns.some(t => t.step === step && !!t.text && !t.editing);
    return Number(answered('q1') && !!s.company.trim())
        + Number(answered('q2') && !!s.template && s.goalDraft.trim().length >= 10)
        + Number(answered('q3') && s.connectorOk && pricingKnown(s) && s.step !== 'pricing-confirm')
        + Number(answered('q4') && !!capCents(s.capUsd) && s.consent);
}
