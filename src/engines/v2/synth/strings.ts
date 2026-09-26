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
// - The body (acoustic guitar, harp), the pickup (electric) and a clean amp's tone and speaker are linear, so they
//   are commuted into the excitation: they shape the first few tens of ms of input to the loops rather than every
//   output sample, which keeps a voice about as cheap as a bare loop.
// - The fretting hand: a hammered-on or pulled-off note is not picked, so it has no pick attack and a darker
//   start; a slide glides the loop's length from the fret it starts on; a squeak is the hand's skin brushing
//   along a wound string as it shifts, a short band of noise sweeping up. A held note of a line gets a finger
//   vibrato (the loop's length rocking a few cents after the attack), and a jump to another string a scuff of the
//   fingertips; an electric's pick scrapes the string as it goes through.
// - Feedback: a held note into a loud amp locks onto one of its harmonics, which swells in over a second or two.
// - The bass guitar (bassGuitar) is the same waveguide made stiff: a loop whose partials stretch sharp and whose mids
//   die sooner, a string that buzzes on the frets when dug in, and a DI blended with a driven amp.
// The overdriven guitar is summed dry on the amp bus, so a chord distorts as a whole the way it does through a
// real amp.

import type { Ev, StringKind } from '../types.ts';
import type { Bus } from './bus.ts';
import { hash32 } from '../rng.ts';
import { Chain, Chorus, Noise, Oversampled, type Section, smooth, softClip, SVF } from './dsp.ts';

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
  /**
   * The amp and speaker a clean guitar plays through, as filter sections: a clean amp is linear enough to commute into
   * the excitation with the pickup, so its tone costs nothing per sample.
   */
  amp?: readonly Section[];
  /** A light stereo chorus after the amp: base delay ms, sway ms, rate Hz, mix (see Chorus). */
  chorus?: readonly [number, number, number, number];
  /** Octaves the pluck's corner rises per unit of velocity (4 unless set). */
  excVel?: number;
  /** The pick scraping the string as it goes through: the burst's level against the pluck's rms (see SCRAPE). */
  scrape?: number;
  /** Depth of the fretting finger's vibrato on a held note, cents (the sine's amplitude; 0: none). */
  vib?: number;
  /** Output gain: a note as loud (BS.1770) as the previous model's at the same velocity. */
  gain: number;
  /** Longest render, s; the last quarter fades out. */
  maxLen: number;
}

/**
 * The pick's scrape on an electric's plain strings against the pluck's rms (a wound string's windings three times it):
 * measured, the first 43 ms of real DI notes carry 8 to 15 dB more energy between the partials from 0.5 to 4 kHz.
 */
const SCRAPE = 3;
/** An electric player's vibrato on a held note, cents: a sine of this amplitude, before the note's own variations. */
const VIB = 22;

const ELECTRIC: Model = {
  beta: [0.15, 0.25],
  exc: 4000,
  excTilt: 0.3,
  t1: 11,
  tilt: 0.3,
  t4k: 2.7,
  pol: [0.3, 0.8, 0.5],
  pickup: { at: 0.09, res: [2600, 1.5] },
  scrape: SCRAPE,
  vib: VIB,
  gain: 0.84,
  maxLen: 5,
};

/**
 * A clean Fender amp into a 2x12. The speaker: a Jensen, fitted to a close-miked capture (jesterdyne's "Jensen Cab
 * e606", Freesound, CC BY 4.0) to 1.1 dB rms from 60 Hz to 8 kHz: the low resonance, a presence peak and notch above
 * 2 kHz, and the fall from 5 kHz. The rest fitted (1.1 dB rms, 400 Hz to 6.3 kHz, where the notes played don't decide
 * the spectrum) to the clean openings of the references (Explosions in the Sky, April Rain, Mono): the tone stack's
 * mid scoop at 750 Hz and the treble up (the Fender voicing), and the mic off the cone's axis, which loses the cone's
 * presence peak near 4.6 kHz. And the bass down, as the references have it under their reverb: the speaker's low
 * resonance left in, the guitar was 10 dB heavier at 125 Hz than they are.
 */
const FENDER_CLEAN: readonly Section[] = [
  ['peak', 140, 0.9, -8],
  ['peak', 735, 0.88, -12],
  ['peak', 2640, 1.15, 5],
  ['peak', 4490, 3, -11.7],
  ['hp', 99, 1.21],
  ['lp', 3448, 1.77],
  ['lp', 13366, 1.5],
  ['peak', 154, 0.7, 6.6],
  ['peak', 2172, 5.35, 2.3],
  ['peak', 3076, 3.24, -8],
  ['peak', 4690, 3.3, 8],
];

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
    vib: 0.6 * VIB,
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
  // post-rock's clean guitar: a Jazzmaster or Telecaster on its middle position (brighter than the neck: the
  // references are flat to 3 kHz), picked with a pick at any strength, with the sustain of a compressor, into a clean
  // Fender amp and its 2x12 (FENDER_CLEAN) and a light chorus; its delays and reverb are its sends (see string())
  clean: {
    ...ELECTRIC,
    beta: [0.18, 0.28],
    exc: 3200,
    excVel: 2,
    t1: 14,
    t4k: 2.2,
    pickup: { at: 0.2, res: [3800, 1.4] },
    amp: FENDER_CLEAN,
    chorus: [7, 0.5, 0.7, 0.35],
    gain: 1.42,
  },
  // the same guitar into the amp bus (its level sets how hard it drives the amp)
  overdrive: { ...ELECTRIC, gain: 1 },
};

