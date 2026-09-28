// Two voices built on filters: a choir (detuned saws through the formants of a sung vowel) and an acid
// line (one saw or square through a resonant low-pass whose envelope snaps on every note, as on a TB-303).

import { hash32, Rng } from '../rng.ts';
import type { Ev, Note, Vowel } from '../types.ts';
import type { Bus } from './bus.ts';
import { Noise, pan, saw, smooth, SVF, TAU, Wander } from './dsp.ts';

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;
const { exp, sin, cos, min, max, sqrt, round, log2, floor, tanh, PI } = Math;

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
 * An alto sax's own spectrum, note by note, from Db3 (49) to Ab5 (80): dB of harmonics 1..16 against the mf envelope
 * (Iowa MIS mf, the two takes averaged where there are two). They follow the fingering, not the frequency (the bore's
 * resonances move with every key): 4 dB rms, and neighbouring notes hardly agree (correlation 0.2), yet a note keeps
 * its pattern across takes and dynamics (0.5-0.8): the third harmonic's hole from A3 to D4, the weak fundamental of
 * the top notes.
 */
const SAX_NOTES = [
  [0, -2, -6, 0, 9, 6, 1, -11, -4, 2, 2, 4, 3, -3, -2, -7],
  [-3, -1, -4, 1, 10, 6, 3, -13, -2, 1, 0, 4, -1, 3, -2, 0],
  [-1, -1, -1, 2, 10, 1, -11, -1, 2, 3, 2, -5, -5, -6, 1, 3],
  [0, -1, 1, -2, 7, -3, -6, 4, 3, -1, -1, -3, 0, 0, 4, 2],
  [-2, -2, 2, -1, -3, 0, 4, 4, 1, -6, -4, 0, -1, 3, 0, 1],
  [1, 1, 8, 1, -1, 1, 0, -3, -6, -2, 2, -1, 0, -1, 2, -2],
  [1, 2, 5, -2, -2, -2, 3, -1, -2, 1, 2, 1, -3, 0, 0, -1],
  [1, 2, 1, -5, -3, 2, 1, -3, -3, 1, -2, 0, 2, 0, -4, -1],
  [2, 5, -10, 1, 6, 1, -8, 1, -3, 1, -1, -1, 1, -3, -3, -2],
  [3, 5, -12, 2, -2, 4, 5, -1, 1, -2, 1, 4, -3, -2, -3, -3],
  [2, 2, -11, 2, -2, 0, 4, -2, -3, -2, 4, 5, 0, -2, -4, 2],
  [0, -2, -9, 3, 4, 0, -4, 5, -3, 0, 2, 2, -2, 1, 0, -2],
  [0, -14, -16, -10, 1, 2, -1, -2, 0, 3, 0, 0, 2, 0, -4, 3],
  [0, -5, -9, -6, 9, 1, 0, 2, 2, 2, 3, -1, -3, -4, 1, 5],
  [-1, -1, 8, -1, 7, -5, 3, 6, 4, 1, 1, -1, -4, 3, 3, -1],
  [-4, -2, 0, 0, 4, -3, 3, 0, 5, 6, 4, -2, -1, 2, 0, -4],
  [0, 1, 12, 1, -3, 1, -2, 1, -4, -2, -3, -2, -2, 0, 0, 0],
  [0, 5, 5, 7, 0, 1, -2, 1, 0, -1, -3, -4, 0, -2, -1, -1],
  [-2, 1, -3, 6, 1, 2, 5, 2, 2, -3, -7, -3, -1, 0, -1, -5],
  [0, -2, 1, 0, -1, -1, 5, -2, 3, -1, 0, 0, 0, 0, 0, -3],
  [4, 5, -1, -1, 3, -2, -1, 0, 0, -1, 0, 0, -1, 1, 0, 0],
  [2, -1, 5, -2, 1, 3, 3, 0, -4, 0, 0, 0, -4, -3, 0, 0],
  [1, -1, -1, -4, 2, 5, 6, 3, 7, -4, -5, 1, -4, 0, -2, 0],
  [-4, 6, 9, 4, 0, 5, 4, 0, 3, -7, -9, -1, -2, 1, -4, -5],
  [-13, -15, 7, 3, 7, 9, 5, 12, 1, -9, -8, -5, 4, -11, -1, -2],
  [-9, -5, 4, 7, 4, 5, 7, 6, -7, 2, 0, -1, -4, -12, -4, 0],
  [0, -2, 1, 10, 5, 2, 9, 0, -2, 4, 0, -1, -7, -7, 0, 0],
  [-3, -6, 3, 0, 3, 1, 6, -7, 0, -5, 4, -1, -6, 0, 0, 0],
  [0, 4, 10, 0, 6, -1, 1, -10, 0, -5, -3, -1, 0, 0, 0, 0],
  [2, -1, 6, 0, 4, 9, -1, 3, -4, -3, -5, 0, 0, 0, 0, 0],
  [6, -5, 7, 7, 0, 8, -1, 2, -10, -11, -3, 0, 0, 0, 0, 0],
  [3, -14, 1, 6, 2, 0, 0, -2, -7, -3, 0, 0, 0, 0, 0, 0],
];
/**
 * Signs of harmonics 1..48 for reed, flute and voice: all cosines in phase make a pulse (crest factor 3-4.5) where the
 * recordings measure 1.5-2.4; this fixed pattern (a random search over 0/180 degree phases) gives 1.5-2.
 */
