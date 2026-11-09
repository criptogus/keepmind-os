import { describe, it, expect } from 'vitest';
import { initialState as initial, transition as t, mapGoal, maskKey, capCents, pricingKnown, canActivate, serializeDraft, restoreDraft } from '../../src/renderer/onboarding/machine';
const ready = { ...initial, step: 'summary' as const, company: 'Acme', template: 'researcher', connector: 'custom' as const, connectorOk: true, pricingSource: 'user' as const, inputPrice: 15, outputPrice: 60, capUsd: 25, consent: true };
describe('local onboarding machine', () => {
 it('keeps an unset cap empty through draft persistence', () => {
  expect(initial.capUsd).toBeUndefined();
  expect(capCents(undefined)).toBeUndefined();
  expect(restoreDraft(serializeDraft(initial)).capUsd).toBeUndefined();
  expect(restoreDraft('{}').capUsd).toBeUndefined();
  expect(restoreDraft('{"capUsd":null}').capUsd).toBeUndefined();
  expect(restoreDraft(serializeDraft(ready)).capUsd).toBe(25);
  expect(restoreDraft('{"capUsd":0}').capUsd).toBe(0);
 });
 it('walks four steps and derives limits without any network', () => {
  let s = t(initial, { type: 'answer', step: 'intro' }); expect(s.step).toBe('q1');
  s = t(s, { type: 'answer', step: 'q1', value: 'Acme' }); expect(s.step).toBe('q2');
  s = t(s, { type: 'answer', step: 'q2', value: 'Research a topic' }); expect(s.template).toBe('researcher'); expect(s.step).toBe('q3');
  s = t(s, { type: 'catalog', model: 'listed', catalog: [{ id: 'listed', name: 'Listed', priceKnown: true, inputCentsPerMTok: 30, outputCentsPerMTok: 120, maxOutputTokens: 8192 }] }); expect(s.maxOutputTokens).toBe(2048);
  s = t(s, { type: 'answer', step: 'q3', patch: { connectorOk: true } }); expect(s.step).toBe('q4'); expect(s.capUsd).toBeUndefined();
  s = t(s, { type: 'answer', step: 'q4', patch: { capUsd: 25, consent: true } }); expect(s.step).toBe('summary'); expect(s.maxRunCents).toBe(125); expect(canActivate(s)).toBe(true);
 });
 it.each([['investigate competitors','researcher'],['research plan','researcher'],['coordinate','chief-of-staff'],['brief','chief-of-staff'],['plan','chief-of-staff'],['writing','marketing-writer'],['marketing','marketing-writer'],['copy','marketing-writer'],['something else','researcher']])('maps %s to %s', (goal, role) => expect(mapGoal(goal)).toBe(role));
 it('marks fallback role and supports undo and prefilled change', () => {
  const s = t(ready, { type: 'answer', step: 'q2', value: 'Something else entirely' }); expect(s.defaultRole).toBe(true);
  const changed = t(s, { type: 'change', step: 'q1', field: 'Workspace' }); expect(changed.company).toBe('Acme'); expect(changed.step).toBe('q1');
  const undone = t(s, { type: 'undo' }); expect(undone.turns.slice(0, -1)).toEqual(s.turns); expect(undone.turns.at(-1)?.editing).toBe('First task'); expect(undone.goalDraft).toBe(s.goalDraft);
  const answered = t(changed, { type: 'answer', step: 'q1', value: 'Updated' }); expect(answered.turns.some(turn => turn.editing === 'Workspace')).toBe(true);
 });
 it('unknown catalog model blocks activation until human prices', () => {
  let s = t(ready, { type: 'catalog', model: 'absent', catalog: [] }); expect(pricingKnown(s)).toBe(false); expect(canActivate(s)).toBe(false); expect(s.maxOutputTokens).toBe(2048);
  s = t(s, { type: 'answer', step: 'q3' }); expect(s.step).toBe('pricing-confirm');
  s = t(s, { type: 'edit-advanced', patch: { inputPrice: 2, outputPrice: 4 } }); expect(s.pricingSource).toBe('user'); expect(canActivate(s)).toBe(true);
  expect(t(s, { type: 'catalog', model: 'small', catalog: [{ id: 'small', name: '', priceKnown: true, maxOutputTokens: 512 }] }).maxOutputTokens).toBe(512);
 });
 it('validates spend, consent, busy and CLI caps', () => {
  expect(canActivate(ready)).toBe(true);
  for (const capUsd of [undefined,0,-1,NaN,Infinity,1000.01]) expect(canActivate({ ...ready, capUsd })).toBe(false);
  expect(canActivate({ ...ready, consent: false })).toBe(false); expect(canActivate({ ...ready, busy: true })).toBe(false);
  for (const v of [.01,25,1000]) expect(Number.isInteger(capCents(v))).toBe(true);
  expect(capCents(.001)).toBeUndefined(); expect(capCents(1001)).toBeUndefined(); expect(capCents(12.345)).toBe(1235);
  expect(t(ready, { type: 'answer', step: 'q4', patch: { capUsd: .01 } }).maxRunCents).toBe(1);
  const cli = { ...ready, mode: 'cli-subscription' as const, pricingSource: undefined, inputPrice: undefined, outputPrice: undefined };
  expect(canActivate(cli)).toBe(true); for (const monthlyRunCap of [0,1001,1.2]) expect(canActivate({ ...cli, monthlyRunCap })).toBe(false);
  for (const cliTimeoutSec of [29,1801,30.5]) expect(canActivate({ ...cli, cliTimeoutSec })).toBe(false);
 });
 it('serializes only safe fields and never the API key', () => {
  const secret = 'test-key-not-real-7f2a';
  const json = serializeDraft({ ...ready, hasKey: true, last4: secret.slice(-4), key: secret } as typeof ready);
  expect(json).not.toContain(secret); expect(json).not.toContain('test-key'); expect(JSON.parse(json).key).toBeUndefined(); expect(maskKey(secret)).toBe('••••7f2a');
  expect(restoreDraft(json).hasKey).toBe(true); expect(restoreDraft(json).connectorOk).toBe(false); expect(restoreDraft('invalid')).toEqual(initial);
 });
});
