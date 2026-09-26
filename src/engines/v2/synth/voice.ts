// Two voices built on filters: a choir (detuned saws through the formants of a sung vowel) and an acid
// line (one saw or square through a resonant low-pass whose envelope snaps on every note, as on a TB-303).

import { hash32, Rng } from '../rng.ts';
import type { Ev, Note, Vowel } from '../types.ts';
import type { Bus } from './bus.ts';
import { Noise, pan, saw, smooth, SVF, TAU, Wander } from './dsp.ts';

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;
const { exp, sin, cos, min, max, sqrt, round, log2, floor, tanh } = Math;

// ------------------------------------------------------------------ breath-driven harmonic voice

type Env = readonly (readonly number[])[];

/**
 * Spectral envelopes in dB at 1/3-octave points 100 * 2^((i - 1) / 3) Hz (79 Hz .. 12.7 kHz), one per dynamic, soft
 * to loud: least-squares fits of the harmonic levels of recorded notes (per-note error 1-5 dB). Each harmonic takes
 * the envelope's level at its frequency, so resonances stay put in Hz as the pitch moves, and the spectrum
 * brightens with the breath as the envelopes are blended by loudness.
 */
const ENV: Record<'sax' | 'flute' | 'brass' | 'brassLow' | 'hum', Env> = {
  // alto sax (Iowa MIS, C4-B4 pp/mf/ff, Db3-B3 mf): body peak 250-400 Hz, a shelf at 1-2.5 kHz rising with the breath
  sax: [
    [-11, -8, -6, -3, 0, 0, 0, -3, -9, -17, -24, -28, -33, -37, -43, -46, -49, -52, -54, -55, -56, -57, -58],
    [-12, -9, -7, -4, -1, -1, -1, 0, -3, -9, -15, -18, -19, -22, -26, -26, -32, -42, -45, -45, -48, -50, -53],
    [-11, -8, -6, -3, 0, 0, 0, -2, -5, -11, -15, -15, -16, -18, -21, -22, -27, -36, -40, -41, -45, -48, -51],
  ],
  // flute (Iowa MIS, C5-B5 pp/mf/ff, B3-B4 mf): nearly a sine when soft, harmonics up to ~2 kHz when loud
  flute: [
    [0, -1, -2, -3, -4, -5, -6, -7, -8, -13, -19, -26, -31, -34, -39, -48, -59, -70, -80, -91, -102, -112, -123],
    [0, -1, -2, -3, -4, -5, -6, -7, -8, -10, -12, -15, -16, -19, -24, -32, -40, -46, -50, -55, -57, -57, -54],
    [0, -1, -2, -3, -4, -5, -6, -7, -8, -10, -8, -7, -8, -12, -18, -25, -33, -38, -43, -48, -52, -52, -51],
  ],
  // Bb trumpet (Iowa MIS, C4-B4 pp/mf/ff, C5-B5 mf): weak fundamental, the bell's formant at 1-1.3 kHz, a high
  // slope that flattens by ~20 dB at 4 kHz from pp to ff
  brass: [
    [-43, -39, -34, -29, -25, -20, -16, -11, -9, -8, -5, -2, 0, -4, -15, -28, -40, -49, -56, -63, -69, -76, -83],
    [-43, -39, -34, -29, -25, -20, -16, -12, -10, -9, -7, -3, 0, -2, -7, -12, -18, -27, -35, -44, -54, -63, -70],
    [-44, -40, -35, -30, -26, -21, -17, -12, -9, -7, -4, -1, 0, -1, -5, -10, -15, -22, -30, -38, -49, -61, -73],
  ],
  // tenor trombone (Iowa MIS, C3-B3 mf; pp and ff take the trumpet's dynamic change an octave down): the formant
  // at 0.5-0.8 kHz, more fundamental
  brassLow: [
    [-4, -5, -6, -6, -7, -6, -3, -1, 0, 0, -2, -11, -22, -33, -38, -45, -52, -59, -67, -75, -83, -91, -99],
    [-4, -5, -6, -6, -7, -6, -3, -1, 0, 0, 0, -3, -6, -11, -16, -24, -33, -44, -54, -62, -70, -78, -86],
    [-6, -7, -8, -8, -9, -7, -3, 0, 0, -2, -1, -3, -6, -10, -13, -21, -29, -41, -54, -64, -72, -80, -88],
  ],
  // hummed /m/ (a solo voice, C4 D4 A3, Freesound CC0): the nasal murmur below 350 Hz, the anti-resonance at
  // 0.6-1 kHz, and a faint nasal buzz up to 4 kHz
  hum: [
    [0, 0, 0, 0, 0, 0, -3, -12, -25, -38, -45, -46, -44, -42, -44, -49, -51, -52, -54, -56, -57, -57, -57],
  ],
};
const G0 = log2(100) - 1 / 3; // log2 of the first envelope point
/**
 * Signs of harmonics 1..48 for reed, flute and voice: all cosines in phase make a pulse (crest factor 3-4.5) where the
 * recordings measure 1.5-2.4; this fixed pattern (a random search over 0/180 degree phases) gives 1.5-2.
 */
