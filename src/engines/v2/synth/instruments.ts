// Every instrument, computed one sample at a time. The drums, bass, supersaw, organ, lead, bell and
// transition effects are adapted from EX NIHILO; the electric piano, gated and dusty drums, strings, glass,
// synthwave bass and lead, flute and vinyl are new.

import type { Ev, KickKind, LeadKind, PadKind, RiseKind } from '../types.ts';
import type { Bus, Stroke } from './bus.ts';
import { freeverb, pan, saw, smooth, SVF, TAU, Wander } from './dsp.ts';
import { Modes } from './modal.ts';

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;
const { exp, sin, cos, tanh, min, max, sqrt, round, pow, abs, log2, PI } = Math;
/** Release: -60 dB, r samples after note-off at sample `on`. */
const fall = (j: number, on: number, r: number) => (j > on ? exp((-6.9 * (j - on)) / r) : 1);

// ------------------------------------------------------------------ drums

// kick: a sine diving from a chirp onto the key's tonic or fifth (41-62 Hz) in ~10 ms, driven into tanh. Layered
// with a body an octave up and the drive's harmonics band-passed at 600 Hz (the knock a phone can play), then
// soft-clipped together. A 4 kHz noise tick is the beater.
// v2 kicks are rounder than v1's: the same weight, but less of the ringing knock (heard on its own, over a
// bass that covers the thump, it turns tinny and bell-like) and a little more sub
const KICK: Record<Exclude<KickKind, 'acoustic'>, readonly number[]> = {
  // sweep from Hz, sweep s, decay /s, drive, gain, beater, sub, knock, body, low-pass
  soft: [130, 0.008, 11, 1.3, 0.64, 0.35, 1, 0.4, 0.2, 3500],
  big: [150, 0.009, 8, 1.7, 0.7, 0.5, 0.8, 0.75, 0.6, 3500],
  drop: [165, 0.008, 9, 2.2, 0.68, 0.8, 0.75, 1.35, 1, 3500],
  dusty: [120, 0.011, 9, 1.4, 0.42, 0.15, 0.75, 0.9, 0.5, 1500],
  punch: [175, 0.009, 10, 1.9, 0.7, 0.7, 0.8, 0.95, 0.8, 4500],
};

export function kick(b: Bus, e: E<'kick'>): void {
  if (e.k === 'acoustic') return acousticKick(b, e);
  const [f0, tau, dec, drive, g0, ck, sw, kn, pu, lpf] = KICK[e.k];
  const sr = b.sr;
  b.hit(
    `kick:${e.k}:${e.n}`,
    e,
    0.7,
    (s) => {
      const f1 = b.hz(e.n) * s.tune;
      const g = g0 / tanh(drive);
      const bp = new SVF(sr, 4000, 0.8);
      const lp = new SVF(sr, lpf * s.bright, 0.6);
      const knock = new SVF(sr, 520, 0.5);
      const d = dec / s.decay;
      let ph = 0;
      return (_j, u) => {
        ph += (f1 + (f0 * s.tune - f1) * exp(-u / tau) + 350 * exp(-u / 0.0025)) / sr;
        bp.run(b.noise.next());
        const x = tanh(drive * sin(TAU * ph) * exp(-d * u) * (1 + 1.5 * exp(-40 * u)));
        knock.run(x);
        const y = sw * x + kn * knock.bp + pu * sin(TAU * 2 * f1 * u) * exp(-u / 0.035) * min(1, u / 0.002);
        return lp.run(tanh(1.4 * y)) * g + bp.bp * ck * s.bright * 0.28 * exp(-u / 0.004) * smooth(u / 0.0005);
      };
    },
    0,
    e.k === 'soft' ? 0 : 0.04,
  );
}

const burst = (d: number, k: number) => (d < 0 ? 0 : min(1, d * 400) * exp(-d * k));

/** Four "hands" a few ms apart through a 1.35 kHz band-pass and a short room tail, soft-clipped. */
function clap(b: Bus, e: E<'snare'>): void {
  const v = round(e.v * 20) / 20; // soft clipping makes the clap non-linear in velocity: one sample per level
  b.hit(
    `clap:${v}`,
    { t: e.t, v: 1, take: e.take },
    0.5,
    (s) => {
      const f = new SVF(b.sr, 1350 * s.tune, 1.1);
      const top = new SVF(b.sr, 7500 * s.bright);
      return (_j, u) => {
        f.run(
          top.run(b.noise.next()) *
            (0.6 * burst(u, 300) + burst(u - 0.011, 300) + burst(u - 0.022, 280) + 1.2 * burst(u - 0.031, 17)),
        );
        return tanh(f.bp * v * 2.4);
      };
    },
    0.02,
    v < 0.8 ? 0.25 : 0.32,
  );
}

/** The 80s snare: a short body and a burst of noise that holds, then shuts like a gate on a big room. */
function gated(b: Bus, e: E<'snare'>): void {
  b.hit(
    'gated',
    e,
    0.42,
    (s) => {
      const hp = new SVF(b.sr, 900, 0.6);
      const top = new SVF(b.sr, 7000 * s.bright);
      let p1 = 0;
      return (_j, u) => {
        p1 += (190 * s.tune * (1 + 0.25 * exp(-40 * u))) / b.sr;
        hp.run(top.run(b.noise.next()));
        const gate = u < 0.24 ? 1 - (0.35 * u) / 0.24 : exp(-70 * (u - 0.24));
        return (sin(TAU * p1) * 0.6 * exp(-22 * u) + 0.9 * hp.hp * gate * smooth(u / 0.002)) * 0.72;
      };
    },
    0,
    0.18,
  );
}

function rim(b: Bus, e: E<'snare'>): void {
  b.hit(
    'rim',
    e,
    0.08,
    (s) => {
      const bp = new SVF(b.sr, 1800 * s.bright, 2);
      const d = 90 / s.decay;
      return (_j, u) => {
        bp.run(b.noise.next());
        return (bp.bp * 1.2 + 0.6 * sin(TAU * 820 * s.tune * u)) * exp(-d * u) * 0.5;
      };
    },
    0.15,
    0.1,
  );
}

