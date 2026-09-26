// Plucked strings: a digital waveguide (extended Karplus-Strong) fitted to recorded notes.
//
// - The pluck is a shape, not a noise burst: a string plucked at `beta` of its length from the bridge pushes
//   on the bridge with a pulse `beta` of a period wide (partials fall as sin(k pi beta) / k), rounded by the
//   finger or pick (a low-pass that opens with velocity and with the pitch of the string).
// - The loss filter is a one-pole low-pass designed per note from two decay times measured on real strings,
//   the fundamental's and 4 kHz's: low partials ring for seconds, the top dies in a fraction of one, so the
//   note darkens as it decays instead of fading evenly.
// - Two polarizations: a second loop, a few cents apart and decaying faster, takes part of the pluck. The sum
//   beats and decays in two stages, as a real string does.
// - The body (acoustic guitar, harp) and the pickup (electric) are linear, so they are commuted into the
//   excitation: they shape the first 120 ms of input to the loops rather than every output sample, which
//   keeps a voice about as cheap as a bare loop.
// - The fretting hand: a hammered-on or pulled-off note is not picked, so it has no pick attack and a darker
//   start; a slide glides the loop's length from the fret it starts on; a squeak is the hand's skin brushing
//   along a wound string as it shifts, a short band of noise sweeping up.
// The overdriven guitar is summed dry on the amp bus, so a chord distorts as a whole the way it does through a
// real amp.

import type { Ev, StringKind } from '../types.ts';
import type { Bus } from './bus.ts';
import { smooth, SVF } from './dsp.ts';

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;

interface Model {
  /** Pluck position range, as a fraction of the string from the bridge. */
  beta: readonly [number, number];
  /**
   * Corner of the pluck's two-pole low-pass at 200 Hz and velocity 0.7, Hz. It rises with the note as
   * (f / 200)^excTilt (higher strings carry faster waves) and by 4 octaves per unit of velocity.
   */
  exc: number;
  excTilt: number;
  /** T60 of the fundamental at 200 Hz, s, scaled by (200 / f)^tilt; and T60 at 4 kHz, s. */
  t1: number;
  tilt: number;
  t4k: number;
  /** Second polarization: share of the pluck, detune in cents, T60s relative to the first. */
  pol: readonly [number, number, number];
  /** Body: a high-pass under the air resonance [Hz, Q], and resonant modes [Hz, Q, peak gain] added to it. */
  body?: { hp: readonly [number, number]; modes: readonly (readonly [number, number, number])[] };
  /** Pickup: distance from the bridge as a fraction of the string, and its electrical resonance [Hz, Q]. */
  pickup?: { at: number; res: readonly [number, number] };
  /** Attack transient (the finger or pick, and the body's knock): length s, low-pass Hz, level. */
  knock?: readonly [number, number, number];
  /** Output gain: a note as loud (BS.1770) as the previous model's at the same velocity. */
  gain: number;
  /** Longest render, s; the last quarter fades out. */
  maxLen: number;
}

const ELECTRIC: Model = {
  beta: [0.15, 0.25],
  exc: 4000,
  excTilt: 0.3,
  t1: 11,
  tilt: 0.3,
  t4k: 2.7,
  pol: [0.3, 0.8, 0.5],
  pickup: { at: 0.09, res: [2600, 1.5] },
  gain: 0.84,
  maxLen: 5,
};

const MODELS: Record<StringKind, Model> = {
  // steel-string acoustic (a Martin HD-28): partial T60 ~13 s at 90 Hz down to ~1.2 s at 5.6 kHz
  guitar: {
    beta: [0.12, 0.2],
    exc: 6500,
    excTilt: 0.4,
    t1: 7,
    tilt: 0.35,
    t4k: 1.4,
    pol: [0.4, 3.5, 0.3],
    body: { hp: [110, 0.9], modes: [[115, 6, 0.6], [200, 5, 1.2], [410, 4, 0.8], [2600, 0.8, 0.6]] },
    knock: [0.012, 3000, 1.2],
    gain: 0.79,
    maxLen: 5,
  },
  // concert harp, plucked near the middle with the pad of the finger: even partials weak, a dark attack
  harp: {
    beta: [0.4, 0.48],
    exc: 1800,
    excTilt: 0.8,
    t1: 10,
    tilt: 0.2,
    t4k: 0.4,
    pol: [0.45, 4, 0.7],
    body: { hp: [150, 0.8], modes: [[450, 1.5, 0.4]] },
    knock: [0.02, 1200, 2],
    gain: 0.99,
    maxLen: 6,
  },
  // a Fender on its bridge pickup: long even sustain, flat up to the pickup's resonance
  electric: ELECTRIC,
  // the same guitar into the amp bus (its level sets how hard it drives the amp)
  overdrive: { ...ELECTRIC, gain: 1 },
};