const SIGNS = [...'++---++---++--++--+-+++---+-++--++-+++-+-++-++-+'].map((c) => (c === '+' ? 1 : -1));

/**
 * How a player phrases a line: notes changed under a breath that keeps going, a phrase's last note let go into a slow
 * release rather than cut, and breaths, in the rests or snatched from a note when a line runs on too long.
 */
export interface Phrasing {
  /**
   * A change of note while the air keeps flowing: for join[2] s around it the tone dims join[0] dB (0.6-1.4x, drawn
   * per join; join[1] dB where the tongue marks it, on a repeat or after a note of 0.25 s or more) and its air rises
   * join[3] dB; its upper harmonics fall away and grow back over join[4] s as the new note speaks. Recorded, every
   * join dims (6 dB, 4-10, over about 20 ms, 15 at most) and the new note's upper harmonics come 20-40 ms after its
   * lower ones; the tone never stops.
   */
  join: readonly [number, number, number, number, number];
  /** At a slurred change the pitch moves across in an S over this many seconds, inside the dim (0: it steps). */
  slide: number;
  /** A phrase's last note holds to its end, then its breath falls away with time constant tail[0] s, the pitch
   * sinking up to tail[1] cents with it. */
  tail: readonly [number, number];
  /** Seconds of playing at mf one breath lasts, and the inhale's level in dB against the tone (up to 8 dB louder
   * when the lungs were empty). Past 70 % of it the tone tires, 3 dB at most; past all of it the player cuts the next
   * note of 0.3 s or more short to breathe. */
  lungs: readonly [number, number];
}