/** The head (two modes dipping in pitch) + band-limited noise for the wires, darker when bigger. */
export function snare(b: Bus, e: E<'snare'>): void {
  if (e.k === 'clap') return clap(b, e);
  if (e.k === 'gated') return gated(b, e);
  if (e.k === 'rim') return rim(b, e);
  if (e.k === 'acoustic') return acousticSnare(b, e);
  const size = { roll: 0.5, big: 1, huge: 1.7, dusty: 0.8 }[e.k];
  b.hit(
    `snare:${e.k}`,
    e,
    0.6 * size,
    (s) => {
      const hp = new SVF(b.sr, 1000, 0.6);
      const top = new SVF(b.sr, (e.k === 'dusty' ? 3000 : 5000 / sqrt(size)) * s.bright);
      const g = (size < 1 ? 0.55 : 0.9) * (e.k === 'dusty' ? 1.3 : 1);
      // a soft stroke barely sets the wires going
      const wires = 1.5 * s.bright ** 2;
      const d = 14 / size / s.decay;
      let p1 = 0;
      let p2 = 0;
      return (_j, u) => {
        const f = 185 * s.tune * (1 + 0.3 * exp(-45 * u));
        p1 += f / b.sr;
        p2 += (1.63 * f) / b.sr;
        hp.run(top.run(b.noise.next()));
        return ((sin(TAU * p1) + 0.45 * sin(TAU * p2)) * 0.55 * exp(-26 * u) +
          wires * hp.hp * exp(-d * u) * smooth(u / 0.01)) * g;
      };
    },
    0,
    { roll: 0.12, big: 0.42, huge: 0.6, dusty: 0.18 }[e.k],
  );
}

export function tom(b: Bus, e: E<'tom'>): void {
  if (e.k === 'acoustic') return acousticTom(b, e);
  const f = b.hz(e.n);
  b.hit(
    `tom:${e.n}`,
    e,
    0.6,
    (s) => {
      const d = 7 / s.decay;
      let ph = 0;
      return (_j, u) => {
        ph += (f * s.tune * (1 + 0.6 * exp(-18 * u))) / b.sr;
        return (sin(TAU * ph) * exp(-d * u) + 0.2 * s.bright * b.noise.next() * exp(-60 * u)) * 0.42;
      };
    },
    max(-0.6, min(0.6, (f - 150) / 90)),
    0.25,
  );
}

// Hats: six square waves at the 808's metallic ratios + noise, high-passed (the shaker is noise only).
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 1.7);

export function hat(b: Bus, e: E<'hat'>): void {
  const sh = e.k === 'shaker';
  const open = e.k === 'open';
  const dusty = e.k === 'dusty';
  b.hit(
    `hat:${e.k}`,
    e,
    open ? 0.131 : 0.14,
    (s) => {
      const hp = new SVF(b.sr, (sh ? 5000 : dusty ? 5500 : 6500) * s.bright, 0.9);
      const lpf = (dusty ? 6500 : 9500) * s.bright;
      const lp = [new SVF(b.sr, lpf), new SVF(b.sr, lpf)];
      const ph = METAL.map(() => b.noise.unit());
      const dec = (open ? 13 : sh ? 40 : dusty ? 26 : 32) / s.decay;
      const att = sh ? 0.007 : 0.0025;
      const g = sh ? 0.28 : dusty ? 0.28 : 0.32;
      return (_j, u) => {
        let m = 0;
        if (!sh) {
          for (let k = 0; k < 6; k++) {
            ph[k] = (ph[k] + (METAL[k] * s.tune) / b.sr) % 1;
            m += ph[k] < 0.5 ? 0.12 : -0.12;
          }
        }
        hp.run(m + 0.5 * b.noise.next());
        return lp[1].run(lp[0].run(hp.hp)) * exp(-dec * u) * min(1, u / att) * g;
      };
    },
    e.p ?? (sh ? ((e.t * 8) % 2 < 1 ? -0.35 : 0.35) : open ? -0.2 : 0.22),
    0.08,
  );
}

// ------------------------------------------------------------------ the acoustic kit
// A kit recorded in a room, fitted to recordings (out/research/proposals/sound-drums.md): the close and overhead
// mics of Big Rusty Drums (Karoryfer, CC0) and VCSL (CC0), and the drums of four post-rock records. Each drum is
// its head's modes, what strikes the head and what rattles with it; the room is the mix's reverb send.

/** How hard a stroke is, from its brightness: 1 for a full stroke, about 0.3 for a ghost note. */
const force = (s: Stroke) => s.bright ** 3;

interface HeadSpec {
  /** Ratio to the fundamental, dB re the fundamental at a full stroke. */
  modes: readonly (readonly [number, number])[];
  /** The fundamental's ring (T60, s); a mode at ratio r rings t60 · r^-fall. */
  t60: number;
  fall: number;
  /** Share of each mode's amplitude the stroke radiates away at once, and how fast (T60, s). */
  burst: number;
  burstT60: number;
  /** Pitch rise of a full stroke (fraction) and how fast it relaxes (time constant, s). */
  glide: number;
  glideT: number;
  /** The upper modes' level re the fundamental goes as force^soft. */
  soft: number;
  /** How long the beater or stick stays on the head at a full stroke (s); a softer stroke stays longer. */
  contact: number;
}

/** Spectrum of a half-sine push lasting `tc` seconds at `f` Hz, 1 at DC: the modes a long contact can't wake. */
const push = (f: number, tc: number) => {
  const x = 2 * f * tc;
  return abs(x - 1) < 1e-6 ? PI / 4 : abs(cos(PI * x / 2) / (1 - x * x));
};

/**
 * A drumhead: modes at the membrane's ratios (the shell's air pulls the lowest ones together), each ringing in
 * two stages, a burst that radiates the stroke away in the first tens of ms and then the ring. All of them sag
 * in pitch together as the tension the stroke added relaxes; that rise goes as the square of the stroke
 * (tension modulation). The beater or stick pushes the head for a moment rather than at an instant: the sound
 * swells in over that moment, and the modes too fast for it are barely woken. Each mode is a phasor turned
 * every sample, its turn updated every 32 as the pitch sags.
 */
class Head {
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly c: Float64Array;
  private readonly s: Float64Array;
  private readonly ring: Float64Array;
  private readonly fast: Float64Array;
  private readonly dRing: Float64Array;
  private readonly dFast: Float64Array;
  private readonly r: number[] = [];
  private readonly rise: number;
  private readonly onset: number;
  private j = 0;

  constructor(
    private readonly sr: number,
    private readonly f0: number,
    private readonly h: HeadSpec,
    f: number,
    t60 = h.t60,
  ) {
    const modes = h.modes.filter(([r]) => f0 * r * (1 + h.glide) < sr * 0.45);
    const n = modes.length;
    [this.x, this.y, this.c, this.s, this.ring, this.fast, this.dRing, this.dFast] = [0, 0, 0, 0, 0, 0, 0, 0].map(
      () => new Float64Array(n),
    );
    this.rise = h.glide * f * f;
    const tc = h.contact * f ** -0.2;
    this.onset = tc * sr;
    modes.forEach(([r, db], k) => {
      const a = 10 ** (db / 20) * (k ? f ** h.soft * push(f0 * r, tc) / push(f0, tc) : 1);
      this.r.push(r);
      this.x[k] = 1;
      this.ring[k] = a * (1 - h.burst);
      this.fast[k] = a * h.burst;
      this.dRing[k] = exp(-6.907755 / (t60 * r ** -h.fall * sr));
      this.dFast[k] = exp(-6.907755 / (h.burstT60 * sr));
    });
  }

