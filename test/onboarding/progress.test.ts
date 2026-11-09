import { expect, it } from 'vitest';
import { initialState, type State } from '../../src/renderer/onboarding/machine';
import { completedSteps } from '../../src/renderer/onboarding/progress';

it('counts completed questions once, with tested pricing and valid cap consent', () => {
    const s: State = { ...initialState, step: 'summary', company: 'Acme', goalDraft: 'Research a topic', template: 'researcher', connectorOk: true, pricingSource: 'user', inputPrice: 20, outputPrice: 40, capUsd: 25, consent: true, turns: ['q1', 'q2', 'q3', 'q4', 'q3'].map(step => ({ step: step as State['step'], text: 'answer' })) };
    expect(completedSteps(initialState)).toBe(0);
    expect(completedSteps(s)).toBe(4);
    expect(completedSteps({ ...s, step: 'pricing-confirm' })).toBe(3);
    expect(completedSteps({ ...s, step: 'pricing-confirm', inputPrice: undefined, consent: false })).toBe(2);
    expect(completedSteps({ ...s, connectorOk: false })).toBe(3);
    expect(completedSteps({ ...s, outputPrice: undefined })).toBe(3);
    for (const capUsd of [undefined, 0, -1, NaN]) expect(completedSteps({ ...s, capUsd })).toBe(3);
    expect(completedSteps({ ...s, consent: false })).toBe(3);
});
