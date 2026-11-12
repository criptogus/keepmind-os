/**
 * Synthesized UI sounds — ported concept from agentes.chat's sfx/synth:
 * oscillators + envelopes computed at runtime, no audio files, no service.
 * Three event sounds in the monochrome spirit: a soft tick for routine
 * events, a brighter chime for approvals, a low thud for errors.
 * Everything is off unless the user enables it in Settings.
 */

let ctx: AudioContext | null = null;
let enabled = false;

export function setSfxEnabled(on: boolean): void {
  enabled = on;
  if (on) void ensureCtx();
}

export function isSfxEnabled(): boolean {
  return enabled;
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

/** approval requested — two rising notes, noticeable but polite */
export function sfxAttention() {
  if (!enabled) return;
  const ac = ensureCtx();
  if (!ac) return;
  tone(ac, { freq: 660, dur: 0.09, gain: 0.035, type: 'triangle' });
  tone(ac, { freq: 880, at: 0.09, dur: 0.14, gain: 0.035, type: 'triangle' });
}

/** approval decided / execution done — soft major third resolve */
export function sfxDone() {
  if (!enabled) return;
  const ac = ensureCtx();
  if (!ac) return;
  tone(ac, { freq: 523.25, dur: 0.1, gain: 0.03, type: 'sine' });
  tone(ac, { freq: 659.25, at: 0.08, dur: 0.16, gain: 0.03, type: 'sine' });
}

/** error / rejection — low descending thud */
export function sfxError() {
  if (!enabled) return;
  const ac = ensureCtx();
  if (!ac) return;
  tone(ac, { freq: 220, dur: 0.18, gain: 0.045, type: 'sawtooth', slide: 140 });
}

/** generic send/click tick */
export function sfxTick() {
  if (!enabled) return;
  const ac = ensureCtx();
  if (!ac) return;
  tone(ac, { freq: 1200, dur: 0.03, gain: 0.015, type: 'square' });
}