  next(): number {
    const { x, y, c, s, ring, fast, dRing, dFast } = this;
    if ((this.j & 31) === 0) {
      const g = 1 + this.rise * exp(-(this.j + 16) / (this.sr * this.h.glideT));
      for (let k = 0; k < x.length; k++) {
        const w = (TAU * this.f0 * this.r[k] * g) / this.sr;
        c[k] = cos(w);
        s[k] = sin(w);
      }
    }
    this.j++;
    let out = 0;
    for (let k = 0; k < x.length; k++) {
      const xk = x[k] * c[k] - y[k] * s[k];
      y[k] = x[k] * s[k] + y[k] * c[k];
      x[k] = xk;
      ring[k] *= dRing[k];
      fast[k] *= dFast[k];
      out += y[k] * (ring[k] + fast[k]);
    }
    return this.j < this.onset ? out * sin((PI / 2) * (this.j / this.onset)) ** 2 : out;
  }

  /** The fundamental's amplitude, 1 at the stroke. */
  get level(): number {
    return this.ring[0] + this.fast[0];
  }

  /** Where the fundamental is in its swing, -1 to 1. */
  get swing(): number {
    return this.y[0];
  }
}

// Big Rusty Drums' 24" kick: the (0,1) mode and its twin on the resonant head, then the air-loaded upper modes.
const KICK_HEAD: HeadSpec = {
  modes: [[1, 0], [1.16, -10], [1.86, -4], [2.27, -9], [2.96, -6]],
  t60: 0.32,
  fall: 0.8,
  burst: 0.45,
  burstT60: 0.07,
  glide: 0.6,
  glideT: 0.022,
  soft: 0.7,
  contact: 0.006,
};

/** A kick drum on the key's tonic or fifth: the head's boom sagging onto its pitch, and the felt beater's slap. */
function acousticKick(b: Bus, e: E<'kick'>): void {
  const sr = b.sr;
  b.hit(
    `kick:acoustic:${e.n}`,
    e,
    0.9,
    (s) => {
      const f = force(s);
      const head = new Head(sr, b.hz(e.n) * s.tune, KICK_HEAD, f, KICK_HEAD.t60 * s.decay);
      const slap = new SVF(sr, 1200 + 3000 * f, 0.7);
      return (_j, u) => {
        const beater = slap.run(b.noise.next()) * exp(-u / 0.003);
        return (head.next() + 0.5 * beater) * 1.38;
      };
    },
    0,
    0.1,
  );
}

// A 14" snare tuned low and fat (VCSL's modern snare, Big Rusty Drums' 14"): nearly the ideal membrane's ratios,
// the bottom head's twin of the fundamental just above it.
const SNARE_HEAD: HeadSpec = {
  modes: [[1, 0], [1.17, -3], [1.6, 0], [2.13, -3], [2.51, -3], [2.71, -4], [3.2, -8], [3.76, -9], [4.2, -9]],
  t60: 0.38,
  fall: 0.5,
  burst: 0.35,
  burstT60: 0.05,
  glide: 0.06,
  glideT: 0.012,
  soft: 0.2,
  contact: 0.0015,
};

/**
 * A snare: the head, its modes above these so dense they are heard as a band of noise, the stick's tick, and the
 * wires rattling against the bottom head as it swings, until it swings too little to lift them. The buzz and the
 * tick saturate on a hard stroke, so a ghost note is the same head with more wire and stick in it: thinner, not
 * darker (as recorded, where it is also 20-25 dB under the backbeat).
 */
function acousticSnare(b: Bus, e: E<'snare'>): void {
  const sr = b.sr;
  b.hit(
    'snare:acoustic',
    e,
    0.9,
    (s) => {
      const f = force(s);
      const head = new Head(sr, 190 * s.tune, SNARE_HEAD, f, SNARE_HEAD.t60 * s.decay);
      const dense = new SVF(sr, 1000 * s.tune, 0.5);
      const darkDense = new SVF(sr, 2500, 0.6);
      const hp = new SVF(sr, 1000, 0.5);
      const lp = new SVF(sr, 6500 * s.bright, 0.6);
      const stick = new SVF(sr, 2500 * s.bright ** 2, 0.7);
      return (_j, u) => {
        const body = head.next();
        const level = head.level;
        dense.run(b.noise.next());
        hp.run(b.noise.next());
        const drive = max(0, sqrt(f * level) - 0.05) / f;
        // the wires are thrown off the bottom head and slap back, harder each swing: the buzz swells in after the
        // crack and peaks 25-50 ms after it
        const wires = lp.run(hp.hp) * drive * (0.6 + 0.4 * abs(head.swing)) * (1 - exp(-u / 0.015));
        const tick = stick.run(b.noise.next()) * exp(-u / 0.001) * f ** -0.3;
        const modes = darkDense.run(dense.bp) * level ** 0.7 * (1 - exp(-u / 0.001));
        return (body + 4.5 * modes + 0.9 * wires + 0.12 * tick) * 0.76;
      };
    },
    0,
    0.5,
  );
}

// Toms (Big Rusty Drums' 14", 15" and 18", VCSL's two): the air-loaded ratios measured on them.
const TOM_HEAD: HeadSpec = {
  modes: [[1, 0], [1.18, -14], [1.6, -18], [1.85, -8], [2.15, -12], [2.55, -15], [3.0, -18], [3.45, -22], [4.3, -16]],
  t60: 1.3,
  fall: 0.9,
  burst: 0.35,
  burstT60: 0.12,
  glide: 0.12,
  glideT: 0.04,
  soft: 0.85,
  contact: 0.002,
};

/**
 * A tom rings on its pitch, sagging into it after a hard stroke; lower toms ring longer. Above its modes, ones
 * too dense to tell apart are a band of noise, and the snare's wires buzz faintly with it, as on any kit. High
 * toms sit left, the floor tom right (the drummer's view).
 */