const SIGNS = [...'++---++---++--++--+-+++---+-++--++-+++-+-++-++-+'].map((c) => (c === '+' ? 1 : -1));

interface Breath {
  env: Env;
  /** From `low[1]` Hz down to `low[2]` Hz the envelopes blend into `low[0]` (a bigger instrument of the family). */
  low?: readonly [Env, number, number];
  /** Breath level each envelope belongs to (the note velocity that sounds like it). */
  dyn: readonly number[];
  /** Time constant (s) of the brightness following the breath: brass builds its upper partials late. */
  bright: number;
  /** Attack time constant (s): att[0] + att[1] * (1 - v)^2, soft notes speak slower. */
  att: readonly [number, number];
  /** The last bloom[0] * (1.2 - v) of a fresh note's level grows with time constant bloom[1] s (brass). */
  bloom: readonly [number, number];
  rel: number;
  /** Legato glide time constant (s). */
  glide: number;
  /** A fresh note (after a rest) starts scoop[0] + scoop[2] * (v - 0.7) cents flat and settles with time constant
   * scoop[1] s: brass lips settle from far off when soft, a sax is pushed flat when loud. */
  scoop: readonly [number, number, number];
  /** Vibrato: rate Hz, depth cents, amplitude depth (fraction), onset s, ramp s. */
  vib: readonly [number, number, number, number, number];
  /** Slow pitch wander, cents rms. */
  drift: number;
  /** A long note (over 0.8 s) swells: it starts this much under its level and ends this much over it, halved. */
  swell: number;
  /** Breath noise: band-pass Hz and Q, high-pass Hz, low-pass Hz, rms re the tone, pitch-synchronous depth. */
  noise: readonly [number, number, number, number, number, number];
  /** The noise grows as (level / 0.7)^noiseDyn against the tone: a soft flute or trumpet is less breathy. */
  noiseDyn: number;
  /** Onset noise (tongue, chiff): rms re the tone at full velocity, decay time constant s. */
  burst: readonly [number, number];
  /** Seconds the tone takes to form at a fresh onset, after the air (flute jet, lip buzz). */
  lag: number;
  /** Phases: false keeps every harmonic in cosine phase (the brass lip pulse), true spreads them (SIGNS). */
  spread: boolean;
  /** Tonguing between joined notes: the tone stops tongue[0] s before the next one with release time constant
   * tongue[1] s; the next note gets tongue[2] of a fresh note's burst. 0 gap: slur everything. */
  tongue: readonly [number, number, number];
  g: number;
  rv: number;
  dl: number;
}