/** A squeak at level 1 against a note at velocity 0.8: about 15 dB under it. */
const SQUEAK = 0.14;

/** One polarization: a delay line with a one-pole loss filter and an allpass for the fraction of a sample. */
class Loop {
  private readonly buf: Float32Array;
  private readonly N: number;
  readonly g: number;
  readonly c: number;
  private readonly C: number;
  readonly mute: number;
  private idx = 0;
  private lp = 0;
  private apx = 0;
  private apy = 0;

  /** f: frequency; t0, t4k: T60 at f and at 4 kHz, s. */
  constructor(sr: number, f: number, t0: number, t4k: number) {
    // one-pole y = (1 - c) x + c y[-1], times g, through the per-period gains wanted at f and at fh
    const w0 = (2 * Math.PI * f) / sr;
    const fh = Math.max(4000, 2 * f);
    const wh = (2 * Math.PI * fh) / sr;
    const G0 = 10 ** (-3 / (t0 * f));
    const Gh = 10 ** (-3 / (Math.min(t0, (t4k * 4000) / fh) * f));
    const r2 = (Gh / G0) ** 2;
    const A = r2 - 1;
    const B = 2 * (Math.cos(w0) - r2 * Math.cos(wh));
    // A c^2 + B c + A = 0: the roots are reciprocal, take the one inside the unit circle
    const c = A < 0 ? Math.min(0.95, Math.max(0, (-B + Math.sqrt(Math.max(0, B * B - 4 * A * A))) / (2 * A))) : 0;
    this.c = c;
    // the loop's gain peaks at DC, where it must stay under 1
    this.g = Math.min(0.9999, (G0 * Math.sqrt(1 - 2 * c * Math.cos(w0) + c * c)) / (1 - c));
    // the loss filter delays the loop by its phase delay at f; the delay line and the allpass make up the rest
    const period = sr / f - Math.atan2(c * Math.sin(w0), 1 - c * Math.cos(w0)) / w0;
    this.N = Math.max(2, Math.floor(period - 0.1));
    // first-order allpass with a phase delay of exactly `frac` samples at f (not only near DC)
    const frac = period - this.N;
    this.C = Math.sin(((1 - frac) * w0) / 2) / Math.sin(((1 + frac) * w0) / 2);
    this.mute = 10 ** (-3 / (0.12 * f)); // a hand on the string after note-off
    this.buf = new Float32Array(this.N);
  }

  tick(input: number, held: boolean, _t = 0): number {
    const x = this.buf[this.idx] + input;
    this.lp = (1 - this.c) * x + this.c * this.lp;
    const ap = this.C * this.lp + this.apx - this.C * this.apy;
    this.apx = this.lp;
    this.apy = ap;
    this.buf[this.idx] = ap * (held ? this.g : this.g * this.mute);
    this.idx = this.idx + 1 < this.N ? this.idx + 1 : 0;
    return x;
  }
}

/**
 * A loop whose length can change while it rings (a slide): a delay line read at a fractional position through
 * a third-order Lagrange interpolator, with the same loss filter as Loop. The interpolator darkens the note a
 * little, as a sliding finger does.
 */
class GlideLoop {
  private readonly buf: Float32Array;
  private readonly g: number;
  private readonly c: number;
  private readonly mute: number;
  private readonly lpDelay: number;
  private w = 0;
  private lp = 0;

  /** Rings at f; `bend(t)` is the pitch as a ratio to f at t seconds (1 once the slide is over). */
  constructor(
    private readonly sr: number,
    private readonly f: number,
    t0: number,
    t4k: number,
    private readonly bend: (t: number) => number,
    lowest: number,
  ) {
    const ref = new Loop(sr, f, t0, t4k);
    this.c = ref.c;
    this.g = ref.g;
    this.mute = ref.mute;
    const w0 = (2 * Math.PI * f) / sr;
    this.lpDelay = Math.atan2(this.c * Math.sin(w0), 1 - this.c * Math.cos(w0)) / w0;
    this.buf = new Float32Array(Math.ceil(sr / (f * lowest)) + 8);
  }