function acousticTom(b: Bus, e: E<'tom'>): void {
  const sr = b.sr;
  const f0 = b.hz(e.n);
  const t60 = min(1.8, max(0.8, 1.3 * (100 / f0) ** 0.3));
  b.hit(
    `tom:acoustic:${e.n}`,
    e,
    1.1 * t60 + 0.1,
    (s) => {
      const f = force(s);
      const head = new Head(sr, f0 * s.tune, TOM_HEAD, f, t60 * s.decay);
      const stick = new SVF(sr, 3000 * s.bright ** 2, 0.7);
      const dense = new SVF(sr, 7 * f0 * s.tune, 0.6);
      const dark = new SVF(sr, 2000 * s.bright, 0.6);
      const hp = new SVF(sr, 2000, 0.7);
      const lp = new SVF(sr, 6000, 0.7);
      return (j, u) => {
        const body = head.next();
        const level = head.level;
        // the higher of these modes die sooner: the band darkens as the head rings down
        if ((j & 63) === 0) dark.set(2000 * s.bright * (0.25 + 0.75 * level));
        dense.run(b.noise.next());
        const modes = dark.run(dense.bp) * level ** 0.9 * f ** 0.8 * (1 - exp(-u / 0.0015));
        const tick = stick.run(b.noise.next()) * exp(-u / 0.0015);
        hp.run(b.noise.next());
        const buzz = lp.run(hp.hp) * level * level;
        return (body + 1.5 * modes + 0.4 * tick + 0.004 * buzz) * 0.43;
      };
    },
    max(-0.4, min(0.5, 1.6 * log2(95 / f0))),
    0.35,
  );
}

// ------------------------------------------------------------------ bass

// Sub sine + its octave + a PolyBLEP saw through a low-pass, driven hard. A phone can't play the fundamental,
// so the overtones above 500 Hz and a 900 Hz growl are boosted: the ear rebuilds the line.
export function bass(b: Bus, e: E<'bass'>): void {
  const sr = b.sr;
  const dt = b.hz(e.n) / sr;
  let ps = 0;
  let pw = 0.5;
  if (e.k === 'heart') {
    return b.voice(e.t, 0.35, (_j, u) => {
      ps += (44 + 61 * exp(-30 * u)) / sr;
      return tanh(2.2 * sin(TAU * ps) * exp(-16 * u)) * e.v * 0.4 * min(1, u / 0.004);
    });
  }
  if (e.k === 'round') return round_(b, e);
  if (e.k === '808') return eight08(b, e);
  const sub = e.k === 'sub';
  const rolled = e.k === 'roll' || e.k === 'pulse';
  const rel = e.rel || (sub ? 0.3 : 0.015);
  const att = sub ? 0.05 : 0.004;
  const g = e.v * (sub ? 0.26 : rolled ? 0.25 : 0.21);
  const lp = new SVF(sr, 400, e.k === 'pulse' ? 1.6 : rolled ? 1.4 : 0.9);
  const top = new SVF(sr, rolled ? 3500 : 2800, 0.6);
  const hp = new SVF(sr, 500);
  const mid = new SVF(sr, 900, 0.8);
  b.voice(
    e.t,
    e.d + rel,
    (j, u) => {
      ps = (ps + dt) % 1;
      let x = sin(TAU * ps);
      if (!sub) {
        if ((j & 15) === 0) {
          lp.set(
            e.k === 'pulse'
              ? 450 * (1 + 4 * exp(-16 * u))
              : rolled
              ? 2000 * (1 + 2.5 * exp(-20 * u))
              : 600 * (1 + 1.5 * exp(-4 * u)),
          );
        }
        pw = (pw + dt) % 1;
        const s = top.run(tanh(4 * lp.run(saw(pw, dt))));
        hp.run(s);
        mid.run(s);
        x = (rolled ? 0.3 : 0.45) * x + (rolled ? 0.6 : 0.5) * sin(2 * TAU * ps) + 0.6 * s +
          (rolled ? 2.4 : 1.6) * hp.hp + 0.4 * mid.bp;
      }
      return x * g * min(1, u / att) * (u > e.d ? exp((-6.9 * (u - e.d)) / rel) : 1);
    },
    0,
    0,
    0,
    rolled ? 0.45 : 1,
  );
}

/** The 808: a sine that drops onto its note from a little above, rings long, and is saturated into overtones. */
function eight08(b: Bus, e: E<'bass'>): void {
  const f = b.hz(e.n);
  const rel = e.rel || 0.35;
  let ph = 0;
  b.voice(
    e.t,
    e.d + rel,
    (_j, u) => {
      ph += (f * (1 + 0.5 * exp(-u / 0.025))) / b.sr;
      const env = min(1, u / 0.002) * exp(-0.8 * u) * (u > e.d ? exp((-6.9 * (u - e.d)) / rel) : 1);
      return tanh(2.2 * sin(TAU * ph) * env) * e.v * 0.3;
    },
    0,
    0,
    0,
    0.6,
  );
}

/** Lo-fi bass: a round sine with a little second and third harmonic, gently driven, a thumb's attack. */
function round_(b: Bus, e: E<'bass'>): void {
  const rel = e.rel || 0.06;
  let ps = 0;
  b.voice(
    e.t,
    e.d + rel,
    (_j, u) => {
      ps = (ps + (b.hz(e.n) * b.wow(e.t + u)) / b.sr) % 1;
      const x = sin(TAU * ps) + 0.3 * sin(2 * TAU * ps) + 0.18 * sin(3 * TAU * ps) * exp(-9 * u);
      return tanh(1.3 * x) * e.v * 0.15 * min(1, u / 0.005) * exp(-0.9 * u) *
        (u > e.d ? exp((-6.9 * (u - e.d)) / rel) : 1);
    },
    0,
    0,
    0,
    0.6,
  );
}

// ------------------------------------------------------------------ keys and plucks

/** Two detuned saws and a low-pass that snaps shut; the ping-pong echoes do the rest. */
export function pluck(b: Bus, e: E<'pluck'>): void {
  const flt = new SVF(b.sr, e.cut, 1.3);
  const f = b.hz(e.n);
  const dec = 7.5 * (e.dec ?? 1);
  let p1 = b.noise.unit();
  let p2 = b.noise.unit();
  b.voice(
    e.t,
    min(2.5, 4.2 / dec + 0.1),
    (j, u) => {
      if ((j & 15) === 0) flt.set(min(5000, e.cut * (1 + 4 * exp(-26 * u))));
      const w = b.wow(e.t + u);
      const d1 = (f * 1.004 * w) / b.sr;
      const d2 = ((f / 1.004) * w) / b.sr;
      p1 = (p1 + d1) % 1;
      p2 = (p2 + d2) % 1;
      return flt.run(saw(p1, d1) + saw(p2, d2)) * e.v * 0.16 * exp(-dec * u) * min(1, u / 0.002);
    },
    e.p,
    0.2,
    0.35,
    0.3,
  );
}

/**
 * Electric piano after a Rhodes (Freesound tim.kahn Mark II, CC BY 4.0, measured): the tine is nearly a sine
 * with a long decay; the pickup's nonlinearity turns it into the familiar tone: a second and third harmonic
 * about 15 and 25 dB down at mf that fade two and three times faster than the fundamental (they go as its
 * square and cube), more of them the harder the key is struck (the bark). A faint inharmonic tine ping near
 * 7.5x rings for a moment.
 */
