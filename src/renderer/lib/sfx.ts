/**
 * Synthesized UI sounds — concept from agentes.chat's sfx/synth:
 * oscillators + envelopes computed at runtime, no audio files, no service.
 * Events are individually toggleable (Settings → Interface sounds).
 * Everything is off unless the user enables the master switch.
 */

export type SfxEvent = 'attention' | 'done' | 'error' | 'start';

const EVENTS: readonly SfxEvent[] = ['attention', 'done', 'error', 'start'];

let ctx: AudioContext | null = null;
let master = false;
const enabledEvents = new Set<SfxEvent>(EVENTS);

export function setSfxEnabled(on: boolean): void {
  master = on;
  if (on) void ensureCtx();
}

export function isSfxEnabled(): boolean {
  return master;
}

/** Per-event toggles; unknown events are ignored, missing ones stay enabled. */
export function setSfxEvent(event: string, on: boolean): void {
  if (!EVENTS.includes(event as SfxEvent)) return;
  if (on) enabledEvents.add(event as SfxEvent);
  else enabledEvents.delete(event as SfxEvent);
}

export function isSfxEventEnabled(event: SfxEvent): boolean {
  return enabledEvents.has(event);
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneOpts {
  freq: number;
  at?: number; // seconds offset
  dur?: number;
  gain?: number;
  type?: OscillatorType;
  slide?: number; // end frequency
}

function tone(ac: AudioContext, { freq, at = 0, dur = 0.12, gain = 0.04, type = 'sine', slide }: ToneOpts) {
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function play(event: SfxEvent, notes: ToneOpts[]) {
  if (!master || !enabledEvents.has(event)) return;
  const ac = ensureCtx();
  if (!ac) return;
  for (const n of notes) tone(ac, n);
}

/** approval requested — two rising notes, noticeable but polite */
export function sfxAttention() {
  play('attention', [
    { freq: 660, dur: 0.09, gain: 0.035, type: 'triangle' },
    { freq: 880, at: 0.09, dur: 0.14, gain: 0.035, type: 'triangle' },
  ]);
}

/** approval decided / execution done — soft major third resolve */
export function sfxDone() {
  play('done', [
    { freq: 523.25, dur: 0.1, gain: 0.03, type: 'sine' },
    { freq: 659.25, at: 0.08, dur: 0.16, gain: 0.03, type: 'sine' },
  ]);
}

/** error / rejection — low descending thud */
export function sfxError() {
  play('error', [
    { freq: 220, dur: 0.18, gain: 0.045, type: 'sawtooth', slide: 140 },
  ]);
}

/** execution started — short rising blip */
export function sfxStart() {
  play('start', [
    { freq: 440, dur: 0.05, gain: 0.025, type: 'triangle' },
    { freq: 587.33, at: 0.05, dur: 0.07, gain: 0.025, type: 'triangle' },
  ]);
}

/** generic send/click tick */
export function sfxTick() {
  play('done', [{ freq: 1200, dur: 0.03, gain: 0.015, type: 'square' }]);
}