  tick(input: number, held: boolean, t: number): number {
    const L = this.buf.length;
    const D = Math.max(3, this.sr / (this.f * this.bend(t)) - this.lpDelay);
    const r = this.w - D;
    const i = Math.floor(r);
    const a = r - i;
    const at = (k: number) => this.buf[((i + k) % L + L) % L];
    // Lagrange weights for points i-1, i, i+1, i+2 at fraction a
    const y = -a * (a - 1) * (a - 2) / 6 * at(-1) + (a + 1) * (a - 1) * (a - 2) / 2 * at(0) -
      (a + 1) * a * (a - 2) / 2 * at(1) + (a + 1) * a * (a - 1) / 6 * at(2);
    const x = y + input;
    this.lp = (1 - this.c) * x + this.c * this.lp;
    this.buf[this.w] = this.lp * (held ? this.g : this.g * this.mute);
    this.w = this.w + 1 < L ? this.w + 1 : 0;
    return x;
  }
}

/** Circular two-pole low-pass of one period: a first lap warms each stage up, so the period has no seam. */
function roundOff(x: Float32Array, fc: number, sr: number): void {
  const a = 1 - Math.exp((-2 * Math.PI * Math.min(fc, 0.45 * sr)) / sr);
  for (let stage = 0; stage < 2; stage++) {
    let y = 0;
    for (let lap = 0; lap < 2; lap++) {
      for (let i = 0; i < x.length; i++) {
        y += a * (x[i] - y);
        if (lap) x[i] = y;
      }
    }
  }
}

/** Runs the body filter (a high-pass plus resonant modes in parallel) over x in place. */
function radiate(x: Float32Array, body: NonNullable<Model['body']>, sr: number): void {
  const hp = new SVF(sr, body.hp[0], body.hp[1]);
  const modes = body.modes.map(([fr, q, gain]) => ({ f: new SVF(sr, fr, q), k: gain / q }));
  for (let i = 0; i < x.length; i++) {
    hp.run(x[i]);
    let y = hp.hp;
    for (const md of modes) {
      md.f.run(hp.hp);
      y += md.k * md.f.bp;
    }
    x[i] = y;
  }
}

/**
 * The first 120 ms of a note, before the loops: `pluck` is their input, one period of the pluck's force on the
 * bridge shaped by the pickup or the body (linear filters, so shaping the input equals shaping the output:
 * commuted synthesis); `knock` is heard directly, the finger or pick and the body it sets ringing.
 */
function excitation(b: Bus, e: E<'string'>, m: Model, f: number): { pluck: Float32Array; knock: Float32Array } {
  const sr = b.sr;
  const N = Math.max(2, Math.round(sr / f));
  const beta = m.beta[0] + (m.beta[1] - m.beta[0]) * b.noise.unit();
  const w = Math.max(1, Math.round(beta * N));
  const shape = new Float32Array(N);
  for (let i = 0; i < N; i++) shape[i] = (i < w ? 1 - w / N : -w / N) + 0.04 * b.noise.next();
  // a hammer-on or pull-off sets the string going without a pick: a softer, rounder push
  roundOff(shape, m.exc * (f / 200) ** m.excTilt * 2 ** (4 * (e.v - 0.7)) * (e.slur ? 0.3 : 1), sr);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += shape[i];
  mean /= N;
  let rms = 0;
  for (let i = 0; i < N; i++) rms += (shape[i] -= mean) ** 2;
  const norm = 0.25 / (Math.sqrt(rms / N) || 1);

  // a body rings for a while; a pickup only adds its comb's delay and a short resonance
  const pd = m.pickup ? Math.max(1, Math.round((m.pickup.at * sr) / f)) : 0;
  const L = m.body ? Math.max(N + 1, Math.round(0.12 * sr)) : N + pd + Math.round(0.005 * sr);
  const pluck = new Float32Array(L);
  for (let i = 0; i < N; i++) pluck[i] = shape[i] * norm;
  if (m.pickup) {
    // the pickup senses the difference of the string's motion across its distance from the bridge (a comb),
    // then its coil and the cable resonate
    for (let i = L - 1; i >= pd; i--) pluck[i] -= pluck[i - pd];
    const res = new SVF(sr, m.pickup.res[0], m.pickup.res[1]);
    for (let i = 0; i < L; i++) pluck[i] = res.run(pluck[i]);
  }
  const knock = new Float32Array(m.knock && !e.slur ? L : 0);
  if (m.knock && !e.slur) {
    const [sec, fc, level] = m.knock;
    const kl = Math.min(L, Math.round(sec * sr));
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    let y = 0;
    for (let i = 0; i < kl; i++) {
      y += a * (b.noise.next() - y);
      knock[i] = level * e.v * (1 - i / kl) ** 2 * y;
    }
  }
  if (m.body) {
    radiate(pluck, m.body, sr);
    radiate(knock, m.body, sr);
    // the body's ring, cut at 120 ms, fades out over the last 10
    const fade = Math.round(0.01 * sr);
    for (let i = 0; i < fade; i++) {
      pluck[L - 1 - i] *= i / fade;
      if (knock.length) knock[L - 1 - i] *= i / fade;
    }
  }
  return { pluck, knock };
}