export function keys(b: Bus, e: E<'keys'>): void {
  const notes = e.n.slice().sort((x, y) => x - y);
  const v = min(1, max(0.05, e.v));
  const g = (0.22 * v) / sqrt(notes.length);
  const rel = 0.22;
  const d = 0.3 + 0.85 * v; // how far the tine swings past the pickup
  notes.forEach((m, k) => {
    const f = b.hz(m);
    const t0 = e.t + k * 0.009;
    const t60 = min(18, 16 * pow(262 / f, 0.35));
    const fall = exp(-6.907755 / (t60 * b.sr));
    const ping = new Modes(1);
    ping.add(f * 7.5, 0.03 * v, 0.15, b.sr);
    const done = exp(-1 / (rel * b.sr));
    let a = d;
    let ph = 0;
    let damper = 1;
    b.voice(
      t0,
      e.d + rel * 5,
      (_j, u) => {
        ph += (f * b.wow(t0 + u)) / b.sr;
        if (ph >= 1) ph -= 1;
        const x = sin(TAU * ph) * a;
        a *= fall;
        // asymmetric soft pickup curve: x + 0.4 x^2 - 0.3 x^3 (less the square's mean, so no DC)
        const y = (x + 0.4 * (x * x - 0.5 * a * a) - 0.3 * x * x * x) / d + ping.next();
        if (u > e.d) damper *= done;
        return y * damper * g * (1 + 0.1 * sin(TAU * 4.2 * (t0 + u)));
      },
      max(-0.5, min(0.5, (m - 62) / 30)),
      0.28,
      0.1,
      0.2,
    );
  });
}

// ------------------------------------------------------------------ supersaw pads

// Each note is `voices` saws spread ±detune cents across the stereo field, into a stereo low-pass gliding from
// cut[0] to cut[1] and a high-pass at hp Hz (the bass owns the roots). Strings add a slow vibrato per voice.
const PAD: Record<PadKind, readonly number[]> = {
  // voices, detune ¢, width, attack s, release s, decay /s, gain, reverb, delay, resonance, high-pass, vibrato ¢
  warm: [5, 12, 0.6, 0.35, 0.9, 0, 0.13, 0.3, 0, 0.9, 200, 0],
  wide: [7, 20, 1, 0.2, 0.6, 0, 0.13, 0.32, 0, 0.7, 250, 0],
  drop: [7, 24, 1, 0.008, 0.25, 0, 0.14, 0.22, 0.04, 0.7, 320, 0],
  stab: [7, 24, 1, 0.004, 0.3, 1.6, 0.16, 0.55, 0.1, 0.8, 150, 0],
  bloom: [7, 11, 1, 0.015, 2.5, 0.35, 0.14, 0.6, 0.12, 0.7, 150, 0],
  glass: [3, 7, 1, 1.2, 2.5, 0, 0.1, 0.6, 0.25, 0.7, 700, 0],
  strings: [5, 14, 0.9, 0.7, 1.4, 0, 0.14, 0.45, 0, 0.6, 180, 7],
};

export function pad(
  b: Bus,
  e: E<'pad'>,
  P: readonly number[] = PAD[e.k],
  oL = b.ML,
  oR = b.MR,
  duck = 1,
  send = true,
): void {
  const [nv, det0, w, at, r, dec, pg, rv, dl, q, hpf, vib] = P;
  const det = det0 * b.tone.detune;
  const sr = b.sr;
  const ph: number[] = [];
  const inc: number[] = [];
  const gl: number[] = [];
  const gr: number[] = [];
  const lfo: number[] = [];
  const g = (pg * (e.g || 1)) / sqrt(nv);
  e.n.forEach((m, k) => {
    for (let j = 0; j < nv; j++) {
      const x = nv > 1 ? (2 * j) / (nv - 1) - 1 : 0;
      const [a, bb] = pan(x * w * (k % 2 ? -1 : 1));
      inc.push((b.hz(m) * 2 ** ((x * det) / 1200)) / sr);
      ph.push(b.noise.unit());
      lfo.push(TAU * b.noise.unit());
      gl.push(a * g);
      gr.push(bb * g);
    }
  });
  const [c0, c1] = e.cut;
  const F = [c0, c0, hpf, hpf].map((c, k) => new SVF(sr, c, k < 2 ? q : 0.707));
  const i0 = round(e.t * sr);
  const on = e.d * sr;
  const rel = (e.rel || r) * sr;
  const len = min(oL.length - i0, round(on + rel));
  const cur = inc.slice();
  for (let j = 0; j < len; j++) {
    if ((j & 31) === 0) {
      const c = c0 * (c1 / c0) ** min(1, j / on);
      F[0].set(c);
      F[1].set(c);
      if (vib) {
        const t = j / sr;
        const depth = vib * smooth((t - 0.3) / 1.2);
        for (let k = 0; k < inc.length; k++) cur[k] = inc[k] * 2 ** ((depth * sin(TAU * 5.1 * t + lfo[k])) / 1200);
      }
    }
    let sl = 0;
    let sr_ = 0;
    for (let k = 0; k < ph.length; k++) {
      let p = ph[k] + cur[k];
      if (p >= 1) p -= 1;
      ph[k] = p;
      const s = saw(p, cur[k]);
      sl += s * gl[k];
      sr_ += s * gr[k];
    }
    F[2].run(F[0].run(sl));
    F[3].run(F[1].run(sr_));
    const i = i0 + j;
    const env = smooth(j / (at * sr)) * exp((-dec * j) / sr) * fall(j, on, rel);
    const d = env * (duck ? 1 - duck * (1 - b.duck[i]) : 1);
    oL[i] += F[2].hp * d;
    oR[i] += F[3].hp * d;
    if (send) {
      b.REV[i] += (F[2].hp + F[3].hp) * env * rv;
      b.DLY[i] += (F[2].hp + F[3].hp) * env * dl;
    }
  }
}

// ------------------------------------------------------------------ organ

// Pipe organ: the 16', 8', 5⅓', 4', 2⅔', 2', 1⅓', 1' ranks (harmonics 1 2 3 4 6 8 12 16 of the 16' pipe) summed
// into one wavetable; three detuned copies per pipe for the room's chorus, a slow tremulant; it barely pumps.
const ORGAN = (() => {
  const t = new Float32Array(2049);
  const ranks = [[1, 0.3], [2, 1], [3, 0.25], [4, 0.8], [6, 0.45], [8, 0.6], [12, 0.35], [16, 0.3]];
  for (let i = 0; i <= 2048; i++) for (const [h, a] of ranks) t[i] += (a * sin((TAU * h * i) / 2048)) / 2.43;
  return t;
})();