interface Breath {
  env: Env;
  /** How a player shapes the line (none: every joined note slurs, or is tongued by `tongue`). */
  phrasing?: Phrasing;
  /** From `low[1]` Hz down to `low[2]` Hz the envelopes blend into `low[0]` (a bigger instrument of the family). */
  low?: readonly [Env, number, number];
  /** The instrument's own spectrum by note (dB of harmonics 1..n against `env`), from MIDI note `notes[0]` up. */
  notes?: readonly [number, readonly (readonly number[])[]];
  /** A note's harmonics 2 and up stray from the envelope by this many dB rms, drawn afresh for every note: a flute's
   * spectrum differs from take to take as much as from note to note. */
  scatter: number;
  /** Each harmonic wanders (dB rms, the fundamental's and the top's), a third with the breath and the rest on its own:
   * a real wind's partials move partly together (pairwise correlation 0.2-0.6), and the weak upper ones move most. */
  flux: readonly [number, number];
  /** Vibrato's colour: harmonics 2 and up swing by about vam[0] dB each (0.3-1.7x, drawn per note), vam[1] degrees
   * from the pitch (a sax's upper partials dip as its pitch rises; a flute's rise with it). */
  vam: readonly [number, number];
  /** Breath level each envelope belongs to (the note velocity that sounds like it). */
  dyn: readonly number[];
  /** Time constant (s) of the brightness following the breath: brass builds its upper partials late. */
  bright: number;
  /** Attack time constant (s): att[0] + att[1] * (1 - v)^2, soft notes speak slower. */
  att: readonly [number, number];
  /** One-pole stages of the attack: two make it S-shaped, a reed's or a flute's tone growing out of the breath
   * (recorded, 20-30 dB under full at 10 ms, within 2 dB by 60 ms) rather than jumping in. */
  stages: 1 | 2;
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
  /** The breath is never steady: the tone's strength (and with it its brightness and its air) swells and eases this
   * many dB rms through a held note, a few times a second. Only slowly: a quicker flutter on top was heard as the
   * tone shaking. */
  gust: number;
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
    notes: [49, SAX_NOTES],
    scatter: 0,
    flux: [0.2, 1.8],
    vam: [2, 160],
    dyn: [0.4, 0.7, 1],
    bright: 0.012,
    att: [0.015, 0.06],
    stages: 2,
    phrasing: { join: [5, 12, 0.07, 8, 0.09], slide: 0.03, tail: [0.15, 20], lungs: [12, -40] },
    bloom: [0, 1],
    rel: 0.07,
    glide: 0.005,
    scoop: [5, 0.03, 30],
    vib: [4.8, 9, 0.015, 0.35, 0.45],
    drift: 1.5,
    gust: 0.8,
    swell: 0.25,
    noise: [1600, 0.6, 400, 9000, 0.012, 0.6],
    noiseDyn: 0,
    burst: [0.035, 0.02],
    lag: 0.02,
    tongue: [0.02, 0.008, 0.5],
    spread: true,
    g: 0.1,
    rv: 0.3,
    dl: 0.15,
  },
  flute: {
    env: ENV.flute,
    scatter: 4,
    flux: [1, 3.2],
    vam: [2, 0],
    dyn: [0.4, 0.7, 1],
    bright: 0.012,
    att: [0.02, 0.06],
    stages: 2,
    phrasing: { join: [4, 12, 0.06, 6, 0.07], slide: 0.025, tail: [0.12, 8], lungs: [8, -36] },
    bloom: [0, 1],
    rel: 0.06,
    glide: 0.008,
    scoop: [8, 0.08, 0],
    vib: [4.8, 13, 0.15, 0.3, 0.4],
    drift: 1.4,
    gust: 0.6,
    swell: 0.2,
    noise: [2000, 0.5, 250, 10000, 0.025, 0.4],
    noiseDyn: 1,
    burst: [0.05, 0.025],
    lag: 0.03,
    tongue: [0.03, 0.01, 0.5],
    spread: true,
    g: 0.12,
    rv: 0.4,
    dl: 0.22,
  },
  hum: {
    env: ENV.hum,
    scatter: 0,
    flux: [0, 0],
    vam: [0, 0],
    dyn: [0.7],
    bright: 0.02,
    att: [0.01, 0.03],
    stages: 1,
    bloom: [0, 1],
    rel: 0.07,
    glide: 0.03,
    scoop: [10, 0.04, 0],
    vib: [5, 22, 0.18, 0.1, 0.3],
    drift: 2,
    gust: 0,
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
    scatter: 0,
    flux: [0, 0],
    vam: [0, 0],
    dyn: [0.4, 0.7, 1],
    bright: 0.06,
    att: [0.008, 0.03],
    stages: 1,
    bloom: [0.6, 0.1],
    rel: 0.06,
    glide: 0.02,
    scoop: [42, 0.035, -70],
    vib: [5, 5, 0.03, 0.4, 0.4],
    drift: 1.5,
    gust: 0,
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

/** dB of harmonic h (from 1) of note p (fractional while it glides) in an instrument's own spectrum by note. */
const byNote = ([first, rows]: NonNullable<Breath['notes']>, h: number, p: number): number => {
  if (h > rows[0].length) return 0;
  const x = min(rows.length - 1, max(0, p - first));
  const i = floor(x);
  const j = min(rows.length - 1, i + 1);
  return rows[i][h - 1] + (rows[j][h - 1] - rows[i][h - 1]) * (x - i);
};

/** A breath taken: it ends at t, lasts d s, and `need` (0-1) is how empty the lungs were. */
interface Inhale {
  t: number;
  d: number;
  need: number;
}

/**
 * Where the player breathes in a line: before it, in its phrase breaks (rests of 0.5 s or more), in any rest of
 * 0.15 s or more once a fifth of the breath is spent (each as deep as the rest allows), and, once all of it is spent,
 * at the end of the next note of 0.3 s or more, cut short for it. Returns the line with those notes shortened, the
 * breaths, and the air (seconds of mf playing) spent before each note.
 */
export function lungs(ns: readonly Note[], F: Phrasing): { line: Note[]; breaths: Inhale[]; spent: number[] } {
  const line = ns.map((n) => ({ ...n }));
  const breaths: Inhale[] = [];
  const spent: number[] = [];
  const cap = F.lungs[0];
  let air = 0;
  for (let j = 0; j < line.length; j++) {
    const n = line[j];
    const gap = j ? n.t - (line[j - 1].t + line[j - 1].d) : n.t;
    if (j === 0 || gap >= 0.5 || (gap >= 0.15 && air > 0.2 * cap)) {
      const d = min(0.5, 0.75 * gap - 0.03);
      if (d >= 0.1) breaths.push({ t: n.t - 0.04, d, need: min(1, air / cap) });
      air *= max(0, 1 - max(0, d) / 0.4);
    }
    spent.push(air);
    air += (n.d * n.v) / 0.7;
    const next = line[j + 1];
    if (next && air > cap && n.d >= 0.3 && next.t - (n.t + n.d) < 0.01) {
      const cut = min(0.2, 0.45 * n.d);
      n.d = next.t - n.t - cut;
      breaths.push({ t: next.t - 0.03, d: cut - 0.03, need: 1 });
      air *= 1 - cut / 0.4;
    }
  }
  return { line, breaths, spent };
}

/** An inhale: air drawn in at the corners of the mouth around the mouthpiece, a hiss that swells and fades, louder
 * the emptier the lungs were. */
function inhale(b: Bus, out: { L: Float32Array; R: Float32Array; duck: number }, x: Inhale, P: Breath): void {
  const sr = b.sr;
  const i0 = max(0, round((x.t - x.d) * sr));
  const n = min(b.n, round(x.t * sr)) - i0;
  if (n < 64) return;
  const hiss = new Air(sr, [1300, 0.5, 350, 6500, 0, 0]);
  const noise = new Noise(hash32(round(x.t * 1000), 0x696e68));
  const g = 0.7 * P.g * 10 ** ((P.phrasing!.lungs[1] + 8 * x.need) / 20);
  for (let j = 0; j < n; j++) {
    const e = sin(PI * (j / n) ** 0.8) ** 1.5; // quick in, a slower fade as the lungs fill
    const s = hiss.run(noise.next()) * e * g;
    const i = i0 + j;
    const d = 1 - out.duck * (1 - b.duck[i]);
    out.L[i] += s * d;
    out.R[i] += s * d * 0.9;
    b.REV[i] += s * P.rv * 0.6;
  }
}

/**
 * One breath over a phrase: legato notes glide, a fresh note after a rest gets a scoop and an onset burst. No two
 * notes are shaded alike: each has its own vibrato (deeper or shallower, a little faster or slower, deepening as a
 * long note goes on) and lands a few cents off before the player hears it and settles; a long note swells. The
 * tone is a sum of harmonics (cosines by Chebyshev recursion, so one cos() a sample) whose levels follow the
 * spectral envelope at the current brightness, bent by the note's own spectrum; each harmonic then wanders and
 * swings with the vibrato on its own. Breath noise is shaped, scaled with the flow and pulsed at the pitch.
 */
function breath(
  b: Bus,
  written: readonly Note[],
  P: Breath,
  out: { L: Float32Array; R: Float32Array; duck: number; pitch?: (t: number) => number; bright?: number },
): void {
  if (!written.length) return;
  const F = P.phrasing;
  const plan = F ? lungs(written, F) : null;
  const ns = plan ? plan.line : written;
  const sr = b.sr;
  const last = ns[ns.length - 1];
  const i0 = round(ns[0].t * sr);
  const i1 = min(b.n, round((last.t + last.d + (F ? max(0.4, 6 * F.tail[0]) : 0.4)) * sr));
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
  // each harmonic's own level (Breath.notes, scatter, flux, vam): its deviation from the envelope, eased between
  // notes; its wander; its vibrato swing (the sin and cos parts against the pitch's)
  const own = P.flux[1] > 0 || P.vam[0] > 0;
  const shaped = P.notes !== undefined || P.scatter > 0;
  const kw = 1 - exp((-TAU * 4 * CTRL) / sr);
  const wander = own ? Array.from({ length: KMAX + 2 }, () => new Wander(kw)) : []; // the last: the breath's
  const grain = new Noise(hash32(round(ns[0].t * 1000), ns[0].n, 0x666c7578));
  const kd = 1 - exp(-CTRL / (0.02 * sr));
  const dev = new Float64Array(KMAX + 1);
  const scat = new Float64Array(KMAX + 1);
  const swA = new Float64Array(KMAX + 1);
  const swB = new Float64Array(KMAX + 1);
  let amp1 = 0;
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
  /** A joined note is articulated when it repeats the pitch or the one before it is long enough to articulate. */
  const marked = (j: number) => ns[j].n === ns[j - 1].n || ns[j].t - ns[j - 1].t >= 0.25;
  /** ...and then tongued to a stop, unless the phrasing carries the breath through its joins. */
  const tongued = (j: number) => !F && P.tongue[0] > 0 && marked(j);
  // drawn from each note itself: how far it dims where it joins the one before (dB; see Phrasing.join), and how far
  // it sinks (cents) if it ends a phrase
  const dims = new Float64Array(ns.length);
  const sink = new Float64Array(ns.length);
  if (F) {
    ns.forEach((n, j) => {
      const r = new Rng(hash32(round(n.t * 1000), n.n, 0x706872));
      sink[j] = F.tail[1] * r.range(0.3, 1.2);
      dims[j] = joined(j) ? (marked(j) ? F.join[1] : F.join[0]) * r.range(0.6, 1.4) : 0;
    });
  }
  /** Where note j joins the one before, at t: how much the tone is left (a raised cosine dip across the join) and how
   * far its upper harmonics have fallen away (0-1: rising into the join, then growing back). */
  const joinAt = (j: number, t: number): [number, number] => {
    const [, , L, , back] = F!.join;
    const x = t - ns[j].t;
    if (x < -0.4 * L || x > 5 * back) return [1, 0];
    const dim = x < 0.6 * L ? 10 ** ((-dims[j] * 0.5 * (1 - cos((TAU * (x + 0.4 * L)) / L))) / 20) : 1;
    return [dim, x < 0 ? smooth((x + 0.4 * L) / (0.4 * L)) : exp(-x / back)];
  };
  // the air's rise per unit of the tone's dip: join[3] dB at a join of join[0] dB
  const airUp = F ? (10 ** (F.join[3] / 20) - 1) / (1 - 10 ** (-F.join[0] / 20)) : 0;
  let dull = 0;
  const kTail = F ? 1 - exp(-1 / (F.tail[0] * sr)) : 0;
  let ends = false;
  let tire = 1;
  let press = 0;
  let dimmed = 1;
  // a slurred change: the pitch it slides from and to, and when it set off (see Phrasing.slide)
  let slideFrom = 0;
  let slideTo = 0;
  let slideAt = -1;
  // the breath's slow swells (see Breath.gust)
  const swells = new Wander(1 - exp((-TAU * 2.5 * CTRL) / sr));
  let gust = 1;
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
      if (F && legato && marked(k)) {
        // the tongue marks the change: the new note starts on its pitch, with a little puff of the air behind it
        pitch = nt.n;
        burst = P.tongue[2];
        burstV = nt.v;
      } else if (F && legato) {
        // slurred: the pitch crosses to the new note inside the dim, in an S (or at once)
        if (!F.slide) pitch = nt.n;
        else {
          slideFrom = pitch;
          slideTo = nt.n;
          slideAt = t;
        }
      }
      if (!legato || tongued(k)) {
        const s = legato ? P.tongue[2] : 1;
        scoop = -max(0, P.scoop[0] + P.scoop[2] * (nt.v - 0.7)) * s;
        burst = s;
        burstV = nt.v;
        bloom = max(0, P.bloom[0] * (1.2 - nt.v)) * s;
        // the air comes before the tone only when the tone starts from silence, not out of the last note's release
        if (!legato) fresh = amp < 0.1 * nt.v ? t : -1;
        pitch = nt.n; // a tongued or fresh note starts on its pitch (plus the scoop); only slurs glide
      }
      ka = 1 - exp(-1 / ((P.att[0] + P.att[1] * (1 - nt.v) ** 2) * sr));
      const r = new Rng(hash32(round(nt.t * 1000), nt.n, 0x766962));
      vibDepth = r.range(0.6, 1.4);
      vibRate = vr * r.range(0.93, 1.07);
      intone = r.jitter(7);
      if (own || shaped) {
        for (let h = 2; h <= KMAX; h++) {
          const depth = P.vam[0] * r.range(0.3, 1.7);
          const phase = ((P.vam[1] + r.jitter(35)) * PI) / 180;
          swA[h] = depth * cos(phase);
          swB[h] = depth * sin(phase);
          scat[h] = P.scatter * (r.jitter(1) + r.jitter(1) + r.jitter(1)); // about normal, unit variance
        }
      }
      // the note's own end: where the tongue stops it before a tongued neighbour, else near its written end
      const next = k + 1 < ns.length && joined(k + 1);
      const stopped = next && tongued(k + 1);
      stop = stopped ? min(nt.d, ns[k + 1].t - nt.t) - P.tongue[0] : next ? Infinity : nt.d * (F ? 1 : 0.94);
      ends = !next;
      // a phrase's last note is let go slowly: the breath falls away rather than stopping
      krk = stopped ? kt : F && ends ? kTail : kr;
      lastNote = k;
    }
    const on = u < stop;
    const swell = nt.d > 0.8 ? 1 + P.swell * (smooth(u / (0.7 * nt.d)) - 0.5) : 1;
    const target = on ? nt.v * swell : 0;
    if (P.stages === 2) {
      amp1 += (target - amp1) * (target > amp1 ? ka : krk);
      amp = amp1 > amp ? amp + (amp1 - amp) * ka : amp1;
    } else amp += (target - amp) * (target > amp ? ka : krk);
    press = amp;
    let sunk = 0;
    press *= gust;
    if (F) {
      // the tone dims through a change of note (this note's join, and the next one's as it nears); a phrase's last
      // note sinks as its breath falls away; a player out of air tires
      let fallen = 0;
      dimmed = 1;
      for (const j of [k, k + 1]) {
        if (j >= ns.length || !dims[j]) continue;
        const [dim, f] = joinAt(j, t);
        dimmed *= dim;
        fallen = max(fallen, f);
      }
      dull = fallen;
      press *= tire * dimmed;
      if (ends && u > stop) sunk = sink[k] * (1 - amp / max(1e-6, nt.v));
    }
    if (slideAt >= 0) {
      const x = (t - slideAt) / F!.slide;
      pitch = x >= 1 ? slideTo : slideFrom + (slideTo - slideFrom) * smooth(x);
      if (x >= 1) slideAt = -1;
    } else pitch += (nt.n - pitch) * kg;
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
      if (F) {
        const used = plan!.spent[k] + (min(u, nt.d) * nt.v) / 0.7;
        tire = 1 - 0.3 * min(1, max(0, (used / F.lungs[0] - 0.7) / 0.5));
      }
      if (P.gust) gust = 10 ** ((P.gust * swells.next(grain.next())) / 20);
      // through a change of note the upper harmonics fall away and the air comes through the dimmed tone
      bright += (press * (1 - 0.55 * dull) - bright) * kb;
      nl = P.noise[4] * (max(press, 1e-3) / 0.7) ** P.noiseDyn * (1 + airUp * (1 - dimmed));
      const cents = scoop + vd * ramp * vs + drift + intone - sunk;
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
        if (shaped) {
          dev[h] += ((P.notes ? byNote(P.notes, h, pitch) : 0) + scat[h] - dev[h]) * kd;
          db += dev[h];
        }
        const a = 10 ** (db / 20);
        amps[h] = a;
        pow += a * a;
        top = max(top, a);
      }
      while (K > 1 && amps[K] < top * 3e-4) K--; // under -70 dB: not worth a multiply a sample
      const norm = sqrt(2 / pow); // unit rms
      for (let h = 1; h <= K; h++) amps[h] *= P.spread ? norm * SIGNS[h - 1] : norm;
      if (own) {
        const vc = cos(TAU * vph);
        const common = 0.6 * wander[KMAX + 1].next(grain.next()); // shared by every harmonic: r = 0.36
        for (let h = 1; h <= K; h++) {
          const rms = P.flux[0] + (P.flux[1] - P.flux[0]) * (1 - 1 / h);
          const wobble = rms * (common + 0.8 * wander[h].next(grain.next()));
          amps[h] *= 10 ** ((wobble + ramp * (swA[h] * vs + swB[h] * vc)) / 20);
        }
      }
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
    const formed = P.lag && fresh >= 0 && t - fresh < P.lag ? smooth((t - fresh) / P.lag) : 1;
    const n = air.run(b.noise.next());
    const level = press * (1 - bloom);
    const s = ((y * formed + n * nl * (1 + P.noise[5] * c1)) * level + n * P.burst[0] * burst * burstV) *
      lvl * (1 + va * ramp * vs) * P.g;
    const d = 1 - out.duck * (1 - b.duck[i]);
    out.L[i] += s * d * 0.96;
    out.R[i] += s * d;
    b.REV[i] += s * P.rv;
    b.DLY[i] += s * P.dl;
  }
  if (plan) { for (const x of plan.breaths) inhale(b, out, x, P); }
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