export function string(b: Bus, e: E<'string'>): void {
  const sr = b.sr;
  const f = b.hz(e.n);
  const m = MODELS[e.k];
  if (sr / f < 4) return;
  const t0 = m.t1 * (200 / f) ** m.tilt;
  const d = e.d ?? Infinity;
  const len = Math.min(t0 * 0.85, m.maxLen, d + 0.4);
  // the second polarization's beats and two-stage decay take seconds to show: short notes skip it
  const [share, cents, ratio] = len > 1 ? m.pol : [0, 0, 1];
  // detuned about f, so the pitch the two average to is f
  const fa = f * 2 ** ((-share * cents) / 1200);
  const fb = f * 2 ** (((1 - share) * cents) / 1200);
  // a slide: from `slide` semitones away onto the note, fast in the middle, settling at the fret
  const slide = e.slide ?? 0;
  const glide = 0.04 + 0.03 * Math.abs(slide);
  const bend = (t: number) => (t >= glide ? 1 : 2 ** ((slide / 12) * (1 - smooth(t / glide))));
  const lowest = 2 ** (Math.min(0, slide) / 12);
  const A = slide ? new GlideLoop(sr, fa, t0, m.t4k, bend, lowest) : new Loop(sr, fa, t0, m.t4k);
  const B = !share
    ? null
    : slide
    ? new GlideLoop(sr, fb, ratio * t0, ratio * m.t4k, bend, lowest)
    : new Loop(sr, fb, ratio * t0, ratio * m.t4k);
  const { pluck, knock } = excitation(b, e, m, f);
  const fade = 0.25 * len;
  const tick = (j: number, t: number): number => {
    const x = j < pluck.length ? pluck[j] : 0;
    const held = t < d;
    let y = A.tick((1 - share) * x, held, t) + (j < knock.length ? knock[j] : 0);
    if (B) y += B.tick(share * x, held, t);
    return t > len - fade ? (y * (len - t)) / fade : y;
  };
  const p = e.p ?? Math.max(-0.5, Math.min(0.5, (e.n - 62) / 28));
  if (e.squeak) squeak(b, e.t, e.squeak, p);
  if (e.k === 'overdrive') {
    // dry into the amp bus; the amp in the master adds drive, cabinet and room
    const i0 = Math.round(e.t * sr);
    const n = Math.min(b.n - i0, Math.round(len * sr));
    for (let j = 0; j < n; j++) b.AMP[i0 + j] += tick(j, j / sr) * e.v * m.gain * Math.min(1, (n - j) / (0.01 * sr));
    b.ampUsed = true;
    return;
  }
  const g = e.v * m.gain;
  b.voice(
    e.t,
    len,
    (j, t) => tick(j, t) * g,
    p,
    e.k === 'harp' ? 0.4 : 0.22,
    e.k === 'harp' ? 0.15 : e.k === 'electric' ? 0.3 : 0.12,
    0.3,
  );
}

/**
 * The fretting hand squeaking along a wound string as it shifts, just before the note it shifts to: noise
 * through a narrow band that sweeps up with the hand's speed across the windings.
 */
function squeak(b: Bus, t: number, level: number, p: number): void {
  const sr = b.sr;
  const dur = 0.08 + 0.08 * b.noise.unit();
  const f0 = 900 + 700 * b.noise.unit();
  const f1 = f0 * (1.8 + b.noise.unit());
  const bp = new SVF(sr, f0, 5);
  b.voice(
    Math.max(0, t - dur - 0.01),
    dur,
    (j, u) => {
      const x = u / dur;
      if ((j & 15) === 0) bp.set(f0 * (f1 / f0) ** x);
      bp.run(b.noise.next());
      return bp.bp * Math.sin(Math.PI * x) ** 2 * level * SQUEAK;
    },
    p,
    0.22,
    0.12,
    0.3,
  );
}