export function organ(b: Bus, e: E<'organ'>): void {
  const sr = b.sr;
  const ph: number[] = [];
  const inc: number[] = [];
  const pl: number[] = [];
  const pr: number[] = [];
  const lfo: number[] = [];
  const am = [0, 0, 0];
  for (const [c, p] of [[0, 0], [-5, -0.7], [5, 0.7]]) {
    const [a, bb] = pan(p);
    inc.push((b.hz(e.n - 12) * 2 ** (c / 1200)) / sr);
    ph.push(b.noise.unit());
    pl.push(a);
    pr.push(bb);
    lfo.push(6 * b.noise.unit());
  }
  const i0 = round(e.t * sr);
  const on = e.d * sr;
  const rel = (e.rel || 0.12) * sr;
  const len = min(b.n - i0, round(on + rel));
  const lpa = 1 - exp((-TAU * 7000) / sr);
  let ol = 0;
  let or = 0;
  for (let j = 0; j < len; j++) {
    const i = i0 + j;
    if ((j & 63) === 0) {
      // with swell: a sforzando on the attack, falling back, then growing across the note
      const u = j / sr;
      const dyn = 0.12 * (e.g || 1) *
        (e.swell ? 0.6 + 0.4 * smooth((u - 1) / max(1, e.d * 0.8)) + 0.4 * exp(-2.5 * u) : 1);
      for (let k = 0; k < 3; k++) am[k] = dyn * (1 + 0.07 * sin(TAU * 0.8 * (e.t + u) + lfo[k]));
    }
    let sl = 0;
    let srr = 0;
    for (let k = 0; k < 3; k++) {
      let p = ph[k] + inc[k];
      if (p >= 1) p -= 1;
      ph[k] = p;
      const x = p * 2048;
      const q = x | 0;
      const s = (ORGAN[q] + (ORGAN[q + 1] - ORGAN[q]) * (x - q)) * am[k];
      sl += s * pl[k];
      srr += s * pr[k];
    }
    ol += lpa * (sl - ol);
    or += lpa * (srr - or);
    const env = smooth(j / (e.att * sr)) * fall(j, on, rel);
    const d = env * (1 - 0.25 * (1 - b.duck[i]));
    b.ML[i] += ol * d;
    b.MR[i] += or * d;
    b.REV[i] += (ol + or) * env * 0.4;
  }
}

// ------------------------------------------------------------------ leads

// Monophonic lead over a phrase: notes glide (portamento), the filter envelope re-strikes on every note,
// vibrato blooms on long notes. A melody must not pump, so it ducks only 30 %.
interface LeadPatch {
  layers: readonly (readonly number[])[]; // [semitones, voices, detune ¢, gain, square?]
  a: number;
  fa: number;
  fd: number;
  cut: number;
  env: number;
  q: number;
  glide: number;
  vib: number;
  g: number;
  rv: number;
  dl: number;
}

const HOOK: LeadPatch = {
  layers: [[0, 5, 14, 1], [-12, 1, 0, 0.35, 1]],
  a: 0.004,
  fa: 0.002,
  fd: 5,
  cut: 1700,
  env: 4500,
  q: 1.1,
  glide: 0.02,
  vib: 0.25,
  g: 0.24,
  rv: 0.2,
  dl: 0.28,
};
const LEAD: Record<LeadKind, LeadPatch> = {
  hook: HOOK,
  hook2: { ...HOOK, layers: [...HOOK.layers, [12, 3, 10, 0.3]] }, // the answer adds an octave on top
  brass: {
    layers: [[0, 5, 10, 0.8], [12, 3, 8, 0.45]],
    a: 0.05,
    fa: 0.16,
    fd: 1.6,
    cut: 800,
    env: 3000,
    q: 0.8,
    glide: 0.06,
    vib: 0.18,
    g: 0.3,
    rv: 0.4,
    dl: 0.1,
  },
  flute: {
    layers: [[0, 1, 0, 0.9, 1], [12, 1, 0, 0.12]],
    a: 0.03,
    fa: 0.05,
    fd: 3,
    cut: 900,
    env: 1100,
    q: 0.6,
    glide: 0.05,
    vib: 0.3,
    g: 0.17,
    rv: 0.35,
    dl: 0.25,
  },
  saw: {
    layers: [[0, 3, 12, 1], [-12, 1, 0, 0.3, 1]],
    a: 0.01,
    fa: 0.01,
    fd: 3,
    cut: 1400,
    env: 3000,
    q: 1,
    glide: 0.04,
    vib: 0.35,
    g: 0.22,
    rv: 0.3,
    dl: 0.38,
  },
};

export function lead(b: Bus, e: E<'lead'>): void {
  const P = LEAD[e.k];
  const ns = e.ns;
  if (!ns.length) return;
  const sr = b.sr;
  const V: number[][] = [];
  for (const [semi, n, det, g, sq] of P.layers) {
    for (let j = 0; j < n; j++) {
      const x = n > 1 ? (2 * j) / (n - 1) - 1 : 0;
      const [a, bb] = pan(x * 0.5);
      const gg = (g * P.g) / sqrt(n);
      V.push([2 ** ((semi + (x * det) / 100) / 12), a * gg, bb * gg, sq ?? 0, b.noise.unit(), 0]); // ratio, gains, square?, phase, inc
    }
  }
  const vibDepth = P.vib * b.tone.vibrato;
  const cut = P.cut * b.tone.bright;
  const fl = new SVF(sr, cut, P.q);
  const fr = new SVF(sr, cut, P.q);
  const last = ns[ns.length - 1];
  const i0 = round(ns[0].t * sr);
  const i1 = min(b.n, round((last.t + last.d + 0.4) * sr));
  const kg = 1 - exp(-16 / (P.glide * sr));
  const ka = 1 - exp(-1 / (P.a * sr));
  const kr = 1 - exp(-1 / (0.02 * sr));
  let k = 0;
  let pitch = ns[0].n;
  let amp = 0;
  for (let i = i0; i < i1; i++) {
    const t = i / sr;
    while (k + 1 < ns.length && t >= ns[k + 1].t) k++;
    const nt = ns[k];
    const u = t - nt.t;
    const on = u < nt.d * 0.92;
    if (((i - i0) & 15) === 0) {
      pitch += (nt.n - pitch) * kg;
      const f = (b.hz(pitch + vibDepth * smooth((u - 0.2) / 0.3) * sin(TAU * 5.4 * t)) * b.wow(t)) / sr;
      const c = cut + P.env * nt.v * (1 - exp(-u / P.fa)) * exp(-u * P.fd);
      for (const v of V) v[5] = f * v[0];
      fl.set(c);
      fr.set(c);
    }
    amp += ((on ? nt.v : 0) - amp) * (on ? ka : kr);
    let sl = 0;
    let srr = 0;
    for (const v of V) {
      let p = v[4] + v[5];
      if (p >= 1) p -= 1;
      v[4] = p;
      const s = saw(p, v[5]) - (v[3] ? saw(p >= 0.5 ? p - 0.5 : p + 0.5, v[5]) : 0); // square = saw minus shifted saw
      sl += s * v[1];
      srr += s * v[2];
    }
    const yl = fl.run(sl) * amp;
    const yr = fr.run(srr) * amp;
    const d = 1 - 0.3 * (1 - b.duck[i]);
    b.ML[i] += yl * d;
    b.MR[i] += yr * d;
    b.REV[i] += (yl + yr) * P.rv;
    b.DLY[i] += (yl + yr) * P.dl;
  }
}