/** Notes under G3 are on a wound string (E, A, D): its windings scrape and squeak more. */
const WOUND = 55;

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
function excitation(
  b: Bus,
  e: E<'string'>,
  m: Model,
  f: number,
  rnd: Noise,
): { pluck: Float32Array; knock: Float32Array } {
  const sr = b.sr;
  const N = Math.max(2, Math.round(sr / f));
  const beta = m.beta[0] + (m.beta[1] - m.beta[0]) * b.noise.unit();
  const w = Math.max(1, Math.round(beta * N));
  const shape = new Float32Array(N);
  for (let i = 0; i < N; i++) shape[i] = (i < w ? 1 - w / N : -w / N) + 0.04 * b.noise.next();
  // a hammer-on or pull-off sets the string going without a pick: a softer, rounder push
  roundOff(shape, m.exc * (f / 200) ** m.excTilt * 2 ** ((m.excVel ?? 4) * (e.v - 0.7)) * (e.slur ? 0.3 : 1), sr);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += shape[i];
  mean /= N;
  let rms = 0;
  for (let i = 0; i < N; i++) rms += (shape[i] -= mean) ** 2;
  const norm = 0.25 / (Math.sqrt(rms / N) || 1);

  // a body rings for a while; a pickup only adds its comb's delay and a short resonance; an amp's speaker, 40 ms
  const pd = m.pickup ? Math.max(1, Math.round((m.pickup.at * sr) / f)) : 0;
  const L = m.body
    ? Math.max(N + 1, Math.round(0.12 * sr))
    : N + pd + Math.round(0.005 * sr) + (m.amp ? Math.round(0.04 * sr) : 0);
  const pluck = new Float32Array(L);
  for (let i = 0; i < N; i++) pluck[i] = shape[i] * norm;
  if (m.pickup) {
    // the pickup senses the difference of the string's motion across its distance from the bridge (a comb),
    // then its coil and the cable resonate
    for (let i = L - 1; i >= pd; i--) pluck[i] -= pluck[i - pd];
    const res = new SVF(sr, m.pickup.res[0], m.pickup.res[1]);
    for (let i = 0; i < L; i++) pluck[i] = res.run(pluck[i]);
  }
  if (m.amp) {
    const amp = new Chain(sr, m.amp);
    for (let i = 0; i < L; i++) pluck[i] = amp.run(pluck[i]);
  }
  const struck = !e.slur && !e.swell;
  const knock = new Float32Array((m.knock || m.scrape) && struck ? L : 0);
  if (m.knock && struck) {
    const [sec, fc, level] = m.knock;
    const kl = Math.min(L, Math.round(sec * sr));
    const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    let y = 0;
    for (let i = 0; i < kl; i++) {
      y += a * (b.noise.next() - y);
      knock[i] = level * e.v * (1 - i / kl) ** 2 * y;
    }
  }
  if (m.scrape && struck) {
    // the pick drags across the string for a few ms before it lets go: noise the pickup and amp hear as the string's
    const kl = Math.min(L, Math.round((0.004 + 0.006 * rnd.unit()) * sr));
    const level = 0.25 * m.scrape * (e.n < WOUND ? 3 : 1) * e.v ** 1.5;
    const bp = new SVF(sr, 1000 + 1500 * rnd.unit(), 0.6);
    const res = m.pickup ? new SVF(sr, m.pickup.res[0], m.pickup.res[1]) : null;
    const amp = m.amp ? new Chain(sr, m.amp) : null;
    for (let i = 0; i < L; i++) {
      bp.run(i < kl ? rnd.next() * Math.sin((Math.PI * i) / kl) * level : 0);
      let y = res ? res.run(bp.bp) : bp.bp;
      if (amp) y = amp.run(y);
      knock[i] += y;
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
  // the player's touch varies note to note: seeded by the note itself, so it never shifts what plays after it
  const rnd = new Noise(hash32(Math.round(e.t * 1e4), e.n, Math.round(e.v * 1e3), e.k.length, 0x5717));
  // the second polarization's beats and two-stage decay take seconds to show: short notes skip it
  const [share, cents, ratio] = len > 1 ? m.pol : [0, 0, 1];
  // detuned about f, so the pitch the two average to is f
  const fa = f * 2 ** ((-share * cents) / 1200);
  const fb = f * 2 ** (((1 - share) * cents) / 1200);
  // a slide: from `slide` semitones away onto the note, fast in the middle, settling at the fret
  const slide = e.slide ?? 0;
  const glide = 0.04 + 0.03 * Math.abs(slide);
  const vib = vibrato(e, d, m, rnd);
  let lastT = -1;
  let lastBend = 1;
  const bend = vib
    ? (t: number) => {
      // both polarizations ask for the same t: work it out once
      if (t !== lastT) {
        lastT = t;
        lastBend = (t >= glide ? 1 : 2 ** ((slide / 12) * (1 - smooth(t / glide)))) * vib.at(t);
      }
      return lastBend;
    }
    : (t: number) => (t >= glide ? 1 : 2 ** ((slide / 12) * (1 - smooth(t / glide))));
  const lowest = 2 ** (Math.min(0, slide) / 12) * (vib ? vib.lowest : 1);
  const bent = slide || vib;
  const A = bent ? new GlideLoop(sr, fa, t0, m.t4k, bend, lowest) : new Loop(sr, fa, t0, m.t4k);
  const B = !share
    ? null
    : bent
    ? new GlideLoop(sr, fb, ratio * t0, ratio * m.t4k, bend, lowest)
    : new Loop(sr, fb, ratio * t0, ratio * m.t4k);
  const { pluck, knock } = excitation(b, e, m, f, rnd);
  const fade = 0.25 * len;
  // a swell: the volume pedal comes up after the pick, so no attack is heard at all
  const swell = e.swell ?? 0;
  const tick = (j: number, t: number): number => {
    const x = j < pluck.length ? pluck[j] : 0;
    const held = t < d;
    let y = A.tick((1 - share) * x, held, t) + (j < knock.length ? knock[j] : 0);
    if (B) y += B.tick(share * x, held, t);
    if (swell && t < swell) y *= smooth(t / swell);
    return t > len - fade ? (y * (len - t)) / fade : y;
  };
  const p = e.p ?? Math.max(-0.5, Math.min(0.5, (e.n - 62) / 28));
  if (e.squeak) squeak(b, e.t, e.squeak, p);
  const into = e.k === 'overdrive' ? ((e.p ?? 0) > 0 ? b.AMP2 : b.AMP) : null;
  fingers(b, e, rnd, p, into);
  if (into) {
    // dry into an amp; the amps in the master add drive, cabinet and room. A guitar placed right plays through the
    // second amp: two guitarists, double-tracked (see render's amp)
    const i0 = Math.round(e.t * sr);
    const n = Math.min(b.n - i0, Math.round(len * sr));
    const bloom = feedback(e, into, f, Math.min(d, len), rnd);
    for (let j = 0; j < n; j++) {
      const t = j / sr;
      into[i0 + j] += (tick(j, t) + (bloom ? bloom(t) : 0)) * e.v * m.gain * Math.min(1, (n - j) / (0.01 * sr));
    }
    if (into === b.AMP2) b.amp2Used = true;
    else b.ampUsed = true;
    return;
  }
  const g = e.v * m.gain;
  // the clean post-rock guitar lives in its delays and a big room
  const [rv, dl] = { harp: [0.4, 0.15], electric: [0.22, 0.3], clean: [0.5, 0.55] }[e.k as string] ?? [0.22, 0.12];
  if (m.chorus) {
    const ch = new Chorus(sr, e.t, ...m.chorus);
    b.stereo(e.t, len, (j, t) => ch.run(tick(j, t) * g), () => ch.side, p, rv, dl, 0.3);
  } else b.voice(e.t, len, (j, t) => tick(j, t) * g, p, rv, dl, 0.3);
}

/** Notes held this long (s) in a line get the fretting finger's vibrato unless the note says otherwise. */
const VIB_HELD = 0.35;

/**
 * The fretting finger's vibrato on a held note: rocking the string along the fret after the attack, as players do on
 * a note they sing. It comes in 0.12 to 0.27 s after the pick, over a quarter to half a second, and keeps widening a
 * little as the note is held (by a quarter over the next two seconds); each note has its own rate (4.5 to 5.9 Hz,
 * wandering 4% around it) and width (0.75 to 1.25 of the player's, wider on longer and harder notes). Ten clear
 * vibratos on recorded clean leads: 5.0 Hz (4.4 to 5.3), 23 cents (15 to 30). A line's held notes get it unless `vib`
 * is 0; a chord's or an arpeggio's only when `vib` asks for it; a note with no `d` never (it rings on, the hand gone).
 * Returns the pitch as a ratio at t seconds, and the lowest it goes.
 */
function vibrato(
  e: E<'string'>,
  d: number,
  m: Model,
  rnd: Noise,
): { at: (t: number) => number; lowest: number } | null {
  const scale = e.vib ?? (e.lead !== undefined && !e.swell && d >= VIB_HELD ? 1 : 0);
  if (!scale || !m.vib || !Number.isFinite(d)) return null;
  const width = m.vib * scale * (0.75 + 0.5 * rnd.unit()) * (0.8 + 0.4 * Math.min(1, e.v)) *
    (0.7 + 0.3 * Math.min(1, Math.max(0, d - VIB_HELD) / 1.5));
  const rate = 4.5 + 1.4 * rnd.unit();
  const delay = 0.12 + 0.15 * rnd.unit();
  const rise = 0.25 + 0.2 * rnd.unit();
  const wob = 2 * Math.PI * rnd.unit();
  // the rate wanders 4% at 0.7 Hz: its phase, integrated in closed form so any t can be asked for
  const k = (0.04 * rate) / 0.7;
  const top = 1.25 * width;
  return {
    at: (t) => {
      if (t <= delay) return 1;
      const u = t - delay;
      const depth = width * smooth(u / rise) * (1 + 0.25 * Math.min(1, u / 2));
      const ph = 2 * Math.PI * rate * u - k * (Math.cos(2 * Math.PI * 0.7 * u + wob) - Math.cos(wob));
      return 2 ** ((depth * Math.sin(ph)) / 1200);
    },
    lowest: 2 ** (-top / 1200),
  };
}

/** What each part last played on a bus (by kind, line and side): the hand needs to know when it changes strings. */
const LAST = new WeakMap<Bus, Map<string, { n: number; end: number }>>();
/** Fingers leaving a string and landing on another, at level 1: about 35 dB under a note at velocity 0.8. */
const FINGER = 0.012;

/**
 * The fretting hand leaving one string for another between two notes of a line: the fingertips lift off and land and
 * brush the strings on the way, a short scuff of noise just before the note (a wound string's windings louder). Only
 * where the line jumps a fourth or more (another string) soon after the note before; a shift along one string is
 * `squeak`'s, and a slurred note isn't fingered anew. An overdriven guitar's goes through its amp.
 */
function fingers(b: Bus, e: E<'string'>, rnd: Noise, p: number, into: Float32Array | null): void {
  if (e.k === 'harp' || e.lead === undefined) return;
  let parts = LAST.get(b);
  if (!parts) LAST.set(b, parts = new Map());
  const key = `${e.k}:${e.lead}:${Math.sign(e.p ?? 0)}`;
  const last = parts.get(key);
  parts.set(key, { n: e.n, end: e.t + (e.d ?? 0.3) });
  if (!last || e.slur || e.squeak || Math.abs(e.n - last.n) < 5 || e.t - last.end > 1 || e.t < last.end - 0.5) return;
  const sr = b.sr;
  const dur = 0.015 + 0.025 * rnd.unit();
  const t = Math.max(0, e.t - dur - 0.005);
  const level = FINGER * (Math.min(e.n, last.n) < WOUND ? 1.6 : 1) * (0.6 + 0.4 * rnd.unit());
  const bp = new SVF(sr, 1200 + 1500 * rnd.unit(), 1.2);
  const scuff = (u: number) => {
    bp.run(rnd.next());
    return bp.bp * Math.sin((Math.PI * u) / dur) ** 2 * level;
  };
  if (!into) return b.voice(t, dur, (_j, u) => scuff(u), p, 0.22, 0.12, 0.3);
  const i0 = Math.round(t * sr);
  const g = e.v * MODELS.overdrive.gain;
  for (let j = 0; j < Math.round(dur * sr) && i0 + j < b.n; j++) into[i0 + j] += scuff(j / sr) * g;
}

/** Which amp is feeding back until when: one note per guitarist at a time. */
const BLOOM = new WeakMap<Float32Array, number>();
/** Notes held this long (s) may feed back unless they say otherwise; */
const FB_HELD = 2;
/** and this many of them do. */
const FB_CHANCE = 0.6;
/**
 * Feedback at full swell against the pluck (whose rms is 0.25). Small: the Muff's gain is so high that a harmonic this
 * far under the chord already rises 30 to 50 dB in the wall's output and sings over the chord (measured).
 */
const FEEDBACK = 0.05;
/** The lowest a harmonic that feeds back sits, Hz (a loud amp and a guitar couple from about here up to 900 Hz). */
const FB_LOW = 320;

/**
 * Feedback on a held, overdriven note: the amp is loud enough that the string, driven by its own sound, locks onto one
 * of its harmonics, which swells in over one to two seconds (starting 0.4 to 0.8 s after the pick) and sings on until
 * the note stops. It is the string's own harmonic (the lowest of the 2nd to 4th between FB_LOW and 900 Hz, where a
 * loud amp and a guitar couple), so it is added to the string's signal before the amp and the amp drives it; its
 * pitch sways a few cents. One note per amp at a time: by default the first long note (FB_HELD) that finds its amp
 * free, six times in ten (`feedback` sets its level: 0 none, 1 the usual, 2 it takes the note over).
 */
function feedback(
  e: E<'string'>,
  into: Float32Array,
  f: number,
  hold: number,
  rnd: Noise,
): ((t: number) => number) | null {
  const free = (BLOOM.get(into) ?? -1) <= e.t + 1e-3;
  const chance = rnd.unit();
  const level = e.feedback ?? (free && hold >= FB_HELD && chance < FB_CHANCE ? 1 : 0);
  if (!level || hold < 0.8) return null;
  BLOOM.set(into, e.t + hold);
  const ks = [2, 3, 4].filter((k) => k * f >= FB_LOW && k * f <= 900);
  const k = ks.length ? ks[0] : Math.max(2, Math.round(600 / f));
  const w = 2 * Math.PI * k * f;
  const on = 0.4 + 0.4 * rnd.unit();
  const rise = 1 + rnd.unit();
  const sway = 2 * Math.PI * rnd.unit();
  // a sway of 4 cents at 0.5 Hz, as phase: 4 / 1200 ln 2 of the frequency over 2 pi 0.5
  const dev = (0.0023 * k * f) / 0.5;
  const amp = FEEDBACK * level;
  return (t) => {
    if (t < on || t > hold + 0.06) return 0;
    // it grows as feedback does, slowly at first, then levels off
    const x = smooth((t - on) / rise);
    const off = t > hold ? 1 - (t - hold) / 0.06 : 1;
    return amp * x * x * off * Math.sin(w * t + dev * Math.sin(Math.PI * t + sway));
  };
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

// ------------------------------------------------------------------ bass guitar

/**
 * A bass guitar, fitted to recorded basses (see out/research/proposals/sound-bass.md): how its strings ring, where
 * they are plucked and picked up, how hard a note must be dug in before it buzzes on the frets, and the amp.
 */
export interface BassModel {
  /** Pluck position range, as a fraction of the string from the bridge. */
  beta: readonly [number, number];
  /**
   * Corner of the pluck's two-pole low-pass at E1 and velocity 0.7, Hz: rising (f / E1)^excTilt with the note and
   * excVel octaves per unit of velocity (a pick's edge is sharp, a finger's pad wide).
   */
  exc: number;
  excTilt: number;
  excVel: number;
  /** T60 of the partials under a few hundred Hz, s (a bass string's whole low end rings about as long). */
  t0: number;
  /** A shelf centred at [0] Hz that alone would ring the partials above it for [1] s: the mids die sooner. */
  mids: readonly [number, number];
  /** The top's own decay, growing as f^2: the T60 it alone gives at 4 kHz, s. */
  t4k: number;
  /** Stiffness B of the open E and of the E an octave up: partial k rings at k f sqrt(1 + B k^2). */
  stiff: readonly [number, number];
  /** Second polarization: share of the pluck, detune in cents, T60s relative to the first (two-stage decay). */
  pol: readonly [number, number, number];
  /** Pickup: distance from the bridge as a fraction of the string, and its coil and cable resonance [Hz, Q]. */
  pickup: { at: number; res: readonly [number, number] };
  /** From this velocity up the string's first swings reach the frets and buzz. */
  buzz: number;
  /** The pick's click against the note (0: fingers). */
  click: number;
  /**
   * The amp: its drive (the gain into its soft clip; the note's level decides how far it clips: a note dug in is
   * grittier, a soft one nearly clean), the tone before and after the drive, and the DI's share of the blend.
   */
  drive: number;
  pre: readonly Section[];
  cab: readonly Section[];
  di: number;
  /** Output gain: a note as loud (BS.1770) as the synth `saw` bass at the same velocity. */
  gain: number;
}

const E1 = 41.2;

/**
 * An Ampeg-style head driven into an 8x10, as a picked rock bass is played: the mids pushed around 1.2 kHz before the
 * drive (the grit and growl), then the bass knob up, the Ultra Lo voicing's scoop at 500 Hz, and the cabinet: the
 * ten-inch cones' presence near 2 kHz and their fall from 4 kHz (no tweeter).
 */
const SVT_PRE: readonly Section[] = [['hp', 50, 0.7], ['peak', 1200, 0.5, 9]];
/** Fingered, the head is set cleaner: a little push at 800 Hz, and not driven much. */
const SVT_CLEAN: readonly Section[] = [['hp', 40, 0.7], ['peak', 800, 0.7, 3]];
const SVT_8X10: readonly Section[] = [
  ['hp', 45, 0.8],
  ['peak', 80, 0.7, 6],
  ['peak', 500, 0.8, -9],
  ['peak', 2000, 1.2, 5],
  ['lp', 3800, 0.9],
  ['lp', 4800, 0.7],
];

export const BASSES: Readonly<Record<'pick' | 'finger', BassModel>> = {
  // a Precision with roundwounds played with a pick near its pickup, into the head and a DI
  pick: {
    beta: [0.16, 0.24],
    exc: 900,
    excTilt: 0.3,
    excVel: 2,
    t0: 20,
    mids: [900, 3],
    t4k: 1,
    stiff: [1e-4, 1.6e-4],
    pol: [0.35, 0.8, 0.25],
    pickup: { at: 0.19, res: [3200, 1.3] },
    buzz: 0.62,
    click: 1,
    drive: 6,
    pre: SVT_PRE,
    cab: SVT_8X10,
    di: 0.45,
    gain: 0.98,
  },
  // the same bass fingered further up the string: rounder, and the amp barely driven
  finger: {
    beta: [0.25, 0.33],
    exc: 650,
    excTilt: 0.4,
    excVel: 2.5,
    t0: 20,
    mids: [1300, 2.8],
    t4k: 4,
    stiff: [1e-4, 1.6e-4],
    pol: [0.35, 0.8, 0.25],
    pickup: { at: 0.2, res: [2800, 1.1] },
    buzz: 0.8,
    click: 0,
    drive: 2,
    pre: SVT_CLEAN,
    cab: SVT_8X10,
    di: 0.5,
    gain: 0.81,
  },
};

/** First-order allpasses in a bass string's loop that stretch its partials. */
const DISPERSION = 4;
/** Partials up to here are stretched as measured; above it they stretch less than a real string's. */
const STRETCH_FIT_HZ = 1200;

/** Phase delay (samples) at w of the first-order allpass (a + z^-1) / (1 + a z^-1). */
const allpassDelay = (a: number, w: number) => 1 - (2 * Math.atan((a * Math.sin(w)) / (1 + a * Math.cos(w)))) / w;

/**
 * The coefficient of DISPERSION identical first-order allpasses whose delay falls with frequency as a stiff string's
 * loop must for its partials to ring at k f sqrt(1 + B k^2) (normalized so the fundamental stays at f): the least
 * squares fit of the partials' pitch up to STRETCH_FIT_HZ, weighted to the lower ones, by golden section.
 */
function stretch(sr: number, f: number, B: number): number {
  const ks: number[] = [];
  for (let k = 2; k * f * Math.sqrt((1 + B * k * k) / (1 + B)) < STRETCH_FIT_HZ; k++) ks.push(k);
  if (B <= 0 || !ks.length) return 0;
  const w1 = (2 * Math.PI * f) / sr;
  const err = (a: number) => {
    let e = 0;
    const d1 = allpassDelay(a, w1);
    for (const k of ks) {
      const fk = k * f * Math.sqrt((1 + B * k * k) / (1 + B));
      // the loop's delay at partial k must be k periods of it; relative error of that delay, weighted 1/k
      const want = (k * sr) / fk - sr / f;
      const got = DISPERSION * (allpassDelay(a, (2 * Math.PI * fk) / sr) - d1);
      e += ((got - want) * fk) ** 2 / (k * k * k * sr * sr);
    }
    return e;
  };
  let lo = -0.99;
  let hi = 0;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (err(a) < err(b)) hi = b;
    else lo = a;
  }
  return (lo + hi) / 2;
}

/**
 * A wound bass string's loop: the delay line; a loss filter shaped as measured on bass strings, whose decay rate grows
 * about as f^0.8 from a few hundred Hz up (a first-order shelf takes the mids down, a one-pole the top: a one-pole
 * alone rings the mids twice as long as a real string); DISPERSION allpasses that stretch the partials as a stiff
 * string does; an allpass for the fraction of a sample. `fret` is how far the string may swing before it meets the
 * frets: past it the swing is pushed back most of the way (a one-sided soft limit inside the loop), so a note dug in
 * buzzes and loses its first loudness fast, as a real one does.
 */
class StiffLoop {
  private readonly buf: Float64Array;
  private readonly N: number;
  private readonly b0: number;
  private readonly b1: number;
  private readonly a1: number;
  private readonly c: number;
  private readonly g: number;
  private readonly C: number;
  private readonly a: number;
  private readonly mute: number;
  private readonly dx = new Float64Array(DISPERSION);
  private readonly dy = new Float64Array(DISPERSION);
  private idx = 0;
  private sx = 0;
  private sy = 0;
  private lp = 0;
  private apx = 0;
  private apy = 0;
  fret = Infinity;
  /** How far past the frets the last sample swung (0 if it didn't reach them). */
  hit = 0;

  /** f: frequency; B: stiffness; `ratio` scales the model's T60s; `rel`: T60 once the hand mutes the string, s. */
  constructor(sr: number, f: number, m: BassModel, B: number, ratio: number, rel: number) {
    const w0 = (2 * Math.PI * f) / sr;
    const loss = (t60: number) => 60 / (ratio * t60 * f);
    // shelf: DC gain 1, high-frequency gain -S dB, centred at mids[0] (bilinear, warped there)
    const r = 10 ** (loss(m.mids[1]) / 40);
    const k = 1 / Math.tan((Math.PI * Math.min(m.mids[0], 0.45 * sr)) / sr);
    this.b0 = (1 + k / r) / (1 + k * r);
    this.b1 = (1 - k / r) / (1 + k * r);
    this.a1 = (1 - k * r) / (1 + k * r);
    // one-pole: exactly the top's loss at 4 kHz, 1 + 2u(1 - cos w) = 10^(L / 10) with u = c / (1 - c)^2
    const w4 = (2 * Math.PI * Math.min(4000, 0.45 * sr)) / sr;
    const u = (10 ** (loss(m.t4k) / 10) - 1) / (2 * (1 - Math.cos(w4)));
    this.c = u > 0 ? (2 * u + 1 - Math.sqrt(4 * u + 1)) / (2 * u) : 0;
    const c = this.c;
    // the filters' own loss at f, taken out of the gain that sets the fundamental's T60
    const re = this.b0 + this.b1 * Math.cos(w0);
    const im = -this.b1 * Math.sin(w0);
    const dr = 1 + this.a1 * Math.cos(w0);
    const di = -this.a1 * Math.sin(w0);
    const shelf = Math.hypot(re, im) / Math.hypot(dr, di);
    const pole = (1 - c) / Math.sqrt(1 - 2 * c * Math.cos(w0) + c * c);
    this.g = Math.min(0.99999, 10 ** (-loss(m.t0) / 20) / (shelf * pole));
    this.a = stretch(sr, f, B);
    // the loop's delay at f: the filters' phase delays, then the delay line and the fractional allpass
    const phase = Math.atan2(im, re) - Math.atan2(di, dr) - Math.atan2(c * Math.sin(w0), 1 - c * Math.cos(w0));
    const period = sr / f + phase / w0 - DISPERSION * allpassDelay(this.a, w0);
    this.N = Math.max(2, Math.floor(period - 0.1));
    const frac = period - this.N;
    this.C = Math.sin(((1 - frac) * w0) / 2) / Math.sin(((1 + frac) * w0) / 2);
    this.mute = 10 ** (-3 / (Math.max(0.01, rel) * f));
    this.buf = new Float64Array(this.N);
  }

  tick(input: number, held: boolean): number {
    const x = this.buf[this.idx] + input;
    const s = this.b0 * x + this.b1 * this.sx - this.a1 * this.sy;
    this.sx = x;
    this.sy = s;
    this.lp = (1 - this.c) * s + this.c * this.lp;
    let y = this.lp;
    const a = this.a;
    for (let k = 0; k < DISPERSION; k++) {
      const z = a * y + this.dx[k] - a * this.dy[k];
      this.dx[k] = y;
      this.dy[k] = z;
      y = z;
    }
    const ap = this.C * y + this.apx - this.C * this.apy;
    this.apx = y;
    this.apy = ap;
    let v = ap * (held ? this.g : this.g * this.mute);
    this.hit = 0;
    if (v < -this.fret) {
      this.hit = -this.fret - v;
      v = -this.fret + FRET_GIVE * (v + this.fret);
    }
    this.buf[this.idx] = v;
    this.idx = this.idx + 1 < this.N ? this.idx + 1 : 0;
    return x;
  }
}

/** Samples an Oversampled lags its input. */
const OS_LAG = 7;

/** How much of a swing past the frets survives the hit: most (the string bounces), so a hard note buzzes for 100 ms. */
const FRET_GIVE = 0.88;
/** The rattle of a string on the frets against how far past them it swings. */
const RATTLE = 1.2;

/** The notes a bass guitar plays: a single pluck into its string, then the DI and the amp, blended. */
export function bassGuitar(b: Bus, e: E<'bass'> & { k: 'pick' | 'finger' }): void {
  const sr = b.sr;
  const m = BASSES[e.k];
  const f = b.hz(e.n);
  if (sr / f < 8) return;
  // the same note always plucked the same way: seeded by the note, not by what played before it
  const noise = new Noise(hash32(Math.round(e.t * 1000), e.n, Math.round(e.v * 1000), 0xba55));
  const v = Math.max(0.05, e.v);
  const B = m.stiff[0] * (m.stiff[1] / m.stiff[0]) ** ((e.n - 28) / 12);
  const rel = e.rel || 0.1;
  const [share, cents, ratio] = m.pol;
  // detuned about f, as string()'s polarizations are
  const A = new StiffLoop(sr, f * 2 ** ((-share * cents) / 1200), m, B, 1, rel);
  const P = new StiffLoop(sr, f * 2 ** (((1 - share) * cents) / 1200), m, B, ratio, rel);
  const pluck = bassPluck(sr, f, v, m, noise);
  let peak = 0;
  for (let i = 0; i < pluck.length; i++) peak = Math.max(peak, Math.abs(pluck[i]));
  A.fret = ((1 - share) * peak * m.buzz) / v;
  P.fret = (share * peak * m.buzz) / v;
  const click = pickClick(sr, v, m, noise, peak);
  const pre = new Chain(sr, m.pre);
  const cab = new Chain(sr, m.cab);
  const dc = new SVF(sr, 25, 0.7);
  // each time the string slaps the frets it rattles: a burst of highs as long as the contact, heard through the pickup
  let rattle = [new SVF(sr, 1200, 0.7), new SVF(sr, 3000, 0.7)];
  const ring = Math.round(0.02 * sr);
  let quiet = ring + 1;
  const len = e.d + Math.min(3 * rel, 4) + 0.02;
  const drive = m.drive;
  // the drive runs at twice the rate (its harmonics would fold back as grit), OS_LAG samples late: the DI waits for it
  const os = new Oversampled();
  const clip = (x: number) => softClip(drive * x) / drive;
  const late = new Float64Array(OS_LAG + 1);
  b.voice(
    e.t,
    len,
    (j, u) => {
      const x = j < pluck.length ? pluck[j] : 0;
      const held = u < e.d;
      const s = A.tick((1 - share) * x, held) + P.tick(share * x, held) + (j < click.length ? click[j] : 0);
      const hit = A.hit + P.hit;
      // the rattle's filters rest between hits (left running on silence their states sink into slow subnormals)
      if (hit) quiet = 0;
      let r = 0;
      if (quiet < ring) {
        quiet++;
        rattle[0].run(hit ? hit * noise.next() : 0);
        r = RATTLE * rattle[1].run(rattle[0].hp);
      } else if (quiet === ring) {
        quiet++;
        rattle = [new SVF(sr, 1200, 0.7), new SVF(sr, 3000, 0.7)];
      }
      dc.run(s + r);
      const k = j % late.length;
      late[k] = dc.hp * v;
      const amp = cab.run(os.run(pre.run(late[k]), clip));
      return (m.di * late[(j + 1) % late.length] + (1 - m.di) * amp) * m.gain;
    },
    0,
    0.04,
    0,
    0.3,
  );
}

/**
 * The pick's click as it leaves the string: 3 ms of noise around 2 kHz (at `click` 1, 1.5 to 4 kHz in the first 5 ms
 * sits 30 dB under the note's peak, as on the recorded picked basses).
 */
function pickClick(sr: number, v: number, m: BassModel, noise: Noise, peak: number): Float32Array {
  const n = m.click ? Math.round(0.003 * sr) : 0;
  const out = new Float32Array(n);
  const bp = new SVF(sr, 2000, 1.4);
  for (let i = 0; i < n; i++) {
    bp.run(noise.next());
    out[i] = bp.bp * (1 - i / n) ** 2 * m.click * v * peak;
  }
  return out;
}

/**
 * One period of the pluck's push on the bridge (a pulse `beta` of a period wide, rounded by the pick's edge or the
 * finger's pad), through the pickup's comb and resonance: the loop's input (commuted, as excitation() does). The pull
 * back between the pulses is a smooth lobe that starts and ends at zero rather than a flat step: a loop that
 * disperses returns a step's highs early, so a step at the end of the input would not meet its own return and would
 * ring out as a burst of highs.
 */
function bassPluck(sr: number, f: number, v: number, m: BassModel, noise: Noise): Float32Array {
  const N = Math.max(2, Math.round(sr / f));
  const beta = m.beta[0] + (m.beta[1] - m.beta[0]) * noise.unit();
  const w = Math.max(1, Math.round(beta * N));
  const shape = new Float32Array(N);
  const lobe = (2 * w) / (N - w);
  for (let i = 0; i < N; i++) {
    shape[i] = (i < w ? 1 : -lobe * Math.sin((Math.PI * (i - w)) / (N - w)) ** 2) + 0.02 * noise.next();
  }
  roundOff(shape, m.exc * (f / E1) ** m.excTilt * 2 ** (m.excVel * (v - 0.7)), sr);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += shape[i];
  mean /= N;
  let rms = 0;
  for (let i = 0; i < N; i++) rms += (shape[i] -= mean) ** 2;
  const norm = 0.25 / (Math.sqrt(rms / N) || 1);
  const pd = Math.max(1, Math.round((m.pickup.at * sr) / f));
  const L = N + pd + Math.round(0.005 * sr);
  const out = new Float32Array(L);
  for (let i = 0; i < N; i++) out[i] = shape[i] * norm;
  for (let i = L - 1; i >= pd; i--) out[i] -= out[i - pd];
  const res = new SVF(sr, m.pickup.res[0], m.pickup.res[1]);
  for (let i = 0; i < L; i++) out[i] = res.run(out[i]);
  return out;
}