const BREATH: Record<'sax' | 'flute' | 'hum' | 'brass', Breath> = {
  sax: {
    env: ENV.sax,
    dyn: [0.4, 0.7, 1],
    bright: 0.012,
    att: [0.012, 0.12],
    bloom: [0, 1],
    rel: 0.07,
    glide: 0.012,
    scoop: [5, 0.03, 30],
    vib: [4.8, 9, 0.04, 0.35, 0.45],
    drift: 1.5,
    swell: 0.25,
    noise: [1600, 0.6, 400, 9000, 0.012, 0.6],
    noiseDyn: 0,
    burst: [0.12, 0.02],
    lag: 0,
    tongue: [0.02, 0.008, 0.5],
    spread: true,
    g: 0.1,
    rv: 0.3,
    dl: 0.15,
  },
  flute: {
    env: ENV.flute,
    dyn: [0.4, 0.7, 1],
    bright: 0.012,
    att: [0.045, 0.03],
    bloom: [0, 1],
    rel: 0.06,
    glide: 0.015,
    scoop: [8, 0.08, 0],
    vib: [4.8, 13, 0.2, 0.3, 0.4],
    drift: 1.4,
    swell: 0.2,
    noise: [2000, 0.5, 250, 16000, 0.025, 0.4],
    noiseDyn: 1,
    burst: [0.3, 0.02],
    lag: 0.03,
    tongue: [0.03, 0.01, 0.5],
    spread: true,
    g: 0.12,
    rv: 0.4,
    dl: 0.22,
  },
  hum: {
    env: ENV.hum,
    dyn: [0.7],
    bright: 0.02,
    att: [0.01, 0.03],
    bloom: [0, 1],
    rel: 0.07,
    glide: 0.03,
    scoop: [10, 0.04, 0],
    vib: [5, 22, 0.18, 0.1, 0.3],
    drift: 2,
    swell: 0.15,
    noise: [600, 0.35, 200, 6000, 0.012, 0.5],
    noiseDyn: 0,
    burst: [0.2, 0.01],
    lag: 0,
    tongue: [0.04, 0.02, 0.3],
    spread: true,
    g: 0.13,
    rv: 0.45,
    dl: 0.22,
  },
  brass: {
    env: ENV.brass,
    low: [ENV.brassLow, 330, 196],
    dyn: [0.4, 0.7, 1],
    bright: 0.06,
    att: [0.008, 0.03],
    bloom: [0.6, 0.1],
    rel: 0.06,
    glide: 0.02,
    scoop: [42, 0.035, -70],
    vib: [5, 5, 0.03, 0.4, 0.4],
    drift: 1.5,
    swell: 0.35,
    noise: [1400, 1.4, 600, 3000, 0.02, 0.7],
    noiseDyn: 1,
    burst: [0.5, 0.01],
    lag: 0.02,
    tongue: [0.02, 0.008, 0.5],
    spread: false,
    g: 0.088,
    rv: 0.4,
    dl: 0.1,
  },
};

/** The breath-noise filters (band-pass, high-pass, low-pass in series), scaled to unit rms for white noise. */
class Air {
  private readonly f: SVF[];
  readonly norm: number;
  constructor(sr: number, [bp, q, hp, lp]: Breath['noise']) {
    this.f = [new SVF(sr, bp, q), new SVF(sr, hp, 0.7), new SVF(sr, lp, 0.7)];
    const n = new Noise(0x5eed);
    let s = 0;
    const warm = 2048;
    for (let i = 0; i < warm + 8192; i++) {
      const y = this.shape(n.next());
      if (i >= warm) s += y * y;
    }
    this.norm = 1 / sqrt(s / 8192);
  }
  private shape(x: number): number {
    this.f[0].run(x);
    this.f[1].run(this.f[0].bp);
    return this.f[2].run(this.f[1].hp);
  }
  run(x: number): number {
    return this.shape(x) * this.norm;
  }
}

const CTRL = 32;
const KMAX = 48;

/** dB of envelope `e` at fractional grid position g. */
const at = (e: readonly number[], g: number) => {
  const i = floor(g);
  const j = min(22, i + 1);
  return e[i] + (e[j] - e[i]) * (g - i);
};