// ------------------------------------------------------------------ transitions and textures

// Impact: a boom (a sine falling onto D1) + a noise crash that closes down + a chord stab that bypasses the
// pump: the stab is the part of a downbeat a phone speaker can actually play.
const IMPACT = {
  // boom gain, boom start Hz, boom decay /s, crash gain, crash decay /s
  ping: [0.35, 70, 2.2, 0, 1],
  hit: [1, 110, 1.7, 0.6, 2.4],
  soft: [0.6, 95, 2.2, 0.45, 3],
  drop: [0.25, 120, 5, 0.8, 2],
  cosmic: [0.4, 90, 2.2, 0.8, 0.9],
  final: [0.8, 85, 2.2, 0.5, 0.8],
} as const;

export function impact(b: Bus, e: E<'impact'>): void {
  const [bg, f0, bd, cg, cd] = IMPACT[e.k];
  const d1 = b.hz(26);
  let ph = 0;
  b.voice(
    e.t,
    5.5,
    (_j, u) => {
      ph += (d1 + (f0 - d1) * exp(-7 * u)) / b.sr;
      return tanh(1.6 * sin(TAU * ph)) * bg * 0.55 * e.a * exp(-bd * u) * min(1, u / 0.003);
    },
    0,
    0.05,
  );
  if (cg) {
    for (const p of [-0.8, 0.8]) {
      const hp = new SVF(b.sr, 350);
      const lp = [new SVF(b.sr, 14000), new SVF(b.sr, 14000)];
      b.voice(
        e.t,
        5.5,
        (j, u) => {
          if ((j & 31) === 0) {
            const c = 3500 + 11000 * exp(-1.2 * u);
            lp[0].set(c);
            lp[1].set(c);
          }
          hp.run(b.noise.next());
          return lp[1].run(lp[0].run(hp.hp)) * cg * 0.32 * e.a * exp(-cd * u) * smooth(u / 0.008);
        },
        p,
        0.5,
      );
    }
  }
  if (e.n) {
    pad(b, { i: 'pad', t: e.t, d: 0.35, n: e.n, k: 'stab', cut: [9000, 1400], g: 1.5 * e.a }, PAD.stab, b.L, b.R, 0);
  }
}

/** A chord played into its own reverb, recorded and flipped: the tail swells up into the downbeat. */
function reverseSwell(b: Bus, tEnd: number, d: number, n: number[], g: number): void {
  const len = round(d * b.sr);
  const [tl, tr, wl, wr] = [0, 0, 0, 0].map(() => new Float32Array(len));
  const i1 = round(tEnd * b.sr);
  pad(b, { i: 'pad', t: 0, d: 0.15, n, k: 'stab', cut: [5000, 2500] }, PAD.stab, tl, tr, 0, false);
  for (let j = 0; j < len; j++) tl[j] += tr[j];
  freeverb(b.sr, tl, wl, wr, 0.93, 1);
  for (let j = 0; j < len; j++) {
    const i = i1 - len + j;
    const w = g * min(1, (len - j) / (0.003 * b.sr));
    if (i >= 0 && i < b.n) {
      b.L[i] += wl[len - 1 - j] * w;
      b.R[i] += wr[len - 1 - j] * w;
    }
  }
}

// Risers: band-passed noise sweeping 250 Hz -> 9 kHz + a detuned saw chord gliding up. Each dips in its last
// 0.3 s: the drop must be louder than the build, or it isn't a drop.
const RISE: Record<Exclude<RiseKind, 'swell' | 'cymbal'>, readonly number[]> = {
  // tone from, to (MIDI), noise, tone
  sweep: [48, 72, 0.35, 0.25],
  build: [50, 86, 0.8, 0.55],
};

export function riser(b: Bus, e: E<'rise'>): void {
  const d = e.d;
  if (e.k === 'swell') {
    if (e.n?.length) reverseSwell(b, e.t + d, d, e.n, 1.2);
    return;
  }
  if (e.k === 'cymbal') {
    // a crash played backwards: high-passed noise whose decay runs in reverse
    for (const p of [-0.7, 0.7]) {
      const hp = new SVF(b.sr, 4600, 0.8);
      b.voice(e.t, d, (_j, u) => (hp.run(b.noise.next()), hp.hp * 0.08 * exp((u - d) * 3.2)), p, 0.3);
    }
    return;
  }
  // where along the whole riser this moment is: a build that spans several sections plays one riser in parts
  const x0 = e.x0 ?? 0;
  const x1 = e.x1 ?? 1;
  const at = (u: number) => x0 + ((x1 - x0) * u) / d;
  const dip = (u: number) => at(u) ** 2 * (x1 < 1 ? 1 : 1 - 0.45 * smooth((u - d + 0.3) / 0.3));
  const [m0, m1, ng, tg] = RISE[e.k];
  const ph = [0.1, 0.4, 0.7];
  const lp = new SVF(b.sr, 300, 0.8);
  for (const p of [-0.7, 0.7]) {
    const bp = new SVF(b.sr, 250, 2);
    b.voice(
      e.t,
      d,
      (j, u) => {
        if ((j & 31) === 0) bp.set(250 * 36 ** at(u) * (p > 0 ? 1.12 : 1));
        bp.run(b.noise.next());
        return bp.bp * ng * 0.22 * dip(u);
      },
      p,
      0.3,
    );
  }
  let f = 0;
  b.voice(
    e.t,
    d,
    (j, u) => {
      if ((j & 31) === 0) {
        f = b.hz(m0 + (m1 - m0) * at(u) ** 1.5) / b.sr;
        lp.set(min(9000, 175 * 36 ** at(u) + 300));
      }
      let s = 0;
      for (let v = 0; v < 3; v++) {
        ph[v] = (ph[v] + f * (1 + 0.006 * (v - 1))) % 1;
        s += saw(ph[v], f);
      }
      return lp.run(s) * tg * 0.3 * dip(u);
    },
    0,
    0.4,
  );
}

/** A drone on the tonic with a softly beating octave, fading in from nothing. */
export function drone(b: Bus, e: E<'drone'>): void {
  const w = (TAU * b.hz(e.n)) / b.sr;
  for (const s of [-1, 1]) {
    b.voice(
      e.t,
      e.d,
      (j, u) =>
        (0.7 * sin(w * j) + 0.1 * sin(3.003 * w * j) + 0.28 * sin((2 + 0.004 * s) * w * j)) * 0.05 * smooth(u / 2.5) *
        smooth((e.d - u) / 1.5),
      s,
    );
  }
}

