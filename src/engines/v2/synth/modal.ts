// Struck things, built from their modes: each is a handful of decaying sine partials at the ratios its
// physical shape rings at (a marimba bar, a vibraphone bar, a kalimba tine, a felt-hammered piano string),
// plus a short noise burst for the strike. Hand drums and metal percussion live here too.

import type { Ev, MalletKind } from '../types.ts';
import type { Bus } from './bus.ts';
import { SVF, TAU } from './dsp.ts';

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;
const { exp, sin, cos, min, max, sqrt, pow } = Math;

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

// ------------------------------------------------------------------ mallets

interface MalletModel {
  ratios: number[];
  amps: number[];
  /** Seconds for the fundamental to fall ~8.7 dB at middle C; partials decay faster by `decays`. */
  decay: number;
  decays: number[];
  /** Vibraphone motor: amplitude tremolo depth. */
  trem: number;
  click: number;
  gain: number;
}

const MALLET: Record<MalletKind, MalletModel> = {
  // a marimba bar is undercut so its overtones sit near 4x and 10x
  marimba: {
    ratios: [1, 3.99, 9.14],
    amps: [1, 0.3, 0.1],
    decay: 0.55,
    decays: [1, 0.35, 0.15],
    trem: 0,
    click: 0.5,
    gain: 0.24,
  },
  vibes: {
    ratios: [1, 3.98, 9.4],
    amps: [1, 0.2, 0.05],
    decay: 1.8,
    decays: [1, 0.4, 0.2],
    trem: 0.35,
    click: 0.2,
    gain: 0.19,
  },
  // a tine: strongly inharmonic, a bright ping that dies fast over a fundamental that hangs on
  kalimba: {
    ratios: [1, 5.4, 11.3],
    amps: [1, 0.28, 0.14],
    decay: 1,
    decays: [1, 0.12, 0.06],
    trem: 0,
    click: 0.7,
    gain: 0.2,
  },
};

export function mallet(b: Bus, e: E<'mallet'>): void {
  const m = MALLET[e.k];
  const sr = b.sr;
  const f = b.hz(e.n);
  const tau = min(4, max(0.12, m.decay * pow(262 / f, 0.5)));
  // each partial decays exponentially: a running gain times a per-sample factor, instead of exp() per sample
  const parts: { osc: Partial; env: number; fall: number }[] = [];
  m.ratios.forEach((r, k) => {
    if (f * r < sr * 0.42) {
      parts.push({ osc: new Partial(f * r, sr), env: m.amps[k], fall: exp(-1 / (tau * m.decays[k] * sr)) });
    }
  });
  const click = new SVF(sr, min(6000, 3 * f), 1.5);
  const g = m.gain * e.v;
  const knock = exp(-1 / (0.003 * sr));
  let tick = m.click;
  let wobble = 1;
  b.voice(
    e.t,
    min(5, tau * 4.6), // until the fundamental is 40 dB down
    (j, u) => {
      let s = 0;
      for (const p of parts) {
        s += p.osc.next() * p.env;
        p.env *= p.fall;
      }
      if (m.trem) {
        // the motor's wobble is slow: refreshed every 32 samples
        if ((j & 31) === 0) wobble = 1 - m.trem * 0.5 * (1 - cos(TAU * 5.5 * u));
        s *= wobble;
      }
      // the strike is over in a few milliseconds; after that only the bar rings
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

// ------------------------------------------------------------------ felt piano

/**
 * A soft, felt-hammered piano: ten partials stretched by the string's stiffness (inharmonicity grows up
 * the keyboard), each decaying in two stages (a prompt sound, then a long aftersound), the lowest two
 * doubled by a slightly detuned second string so they beat. The damper falls when the key is released.
 */
export function piano(b: Bus, e: E<'piano'>): void {
  const sr = b.sr;
  const notes = e.n.slice().sort((x, y) => x - y);
  const strum = e.strum ?? 0.012;
  notes.forEach((m, idx) => {
    const f = b.hz(m);
    const B = 0.00008 * pow(2, (m - 48) / 18);
    const tau0 = min(8, max(0.8, 3.8 * pow(262 / f, 0.6)));
    const dark = 0.38 - 0.22 * e.v; // a harder strike reaches further up the partials
    // prompt sound and aftersound per partial, each an exponential kept as a running gain
    const parts: { osc: Partial; a: number; b: number; fa: number; fb: number }[] = [];
    const add = (fk: number, amp: number, tau: number, phase: number) =>
      parts.push({
        osc: new Partial(fk, sr, phase),
        a: 0.7 * amp,
        b: 0.3 * amp,
        fa: exp(-1 / (0.22 * tau * sr)),
        fb: exp(-1 / (tau * sr)),
      });
    for (let k = 1; k <= 10; k++) {
      const fk = k * f * sqrt(1 + B * k * k);
      if (fk > sr * 0.4) break;
      const amp = pow(k, -1.1) * exp(-(k - 1) * dark);
      const tau = tau0 / (1 + 0.55 * (k - 1));
      add(fk, amp, tau, k);
      if (k <= 2) add(fk * 1.0005, amp * 0.6, tau, k + 1);
    }
    const thump = new SVF(sr, 1800, 0.7);
    const t0 = e.t + idx * strum;
    const g = (0.19 * e.v) / sqrt(notes.length);
    const rel = 0.22;
    const damp = exp(-1 / (rel * sr));
    const knock = exp(-1 / (0.006 * sr));
    let damper = 1;
    let hammer = 0.25;
    b.voice(
      t0,
      e.d + rel * 4,
      (_j, u) => {
        let s = 0;
        for (const p of parts) {
          s += p.osc.next() * (p.a + p.b);
          p.a *= p.fa;
          p.b *= p.fb;
        }
        if (u > e.d) damper *= damp;
        thump.run(b.noise.next());
        hammer *= knock;
        return (s * damper + thump.bp * hammer) * g;
      },
      panFor(m, 0.4),
      0.3,
      0.05,
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
          const lp = new SVF(sr, 14000, 0.6);
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
            return (body * exp(-u * (crash ? 1.4 : 2.6)) * min(1, u / 0.002) + bell) * (crash ? 0.26 : 0.16);
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