/**
 * One breath over a phrase: legato notes glide, a fresh note after a rest gets a scoop and an onset burst. No two
 * notes are shaded alike: each has its own vibrato (deeper or shallower, a little faster or slower, deepening as a
 * long note goes on) and lands a few cents off before the player hears it and settles; a long note swells. The
 * tone is a sum of harmonics (cosines by Chebyshev recursion, so one cos() a sample) whose levels follow the
 * spectral envelope at the current brightness; breath noise is shaped, scaled with the flow and pulsed at the pitch.
 */
function breath(
  b: Bus,
  ns: readonly Note[],
  P: Breath,
  out: { L: Float32Array; R: Float32Array; duck: number; pitch?: (t: number) => number; bright?: number },
): void {
  if (!ns.length) return;
  const sr = b.sr;
  const last = ns[ns.length - 1];
  const i0 = round(ns[0].t * sr);
  const i1 = min(b.n, round((last.t + last.d + 0.4) * sr));
  const kg = 1 - exp(-1 / (P.glide * sr));
  const kr = 1 - exp(-1 / (P.rel * sr));
  const kb = 1 - exp(-CTRL / (P.bright * sr));
  const ks = exp(-1 / (P.scoop[1] * sr));
  const kburst = exp(-1 / (P.burst[1] * sr));
  const kbloom = exp(-1 / (P.bloom[1] * sr));
  const [vr, vd, va, von, vramp] = P.vib;
  const air = new Air(sr, P.noise);
  const wp = new Wander(1 - exp((-TAU * 2 * CTRL) / sr));
  const wa = new Wander(1 - exp((-TAU * 2 * CTRL) / sr));
  const amps = new Float64Array(KMAX + 1);
  const tone = out.bright ?? 1;
  let K = 1;
  let k = 0;
  let lastNote = -1;
  let pitch = ns[0].n;
  let ph = 0;
  let vph = 0;
  let amp = 0;
  let bright = 0;
  let scoop = 0;
  let burst = 0;
  let burstV = 0;
  let bloom = 0;
  let ka = 0;
  let fresh = -1; // time of the last fresh onset
  let stop = 0;
  let krk = kr;
  const kt = 1 - exp(-1 / (max(1e-4, P.tongue[1]) * sr));
  /** Note j starts before note j - 1 has ended. */
  const joined = (j: number) => j > 0 && ns[j - 1].t + ns[j - 1].d >= ns[j].t - 0.01;
  /** A joined note is tongued when it repeats the pitch or the one before it is long enough to articulate. */
  const tongued = (j: number) => P.tongue[0] > 0 && (ns[j].n === ns[j - 1].n || ns[j].t - ns[j - 1].t >= 0.25);
  // this note's own shading (see above), drawn from the note itself so a note always sounds the same
  let vibDepth = 1;
  let vibRate = vr;
  let intone = 0;
  const ki = exp(-CTRL / (0.25 * sr));
  let drift = 0;
  let lvl = 1;
  let nl = P.noise[4];
  let f = b.hz(pitch);
  for (let i = i0; i < i1; i++) {
    const t = i / sr;
    while (k + 1 < ns.length && t >= ns[k + 1].t) k++;
    const nt = ns[k];
    const u = t - nt.t;
    if (k !== lastNote) {
      const legato = joined(k);
      if (!legato || tongued(k)) {
        const s = legato ? P.tongue[2] : 1;
        scoop = -max(0, P.scoop[0] + P.scoop[2] * (nt.v - 0.7)) * s;
        burst = s;
        burstV = nt.v;
        bloom = max(0, P.bloom[0] * (1.2 - nt.v)) * s;
        fresh = legato ? fresh : t;
        pitch = nt.n; // a tongued or fresh note starts on its pitch (plus the scoop); only slurs glide
      }
      ka = 1 - exp(-1 / ((P.att[0] + P.att[1] * (1 - nt.v) ** 2) * sr));
      const r = new Rng(hash32(round(nt.t * 1000), nt.n, 0x766962));
      vibDepth = r.range(0.6, 1.4);
      vibRate = vr * r.range(0.93, 1.07);
      intone = r.jitter(7);
      // the note's own end: where the tongue stops it before a tongued neighbour, else near its written end
      const next = k + 1 < ns.length && joined(k + 1);
      const tongue = next && tongued(k + 1);
      stop = tongue ? min(nt.d, ns[k + 1].t - nt.t) - P.tongue[0] : next ? Infinity : nt.d * 0.94;
      krk = tongue ? kt : kr;
      lastNote = k;
    }
    const on = u < stop;
    const swell = nt.d > 0.8 ? 1 + P.swell * (smooth(u / (0.7 * nt.d)) - 0.5) : 1;
    const target = on ? nt.v * swell : 0;
    amp += (target - amp) * (target > amp ? ka : krk);
    pitch += (nt.n - pitch) * kg;
    scoop *= ks;
    burst *= kburst;
    bloom *= kbloom;
    const ramp = smooth((u - von) / vramp) * vibDepth * (1 + 0.4 * smooth((u - 1) / 1.5));
    vph += vibRate / sr;
    if (vph >= 1) vph -= 1;
    const vs = sin(TAU * vph);
    if (((i - i0) & (CTRL - 1)) === 0) {
      drift = P.drift * wp.next(b.noise.next());
      intone *= ki;
      lvl = 1 + 0.06 * wa.next(b.noise.next());
      bright += (amp - bright) * kb;
      nl = P.noise[4] * (max(amp, 1e-3) / 0.7) ** P.noiseDyn;
      const cents = scoop + vd * ramp * vs + drift + intone;
      f = b.hz(pitch + cents / 100) * (out.pitch ? out.pitch(t) : 1);
      // harmonic levels from the envelopes blended at the current brightness (and register)
      const x = bright * tone;
      const D = P.dyn;
      let j = 0;
      while (j + 1 < D.length && x > D[j + 1]) j++;
      const j1 = min(j + 1, D.length - 1);
      const w = j1 === j ? 0 : min(1, max(0, (x - D[j]) / (D[j1] - D[j])));
      const wl = P.low ? min(1, max(0, log2(P.low[1] / f) / log2(P.low[1] / P.low[2]))) : 0;
      K = max(1, min(KMAX, floor(min(12000, 0.45 * sr) / f)));
      let pow = 0;
      let top = 0;
      for (let h = 1; h <= K; h++) {
        const g = min(22, max(0, (log2(h * f) - G0) * 3));
        let db = at(P.env[j], g) * (1 - w) + at(P.env[j1], g) * w;
        if (wl > 0) {
          const lo = P.low![0];
          db += wl * (at(lo[j], g) * (1 - w) + at(lo[j1], g) * w - db);
        }
        const a = 10 ** (db / 20);
        amps[h] = a;
        pow += a * a;
        top = max(top, a);
      }
      while (K > 1 && amps[K] < top * 3e-4) K--; // under -70 dB: not worth a multiply a sample
      const norm = sqrt(2 / pow); // unit rms
      for (let h = 1; h <= K; h++) amps[h] *= P.spread ? norm * SIGNS[h - 1] : norm;
    }
    ph += f / sr;
    if (ph >= 1) ph -= 1;
    const c1 = cos(TAU * ph);
    let y = amps[1] * c1;
    let cp = 1;
    let cc = c1;
    for (let h = 2; h <= K; h++) {
      const cn = 2 * c1 * cc - cp;
      y += amps[h] * cn;
      cp = cc;
      cc = cn;
    }
    // at a fresh onset the air comes first and the tone forms after it
    const formed = P.lag && t - fresh < P.lag ? smooth((t - fresh) / P.lag) : 1;
    const n = air.run(b.noise.next());
    const level = amp * (1 - bloom);
    const s = ((y * formed + n * nl * (1 + P.noise[5] * c1)) * level + n * P.burst[0] * burst * burstV) *
      lvl * (1 + va * ramp * vs) * P.g;
    const d = 1 - out.duck * (1 - b.duck[i]);
    out.L[i] += s * d * 0.96;
    out.R[i] += s * d;
    b.REV[i] += s * P.rv;
    b.DLY[i] += s * P.dl;
  }
}