/** Vinyl: a bed of filtered hiss and random crackles, some louder pops. Straight to the main bus, no room. */
export function vinyl(b: Bus, e: E<'vinyl'>): void {
  const amt = b.tone.crackle;
  if (!amt) return;
  const sr = b.sr;
  const i0 = round(e.t * sr);
  const len = min(b.n - i0, round(e.d * sr));
  const hiss = [new SVF(sr, 5200), new SVF(sr, 5200)];
  const hhp = [new SVF(sr, 900), new SVF(sr, 900)];
  const click = new SVF(sr, 3000, 1.6);
  const rate = (7 * amt) / sr;
  let cl = 0.5;
  let cr = 0.5;
  for (let j = 0; j < len; j++) {
    const i = i0 + j;
    const fade = min(1, j / (0.02 * sr), (len - j) / (0.02 * sr));
    hhp[0].run(hiss[0].run(b.noise.next()));
    hhp[1].run(hiss[1].run(b.noise.next()));
    let imp = 0;
    if (b.noise.unit() < rate) {
      const big = b.noise.unit();
      imp = (0.25 + 0.75 * big ** 4) * (b.noise.next() < 0 ? -1 : 1);
      click.set(big > 0.9 ? 900 : 1800 + 4000 * b.noise.unit(), 1.6);
      cl = 0.2 + 0.6 * b.noise.unit();
      cr = 1 - cl;
    }
    click.run(imp);
    const c = click.bp * 0.09 * amt;
    b.L[i] += (hhp[0].hp * 0.012 * amt + c * cl) * fade;
    b.R[i] += (hhp[1].hp * 0.012 * amt + c * cr) * fade;
  }
}

/** The pump: a gain curve that dips 3 ms before each kick (by its sc) and swells back over 0.3 s. */
export function sidechain(b: Bus, kicks: E<'kick'>[]): Float32Array {
  const sr = b.sr;
  const G = new Float32Array(b.n).fill(1);
  const pre = round(0.003 * sr);
  for (const k of kicks) {
    for (let j = 0, i0 = round(k.t * sr) - pre; j < 0.34 * sr && i0 + j < b.n; j++) {
      if (i0 + j < 0) continue;
      const u = (j - pre) / sr;
      const duck = u < 0 ? j / pre : u < 0.02 ? 1 : 0.5 + 0.5 * Math.cos(PI * min(1, (u - 0.02) / 0.3));
      G[i0 + j] = min(G[i0 + j], 1 - k.sc * duck);
    }
  }
  return G;
}

// ------------------------------------------------------------------ strings pad

/**
 * The 'strings' pad as a section: five saws a note as before, but each player bows with their own vibrato rate
 * (4.8-6 Hz, 12 cents; the section average measures ~5 cents) and pitch wander; bow noise under the tone (a
 * recorded violin section sits ~30 dB under its harmonics below 2 kHz); the violin body's bridge hill (+6 dB near
 * 2.5 kHz) after the low-pass, so high notes keep their 2-4 kHz edge; and a 0.35 s onset (sections: 0.16-0.29 s).
 */
export function strings(b: Bus, e: E<'pad'>): void {
  const nv = 5;
  const det = 14 * b.tone.detune;
  const sr = b.sr;
  const V: { ph: number; inc: number; l: number; r: number; lfo: number; rate: number; w: Wander }[] = [];
  const g = (0.116 * (e.g || 1)) / sqrt(nv);
  const kw = 1 - exp((-TAU * 1.2 * 32) / sr);
  e.n.forEach((m, k) => {
    for (let j = 0; j < nv; j++) {
      const x = (2 * j) / (nv - 1) - 1;
      const [a, bb] = pan(x * 0.9 * (k % 2 ? -1 : 1));
      V.push({
        ph: b.noise.unit(),
        inc: (b.hz(m) * 2 ** ((x * det) / 1200)) / sr,
        l: a * g,
        r: bb * g,
        lfo: TAU * b.noise.unit(),
        rate: 4.8 + 1.2 * b.noise.unit(),
        w: new Wander(kw),
      });
    }
  });
  const [c0, c1] = e.cut;
  const F = [c0, c0, 180, 180].map((c, k) => new SVF(sr, c, k < 2 ? 0.6 : 0.707));
  const hill = [new SVF(sr, 2500, 1), new SVF(sr, 2500, 1)];
  const bow = [new SVF(sr, 1800, 0.3), new SVF(sr, 1800, 0.3)];
  // the low-pass opens for high chords: a violin section's E5 keeps its harmonics flat to ~3.3 kHz
  const track = min(2, max(1, (b.hz(max(...e.n)) / 392) ** 0.7));
  const i0 = round(e.t * sr);
  const on = e.d * sr;
  const rel = (e.rel || 1.4) * sr;
  const len = min(b.ML.length - i0, round(on + rel));
  const cur = V.map((v) => v.inc);
  for (let j = 0; j < len; j++) {
    if ((j & 31) === 0) {
      const c = c0 * (c1 / c0) ** min(1, j / on) * track;
      F[0].set(c);
      F[1].set(c);
      const t = j / sr;
      const depth = 12 * smooth((t - 0.2) / 0.8);
      for (let k = 0; k < V.length; k++) {
        const v = V[k];
        cur[k] = v.inc * 2 ** ((depth * sin(TAU * v.rate * t + v.lfo) + 4 * v.w.next(b.noise.next())) / 1200);
      }
    }
    let sl = 0;
    let sr_ = 0;
    for (let k = 0; k < V.length; k++) {
      const v = V[k];
      let p = v.ph + cur[k];
      if (p >= 1) p -= 1;
      v.ph = p;
      const s = saw(p, cur[k]);
      sl += s * v.l;
      sr_ += s * v.r;
    }
    // bow noise: rosin on the strings, a broad band around 1.8 kHz, as loud as the section is
    bow[0].run(b.noise.next());
    bow[1].run(b.noise.next());
    const nz = 0.06 * g * sqrt(e.n.length * nv);
    F[2].run(F[0].run(sl + bow[0].bp * nz));
    F[3].run(F[1].run(sr_ + bow[1].bp * nz));
    hill[0].run(F[2].hp);
    hill[1].run(F[3].hp);
    const yl = F[2].hp + hill[0].bp;
    const yr = F[3].hp + hill[1].bp;
    const i = i0 + j;
    const env = smooth(j / (0.35 * sr)) * (j > on ? exp((-6.9 * (j - on)) / rel) : 1);
    const d = env * b.duck[i];
    b.ML[i] += yl * d;
    b.MR[i] += yr * d;
    b.REV[i] += (yl + yr) * env * 0.45;
  }
}
