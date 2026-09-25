// Struck things, built from their modes and fitted to recordings (see out/research/proposals/sound-keys.md): a
// grand piano's stretched, beating partials, marimba, vibraphone and kalimba bars and tines, glockenspiel and
// bells, each a bank of decaying sines at the ratios its shape rings at, plus the strike. Hand drums and metal
// percussion live here too.

import type { Ev, MalletKind } from '../types.ts';
import type { Bus } from './bus.ts';
import { SVF, TAU } from './dsp.ts';

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;
const { exp, sin, cos, min, max, sqrt, pow, log } = Math;

/** A sine by recurrence (y[n] = 2cos(w)·y[n-1] - y[n-2]): one multiply per sample instead of a Math.sin. */
class Partial {
  private y1: number;
  private y2: number;
  private readonly k: number;
  constructor(freq: number, sr: number, phase = 0) {
    const w = (TAU * freq) / sr;
    this.k = 2 * cos(w);
    this.y1 = sin(phase - w);
    this.y2 = sin(phase - 2 * w);
  }
  next(): number {
    const y = this.k * this.y1 - this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const panFor = (n: number, width = 0.5) => max(-width, min(width, (n - 64) / 30));

/** Deterministic [0, 1) per key: a real instrument's strings and bars are tuned and voiced once, not per note. */
function keyRandom(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * A bank of exponentially decaying sines, each a two-pole resonator ringing freely (y = c1·y1 - c2·y2):
 * two multiplies a sample, the decay built into the recurrence. A mode may start negative (a copy that cancels
 * another at first: a swell). Modes more than 100 dB below their start are dropped by prune().
 */
export class Modes {
  private readonly c1: Float64Array;
  private readonly c2: Float64Array;
  private readonly y1: Float64Array;
  private readonly y2: Float64Array;
  /** Per-sample log decay and the envelope so far, relative to the start (pruning never guesses from samples). */
  private readonly ld: Float64Array;
  private readonly env: Float64Array;
  n = 0;
  constructor(cap: number) {
    [this.c1, this.c2, this.y1, this.y2, this.ld, this.env] = [0, 0, 0, 0, 0, 0].map(() => new Float64Array(cap));
  }
  /** A sine of amplitude `amp` at `freq` Hz starting at `phase`, falling 60 dB in `t60` seconds. */
  add(freq: number, amp: number, t60: number, sr: number, phase = 0): void {
    if (this.n === this.c1.length || freq >= sr * 0.45 || amp === 0) return;
    const w = (TAU * freq) / sr;
    const ld = -6.907755 / (t60 * sr);
    const r = exp(ld);
    const i = this.n++;
    this.c1[i] = 2 * r * cos(w);
    this.c2[i] = r * r;
    // state for y[-1], y[-2] so that y[n] = amp·r^n·sin(w n + phase)
    this.y1[i] = (amp / r) * sin(phase - w);
    this.y2[i] = (amp / (r * r)) * sin(phase - 2 * w);
    this.ld[i] = ld;
    this.env[i] = 1;
  }
  next(): number {
    const { c1, c2, y1, y2 } = this;
    let s = 0;
    for (let i = 0; i < this.n; i++) {
      const y = c1[i] * y1[i] - c2[i] * y2[i];
      y2[i] = y1[i];
      y1[i] = y;
      s += y;
    }
    return s;
  }
  /** Advances the envelopes by `samples` and drops the modes that have died away (call every few hundred samples). */
  prune(samples: number): void {
    const { c1, c2, y1, y2, ld, env } = this;
    for (let i = 0; i < this.n; i++) {
      env[i] *= exp(ld[i] * samples);
      if (env[i] < 1e-5) {
        const l = --this.n;
        c1[i] = c1[l];
        c2[i] = c2[l];
        y1[i] = y1[l];
        y2[i] = y2[l];
        ld[i] = ld[l];
        env[i] = env[l];
        i--;
      }
    }
  }
}

// ------------------------------------------------------------------ piano

/** String stiffness: lowest around C3, rising steeply into the treble and gently into the bass (Iowa Steinway). */
export const pianoB = (m: number) => (m >= 48 ? 1e-4 * 10 ** (0.0393 * (m - 48)) : 1e-4 * 10 ** (0.025 * (48 - m)));

/**
 * A grand piano's string: up to 48 stretched partials whose levels follow the measured spectral envelope
 * (soundboard high-pass near 230 Hz, a hammer low-pass whose corner rises five octaves from pp to ff, a
 * little per-key voicing), each decaying in two stages: a prompt sound, and an aftersound ~20 dB down (~11 in
 * the bass) that rings four times longer on a second, slightly mistuned string, so the partials beat as the two
 * cross; the lowest six partials get a third string. The damper falls when the key is released.
 */
export function piano(b: Bus, e: E<'piano'>): void {
  const sr = b.sr;
  const notes = e.n.slice().sort((x, y) => x - y);
  const strum = e.strum ?? 0.012;
  const v = min(1, max(0.05, e.v));
  const fc = 1030 * 2 ** (5.4 * (v - 0.6));
  const tilt = max(0, 2.6 + 6.5 * (v - 0.6)) / 6.02; // exponent of 1/k (the corner fc does most of the brightening)
  notes.forEach((m, idx) => {
    const f0 = b.hz(m);
    const B = pianoB(m);
    const rnd = keyRandom(Math.round(m * 7) + 1);
    const modes = new Modes(104);
    // the aftersound sits ~20 dB under the prompt sound, closer in the bass
    const after = 10 ** ((-20 + 9 * min(1.5, max(0, (48 - m) / 12))) / 20);
    let top = 0;
    const amps: number[] = [];
    for (let k = 1; k <= 48; k++) {
      const fk = k * f0 * sqrt(1 + B * k * k);
      if (fk > min(sr * 0.45, 16000)) break;
      const a = pow(k, -tilt) * pow(1 + (fk / fc) ** 2, -1.87) / sqrt(1 + (234 / fk) ** 4) *
        (0.84 + 0.32 * rnd()); // voicing: +-1.5 dB per partial
      amps.push(a);
      top = max(top, a);
    }
    amps.forEach((a, i) => {
      const k = i + 1;
      if (a < top * 0.003) return; // -50 dB
      const fk = k * f0 * sqrt(1 + B * k * k);
      const tp = min(9, max(0.4, (6.5 * pow(f0 / 100, -0.45)) / (1 + (fk / 5000) ** 2)));
      const ta = min(30, 4 * tp);
      // the beat between unison strings: faster up the keyboard and for higher partials
      const beat = (0.25 + 0.45 * pow(fk / 1000, 0.7)) * (0.6 + 0.8 * rnd());
      modes.add(fk, a * (1 - after), tp, sr);
      if (a > top * 0.03) {
        const g = a * after;
        modes.add(fk + beat, g, ta, sr, TAU * rnd());
        if (k <= 6) modes.add(fk - 0.7 * beat, g * 0.6, ta * 0.8, sr, TAU * rnd());
      }
    });
    // the hammer's knock: a short thud of noise, darker and quieter for soft blows; up the keyboard the
    // hammers are small and the strings short and stiff, so it is brighter and stands out more
    const thump = new SVF(sr, min(9000, max(500 + 1500 * v, 2.5 * f0 * (0.5 + v))), 0.6);
    const t0 = e.t + idx * strum;
    const g = (0.22 * v) / (sqrt(notes.length) * top);
    const knockGain = 0.35 * v * top * 2 ** (max(0, m - 60) / 12);
    const rel = m > 88 ? 1.5 : 0.22; // the top keys have no dampers
    const damp = exp(-1 / (rel * sr));
    const knock = exp(-1 / (0.008 * sr));
    let damper = 1;
    let hammer = knockGain;
    b.voice(
      t0,
      e.d + rel * 4,
      (j, u) => {
        if ((j & 1023) === 1023) modes.prune(1024);
        let s = modes.next();
        if (u > e.d) {
          damper *= damp;
          s *= damper;
        }
        if (hammer > 1e-6 * top) {
          s += thump.run(b.noise.next()) * hammer;
          hammer *= knock;
        }
        return s * g;
      },
      panFor(m, 0.4),
      0.3,
      0.05,
      0.15,
    );
  });
}

// ------------------------------------------------------------------ mallets

/** One mode of a bar or tine: ratio to the fundamental at the bottom and the top of the model's range. */
interface Mode {
  r: [number, number];
  /** Level (dB re the fundamental) at mf (v = 0.7), and dB gained per unit of velocity. */
  db: number;
  vel: number;
  /** T60 in seconds at `at` Hz, falling as (at / f)^fall above it. */
  t60: number;
  at: number;
  fall: number;
}

interface Bar {
  /** Fundamental: T60 in seconds at `at` Hz, falling as (at / f)^fall, capped at max. */
  t60: number;
  at: number;
  fall: number;
  max: number;
  modes: Mode[];
  /** Range the mode ratios glide over (Hz of the fundamental). */
  lo: number;
  hi: number;
  /** The mallet's reach: modes above this (Hz, at mf) fall 30 dB/oct; harder blows reach an octave further per 0.5 v. */
  reach: number;
  /** Resonator build-up time constant (s) at 262 Hz, scaled as (262 / f)^bloomFall: the fundamental swells in
   * after the strike. 0: none. */
  bloom: number;
  bloomFall: number;
  /** Motor tremolo depth on the resonated fundamental (fraction), rate in Hz. */
  trem: number;
  /** Strike noise: level re the fundamental, band centre as a multiple of f0 (capped), decay (s). */
  click: number;
  clickAt: number;
  clickDecay: number;
  gain: number;
}

// Measured: marimba and vibraphone VCSL (CC0) single notes, kalimba Freesound hollandm (CC0) 17-key box kalimba.
const BARS: Record<MalletKind, Bar> = {
  marimba: {
    t60: 3.3,
    at: 349,
    fall: 1.05,
    max: 6,
    modes: [
      { r: [4.0, 3.1], db: -17, vel: 53, t60: 0.7, at: 1400, fall: 1.5 },
      { r: [9.2, 8.0], db: -50, vel: 40, t60: 0.18, at: 3000, fall: 1 },
    ],
    lo: 600,
    hi: 1400,
    reach: 2200,
    bloom: 0.028,
    bloomFall: 1,
    trem: 0,
    click: 1.2,
    clickAt: 2,
    clickDecay: 0.005,
    gain: 0.3,
  },
  vibes: {
    t60: 15,
    at: 600,
    fall: 1.1,
    max: 15,
    modes: [
      { r: [4.0, 3.7], db: -17, vel: 30, t60: 3.7, at: 1046, fall: 1.35 },
      { r: [10.4, 9.5], db: -22, vel: 30, t60: 0.55, at: 2700, fall: 1 },
    ],
    lo: 400,
    hi: 1320,
    reach: 2500,
    bloom: 0.02,
    bloomFall: 0.5,
    trem: 0.45,
    click: 0.25,
    clickAt: 2,
    clickDecay: 0.004,
    gain: 0.18,
  },
  kalimba: {
    t60: 4.2,
    at: 392,
    fall: 0.95,
    max: 6,
    modes: [
      // the tine rattles against its bridge: an octave and a twelfth above, fading faster than the fundamental
      { r: [2, 2], db: -14, vel: 20, t60: 0.9, at: 700, fall: 1 },
      { r: [3, 3], db: -33, vel: 35, t60: 0.4, at: 1000, fall: 1 },
      // the tine's own second bending mode: a bright ping that is over in a moment
      { r: [6.6, 6.3], db: -6, vel: 0, t60: 0.2, at: 4000, fall: 1.2 },
    ],
    lo: 390,
    hi: 1320,
    reach: 12000,
    bloom: 0,
    bloomFall: 0,
    trem: 0,
    click: 0.25,
    clickAt: 8,
    clickDecay: 0.0015,
    gain: 0.27,
  },
};

const lerpLog = (f: number, lo: number, hi: number) => min(1, max(0, log(f / lo) / log(hi / lo)));

/**
 * A struck bar or plucked tine as a few modes at measured ratios, levels and decays. A harder blow excites the
 * upper modes far more (the mallet's contact gets shorter). Bars with resonators swell in over a few
 * milliseconds after the strike; the vibraphone's motor pulses the resonated fundamental, in step for all
 * bars (one shaft).
 */
export function mallet(b: Bus, e: E<'mallet'>): void {
  const M = BARS[e.k];
  const sr = b.sr;
  const f = b.hz(e.n);
  const v = min(1, max(0.05, e.v));
  const x = lerpLog(f, M.lo, M.hi);
  const t1 = min(M.max, M.t60 * pow(M.at / f, M.fall));
  const modes = new Modes(8);
  // the fundamental; with a resonator, minus a copy that dies at the build-up rate: (1 - e^(-t/bloom)) e^(-t/T)
  const bloom = M.bloom ? min(0.04, max(0.002, M.bloom * pow(262 / f, M.bloomFall))) : 0;
  const res = new Modes(2);
  (M.trem ? res : modes).add(f, 1, t1, sr);
  if (bloom) {
    const tb = 1 / (1 / t1 + 1 / (6.907755 * bloom)); // T60 of e^(-t/T) e^(-t/bloom)
    (M.trem ? res : modes).add(f, -0.97, tb, sr);
  }
  const reach = M.reach * 2 ** (2 * (v - 0.7));
  for (const m of M.modes) {
    const fm = f * (m.r[0] + (m.r[1] - m.r[0]) * x);
    if (fm > sr * 0.45) continue;
    const db = min(-3, m.db + m.vel * (v - 0.7)) - 30 * max(0, Math.log2(fm / reach));
    if (db < -70) continue;
    modes.add(fm, 10 ** (db / 20), min(t1, m.t60 * pow(m.at / fm, m.fall)), sr);
  }
  const click = new SVF(sr, min(8000, M.clickAt * f * (0.6 + 0.8 * v)), 0.7);
  const knock = exp(-1 / (M.clickDecay * sr));
  let tick = M.click * v;
  const g = M.gain * v;
  let wobble = 1;
  b.voice(
    e.t,
    min(8, t1 * 0.75), // until the fundamental is 45 dB down
    (j, u) => {
      let s = modes.next();
      if (M.trem) {
        // the motor turns the resonator discs on one shaft: every bar pulses in step (5.2 Hz, ~4 dB)
        if ((j & 31) === 0) wobble = 1 - M.trem * 0.5 * (1 - cos(TAU * 5.2 * (e.t + u)));
        s += res.next() * wobble;
      }
      if (tick > 1e-4) {
        click.run(b.noise.next());
        tick *= knock;
        s += click.bp * tick;
      }
      return s * g;
    },
    e.p ?? panFor(e.n),
    0.35,
    0.15,
    0.25,
  );
}

// ------------------------------------------------------------------ bells

interface BellMode {
  r: number;
  db: number;
  vel: number;
  /** T60 (s) at 800 Hz of the fundamental, scaled as (800 / f0)^fall. */
  t60: number;
  fall: number;
}

/**
 * Glockenspiel (VCSL CC0, measured): the ratios glide from 1 : 3.0 : 5.7 : 8.9 at G5 to 1 : 2.7 : 5.1 : 8.2 two
 * octaves up; the upper modes are as loud as the fundamental at the strike and gone within a second.
 * Tubular bell (VCSL CC0, measured) and a cast church bell (hum, prime, tierce, quint, nominal: Rossing 2000,
 * Hibbert 2008) for the movements whose tone picks another bell.
 */
const BELLS: Record<'glock' | 'tubular' | 'church', { modes: BellMode[]; glide: number; click: number; gain: number }> =
  {
    glock: {
      modes: [
        { r: 1, db: 0, vel: 0, t60: 9, fall: 0.75 },
        { r: 3.0, db: 2, vel: 6, t60: 1.2, fall: 1 },
        { r: 5.65, db: 3, vel: 25, t60: 0.8, fall: 0.8 },
        { r: 8.9, db: -6, vel: 25, t60: 0.9, fall: 1 },
      ],
      glide: 1,
      click: 0.5,
      gain: 1,
    },
    tubular: {
      // relative to the strike tone the ear hears; the low modes hum on for a long time
      modes: [
        { r: 1, db: -4, vel: 0, t60: 16, fall: 0.8 },
        { r: 1.48, db: 0, vel: 3, t60: 12, fall: 0.8 },
        { r: 2.03, db: -2, vel: 6, t60: 5, fall: 0.8 },
        { r: 2.65, db: -9, vel: 10, t60: 4, fall: 0.8 },
        { r: 3.3, db: -8, vel: 15, t60: 1.5, fall: 0.8 },
        { r: 4.1, db: -7, vel: 20, t60: 1.2, fall: 0.8 },
      ],
      glide: 0,
      click: 0.15,
      gain: 0.58, // long-ringing low modes: level with the glockenspiel
    },
    church: {
      // hum, prime, tierce, quint, nominal, superquint, octave nominal
      modes: [
        { r: 0.5, db: -6, vel: 0, t60: 20, fall: 0.8 },
        { r: 1, db: -2, vel: 0, t60: 10, fall: 0.8 },
        { r: 1.2, db: -1, vel: 3, t60: 8, fall: 0.8 },
        { r: 1.5, db: -10, vel: 6, t60: 4, fall: 0.8 },
        { r: 2, db: 0, vel: 6, t60: 5, fall: 0.8 },
        { r: 2.5, db: -8, vel: 12, t60: 2, fall: 0.8 },
        { r: 3, db: -12, vel: 15, t60: 1.5, fall: 0.8 },
        { r: 4, db: -14, vel: 20, t60: 1, fall: 0.8 },
      ],
      glide: 0,
      click: 0.1,
      gain: 0.62,
    },
  };

/** The movement's tone keeps its old role (a different bell per record): FM ratios map onto real bells. */
export const bellKind = (fmRatio: number): keyof typeof BELLS =>
  fmRatio >= 3 && fmRatio < 4.5 ? 'glock' : fmRatio < 1.7 ? 'church' : fmRatio > 4.5 ? 'tubular' : 'glock';

export function bell(b: Bus, e: E<'bell'>): void {
  const sr = b.sr;
  const B = BELLS[bellKind(b.tone.fmRatio)];
  const v = min(1, max(0.05, e.v));
  e.n.forEach((m, k) => {
    const f0 = b.hz(m);
    const oct = B.glide ? Math.log2(max(1, f0 / 800)) : 0; // thicker bars up high: the ratios close in
    const modes = new Modes(10);
    let longest = 0;
    B.modes.forEach((md, i) => {
      const r = i === 0 ? md.r : md.r * (1 - [0, 0.053, 0.027, 0.025][min(3, i)] * oct);
      const f = f0 * r;
      if (f > sr * 0.45) return;
      const t60 = md.t60 * pow(800 / f0, md.fall);
      longest = max(longest, t60);
      modes.add(f, 10 ** ((md.db + md.vel * (v - 0.7)) / 20), t60, sr);
    });
    // metal on steel: a broadband tick above the fundamental
    const click = new SVF(sr, min(12000, 1.5 * f0), 0.7);
    const knock = exp(-1 / (0.003 * sr));
    let tick = B.click * v;
    const amp = B.gain * v * [0.16, 0.095, 0.048][k % 3];
    b.voice(
      e.t,
      min(8, longest * 0.75),
      () => {
        let s = modes.next();
        if (tick > 1e-4) {
          click.run(b.noise.next());
          tick *= knock;
          s += click.hp * tick;
        }
        return s * amp;
      },
      [-0.3, 0.3, 0][k % 3],
      0.5,
      0.15,
    );
  });
}

// ------------------------------------------------------------------ hand drums and metals

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

export function perc(b: Bus, e: E<'perc'>): void {
  const sr = b.sr;
  switch (e.k) {
    case 'conga':
    case 'congaHi':
    case 'bongo': {
      // a membrane: the pitch drops as the head settles, a slap of noise on top
      const f0 = e.n !== undefined ? b.hz(e.n) : { conga: 196, congaHi: 262, bongo: 392 }[e.k];
      const dec = { conga: 0.22, congaHi: 0.16, bongo: 0.1 }[e.k];
      b.hit(
        `perc:${e.k}:${f0.toFixed(1)}`,
        e.t,
        dec * 6,
        () => {
          let ph = 0;
          const slap = new SVF(sr, 1800, 1.2);
          return (_j, u) => {
            ph += (f0 * (1 + 0.35 * exp(-u / 0.012))) / sr;
            slap.run(b.noise.next());
            const body = sin(TAU * ph) * exp(-u / dec) + 0.3 * sin(TAU * ph * 1.52) * exp(-u / (dec * 0.4));
            return (body + slap.bp * 0.7 * exp(-u / 0.004)) * 0.35;
          };
        },
        e.v,
        e.p ?? (e.k === 'bongo' ? 0.35 : e.k === 'congaHi' ? 0.15 : -0.25),
        0.15,
      );
      break;
    }
    case 'cowbell':
      // the 808's: two square waves a fifth-ish apart through a band-pass, a fast decay then a ring
      b.hit(
        'perc:cowbell',
        e.t,
        0.8,
        () => {
          const bp = new SVF(sr, 800, 2.5);
          let p1 = 0;
          let p2 = 0;
          return (_j, u) => {
            p1 = (p1 + 540 / sr) % 1;
            p2 = (p2 + 800 / sr) % 1;
            bp.run((p1 < 0.5 ? 1 : -1) + (p2 < 0.5 ? 1 : -1));
            return bp.bp * (0.6 * exp(-u * 25) + 0.4 * exp(-u * 5)) * 0.3;
          };
        },
        e.v,
        e.p ?? 0.3,
        0.1,
        0.1,
      );
      break;
    case 'ride':
    case 'crash': {
      const crash = e.k === 'crash';
      b.hit(
        `perc:${e.k}`,
        e.t,
        crash ? 3 : 1.6,
        () => {
          const ph = METAL.map((_, k) => (k * 0.17) % 1);
          const hp = new SVF(sr, crash ? 3500 : 5500, 0.8);
          const lp = new SVF(sr, crash ? 14000 : 10000, 0.6);
          const ping = [new Partial(3150, sr), new Partial(4870, sr)];
          return (j, u) => {
            let m = 0;
            for (let k = 0; k < 6; k++) {
              ph[k] = (ph[k] + (METAL[k] * (crash ? 3.1 : 2.4)) / sr) % 1;
              m += ph[k] < 0.5 ? 0.15 : -0.15;
            }
            if (crash && (j & 31) === 0) lp.set(6000 + 8000 * exp(-u * 1.5));
            hp.run(m * (crash ? 0.4 : 0.8) + b.noise.next() * (crash ? 0.8 : 0.35));
            const body = lp.run(hp.hp);
            const bell = crash ? 0 : (ping[0].next() + 0.6 * ping[1].next()) * 0.06 * exp(-u * 3);
            return (body * exp(-u * (crash ? 1.4 : 2.6)) * min(1, u / 0.002) + bell) * (crash ? 0.22 : 0.11);
          };
        },
        e.v,
        e.p ?? (crash ? -0.4 : 0.45),
        crash ? 0.35 : 0.15,
        0.05,
      );
      break;
    }
    case 'snap':
      b.hit(
        'perc:snap',
        e.t,
        0.2,
        () => {
          const bp = new SVF(sr, 2200, 3);
          return (_j, u) => {
            bp.run(b.noise.next());
            const env = exp(-u * 120) + 0.7 * (u > 0.006 ? exp(-(u - 0.006) * 90) : 0);
            return bp.bp * env * 1.2;
          };
        },
        e.v,
        e.p ?? 0.1,
        0.3,
        0.1,
      );
      break;
  }
}