/** Flute, saxophone and a hummed voice (see breath()). */
export function wind(b: Bus, e: E<'wind'>): void {
  breath(b, e.ns, BREATH[e.k], { L: b.ML, R: b.MR, duck: 0.3 });
}

/** The brass lead: the breath voice with trumpet and (low) trombone envelopes; the movement's tone sets its vibrato
 * depth and brightness, and tape wow bends it like the other leads. */
export function brassLead(b: Bus, e: E<'lead'>): void {
  const P = BREATH.brass;
  const vib = { ...P, vib: [P.vib[0], P.vib[1] * b.tone.vibrato, P.vib[2], P.vib[3], P.vib[4]] as const };
  breath(b, e.ns, vib, { L: b.ML, R: b.MR, duck: 0.3, pitch: (t) => b.wow(t), bright: b.tone.bright });
}

/**
 * Acid: a single oscillator into a resonant low-pass (two state-variable stages, the first one ringing)
 * whose cutoff jumps on each note and decays; accents hit harder with a sharper, brighter envelope; a slide
 * glides into the next note without retriggering. The base cutoff moves across the phrase (cut[0] -> cut[1]).
 */
export function acid(b: Bus, e: E<'acid'>): void {
  const ns = e.ns;
  if (!ns.length) return;
  const sr = b.sr;
  const f1 = new SVF(sr, 500, 1 + 11 * e.res);
  const f2 = new SVF(sr, 500, 0.7);
  const first = ns[0].t;
  const last = ns[ns.length - 1];
  const i0 = round(first * sr);
  const i1 = min(b.n, round((last.t + last.d + 0.25) * sr));
  const span = max(1e-3, last.t + last.d - first);
  const glide = 1 - exp(-1 / (0.045 * sr));
  const attack = 1 - exp(-1 / (0.001 * sr));
  const release = 1 - exp(-1 / (0.005 * sr));
  let k = 0;
  let pitch = ns[0].n;
  let ph = 0;
  let amp = 0;
  let env = 0;
  let lastNote = -1;
  for (let i = i0; i < i1; i++) {
    const t = i / sr;
    while (k + 1 < ns.length && t >= ns[k + 1].t) k++;
    const nt = ns[k];
    const u = t - nt.t;
    const tied = k > 0 && ns[k - 1].slide;
    if (k !== lastNote) {
      lastNote = k;
      if (!tied) env = 1; // a slide doesn't re-strike the filter
    }
    pitch = tied ? pitch + (nt.n - pitch) * glide : nt.n;
    const inc = b.hz(pitch) / sr;
    ph += inc;
    if (ph >= 1) ph -= 1;
    const osc = e.square ? saw(ph, inc) - saw(ph >= 0.5 ? ph - 0.5 : ph + 0.5, inc) : saw(ph, inc);
    env *= exp(-1 / ((nt.accent ? 0.12 : 0.2) * sr));
    if ((i & 15) === 0) {
      const base = e.cut[0] * (e.cut[1] / e.cut[0]) ** min(1, (t - first) / span);
      const c = min(sr * 0.42, base * (1 + e.env * env * (nt.accent ? 5 : 3)));
      f1.set(c);
      f2.set(c);
    }
    // a slide holds the gate open into the next note; the last note has none to slide into
    const held = nt.slide && k + 1 < ns.length;
    const gate = u < nt.d * 0.92 || held ? (nt.accent ? 1.35 : 1) : 0;
    amp += (gate - amp) * (gate > amp ? attack : release);
    const y = tanh(1.8 * f2.run(f1.run(osc))) * amp * 0.24;
    const d = 1 - 0.5 * (1 - b.duck[i]);
    b.ML[i] += y * d * 0.92;
    b.MR[i] += y * d;
    b.REV[i] += y * 0.12;
    b.DLY[i] += y * 0.15;
  }
}

// ------------------------------------------------------------------ choir

// formant frequency, gain, resonance of a soprano/alto section singing each vowel; the hum's nasal formants at
// 1 and 2.2 kHz are stronger than before (the recorded hum keeps a buzz at -25..-35 dB up to 4 kHz)
const FORMANTS: Record<Vowel, readonly (readonly [number, number, number])[]> = {
  a: [[800, 1, 5], [1150, 0.5, 7], [2900, 0.22, 10], [3900, 0.08, 12]],
  o: [[450, 1, 5], [800, 0.45, 7], [2830, 0.1, 10]],
  u: [[325, 1, 5], [700, 0.3, 7], [2530, 0.07, 10]],
  m: [[270, 1, 4], [1050, 0.12, 5], [2200, 0.08, 6]],
};

/**
 * A section singing: three voices a note, each with its own slow pitch wander (a few cents, like singers
 * holding a note) and its own vibrato rate, so the partials smear and the level shimmers as a real section's
 * do; breath through the formants; a 0.3 s onset (sections measure 0.1-0.23 s from 10 to 90 %).
 */
export function choir(b: Bus, e: E<'choir'>): void {
  const sr = b.sr;
  const voices: { ph: number; inc: number; l: number; r: number; lfo: number; rate: number; w: Wander }[] = [];
  const kw = 1 - exp((-TAU * 1.2 * 64) / sr);
  e.n.forEach((m, k) => {
    for (const cents of [-6, 0, 6]) {
      const [l, r] = pan(((k % 2 ? 1 : -1) * 0.4 + cents / 20) * 0.9);
      voices.push({
        ph: b.noise.unit(),
        inc: (b.hz(m) * 2 ** (cents / 1200)) / sr,
        l,
        r,
        lfo: TAU * b.noise.unit(),
        rate: 5 + 1.2 * b.noise.unit(),
        w: new Wander(kw),
      });
    }
  });
  const bank = FORMANTS[e.vowel].map(([f, g, q]) => [new SVF(sr, f, q), new SVF(sr, f, q), g] as const);
  const g = ((e.g ?? 1) * 0.1) / sqrt(voices.length);
  const att = 0.3 * sr;
  const on = e.d * sr;
  const rel = 1.4 * sr;
  const i0 = round(e.t * sr);
  const len = min(b.n - i0, round(on + rel));
  const cur = voices.map((v) => v.inc);
  for (let j = 0; j < len; j++) {
    if ((j & 63) === 0) {
      const t = j / sr;
      const depth = 14 * smooth((t - 0.25) / 0.8);
      for (let k = 0; k < voices.length; k++) {
        const v = voices[k];
        const c = depth * sin(TAU * v.rate * t + v.lfo) + 5 * v.w.next(b.noise.next());
        cur[k] = v.inc * 2 ** (c / 1200);
      }
    }
    let sl = 0;
    let sr_ = 0;
    for (let k = 0; k < voices.length; k++) {
      const v = voices[k];
      v.ph += cur[k];
      if (v.ph >= 1) v.ph -= 1;
      const x = saw(v.ph, cur[k]);
      sl += x * v.l;
      sr_ += x * v.r;
    }
    const breath = b.noise.next() * 0.12;
    let yl = 0;
    let yr = 0;
    for (const [fl, fr, fg] of bank) {
      fl.run(sl + breath);
      fr.run(sr_ + breath);
      yl += fl.bp * fg;
      yr += fr.bp * fg;
    }
    const i = i0 + j;
    const env = smooth(j / att) * (j > on ? exp((-6.9 * (j - on)) / rel) : 1) * g;
    const d = env * (1 - 0.2 * (1 - b.duck[i]));
    b.ML[i] += yl * d;
    b.MR[i] += yr * d;
    b.REV[i] += (yl + yr) * env * 0.55;
  }
}
