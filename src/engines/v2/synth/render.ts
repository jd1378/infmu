// Renders one section's score to stereo audio: every instrument into the buses, then the section's own
// master chain. Sections are rendered independently and overlap by their tails when played, so any
// section can be rendered (and heard) without the ones before it.

import { type AmpTone, type Ev, isMelody, type Mix, type Score } from '../types.ts';
import { Bus } from './bus.ts';
import {
  analog,
  Chain,
  clipper,
  type Comp,
  compress,
  freeverb,
  hall,
  lufs,
  Noise,
  Oversampled,
  oversampled,
  type Section,
  softClip,
  SVF,
  TAU,
} from './dsp.ts';
import * as I from './instruments.ts';
import { bell, mallet, perc, piano } from './modal.ts';
import { string } from './strings.ts';
import { acid, brassLead, choir, wind } from './voice.ts';

export interface Rendered {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Loudness of the section before leveling, and the gain applied to reach its target. */
  lufs: number;
  gain: number;
}

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;

/** Target loudness of a section: its movement's peak for the peak of the arc, down to peak - range for its calmest. */
export const targetLufs = (mix: Mix, energy: number) => mix.peak - mix.range * (1 - energy) ** 0.9;

const PLAY: { [K in Ev['i']]?: (b: Bus, e: E<K>) => void } = {
  kick: I.kick,
  snare: I.snare,
  tom: I.tom,
  hat: I.hat,
  bass: I.bass,
  pad: (b, e) => (e.k === 'strings' ? I.strings(b, e) : I.pad(b, e)),
  keys: I.keys,
  pluck: I.pluck,
  lead: (b, e) => (e.k === 'brass' ? brassLead(b, e) : I.lead(b, e)),
  bell,
  organ: I.organ,
  impact: I.impact,
  rise: I.riser,
  drone: I.drone,
  vinyl: I.vinyl,
  string,
  mallet,
  piano,
  perc,
  choir,
  wind,
  acid,
};

/** How far the melody sits under the band: nearly level with it in the loudest parts. */
export const melodyOffset = (energy: number) => -5 + 3 * energy;

// A section is mixed in stems, by measurement (the density of each changes with the style and the part, so no
// fixed levels suit them all): the bed (chords, textures, counter-lines) is the reference, the drums and the
// bass sit where the style wants them against it, and the melody rides on top of everything.
type Stem = 'bed' | 'fx' | 'drums' | 'bass' | 'melody';
const DRUMS: ReadonlySet<Ev['i']> = new Set(['kick', 'snare', 'tom', 'hat', 'perc']);
const FX: ReadonlySet<Ev['i']> = new Set(['impact', 'rise', 'drone', 'vinyl']);
const stemOf = (e: Ev): Stem =>
  isMelody(e) ? 'melody' : DRUMS.has(e.i) ? 'drums' : e.i === 'bass' ? 'bass' : FX.has(e.i) ? 'fx' : 'bed';

/** Renders a section; `a4` is the concert pitch (Hz of the A above middle C). */
export function renderScore(score: Score, sampleRate: number, a4 = 440): Rendered {
  const seconds = score.duration + score.tail;
  const b = new Bus(sampleRate, seconds, score.noiseSeed, score.movement.tone, a4);
  const kicks = score.events.filter((e): e is E<'kick'> => e.i === 'kick');
  b.duck = I.sidechain(b, kicks);
  const of = (s: Stem) => score.events.filter((e) => stemOf(e) === s);
  const mix = score.movement.mix;
  playAll(b, of('bed'), mix.amp);
  widen(b, mix.width);
  const bed = dryLufs(b);
  playAll(b, of('fx'), mix.amp);
  const against = (ref: number, offset: number, lo: number, hi: number) => (own: number) =>
    Number.isFinite(ref) && Number.isFinite(own) ? Math.min(hi, Math.max(lo, 10 ** ((ref + offset - own) / 20))) : 1;
  stem(b, score, of('drums'), 0x1b873593, against(bed, mix.drums, 0.25, 2), mix.bus === 'rock' ? drumBus : undefined);
  stem(b, score, of('bass'), 0x85ebca6b, against(bed, mix.bass, 0.25, 2));
  // measured once the rest of the band is in
  stem(
    b,
    score,
    of('melody'),
    0x5bd1e995,
    (own) => against(dryLufs(b), melodyOffset(score.section.energy), 0.7, 4)(own),
  );
  const { gain, measured } = master(b, score);
  if (mix.hiss !== null) air(b, score, mix.hiss);
  return { left: b.L, right: b.R, sampleRate, lufs: measured, gain };
}

function playAll(b: Bus, events: readonly Ev[], tone: AmpTone): void {
  for (const e of events) {
    const play = PLAY[e.i] as ((b: Bus, e: Ev) => void) | undefined;
    play?.(b, e);
  }
  if (b.ampUsed || b.amp2Used) {
    amp(b, tone);
    // processed: a later playAll on this bus (the fx after the bed) must not run it again
    b.AMP.fill(0);
    b.AMP2.fill(0);
    b.ampUsed = b.amp2Used = false;
  }
}

/**
 * Mono-compatible width: a decorrelated copy of the centre (all-passed, and high-passed so the low end stays
 * centred) added as side signal, as much as the bed needs to reach `target`. The mono sum doesn't change.
 */
function widen(b: Bus, target: number): void {
  const { sr, n } = b;
  for (const [L, R] of [[b.L, b.R], [b.ML, b.MR]] as const) {
    const hp = new SVF(sr, 250, 0.7);
    const aps = [0.0031, 0.0053, 0.0079, 0.0113].map((s) => ({ buf: new Float32Array(Math.round(s * sr)), i: 0 }));
    const dec = new Float32Array(n);
    let mid2 = 0;
    let side2 = 0;
    let dec2 = 0;
    for (let i = 0; i < n; i++) {
      const mid = (L[i] + R[i]) / 2;
      const side = (L[i] - R[i]) / 2;
      hp.run(mid);
      let x = hp.hp;
      for (const ap of aps) {
        const d = ap.buf[ap.i];
        const y = d - 0.6 * x;
        ap.buf[ap.i] = x + 0.6 * y;
        ap.i = ap.i + 1 < ap.buf.length ? ap.i + 1 : 0;
        x = y;
      }
      dec[i] = x;
      mid2 += mid * mid;
      side2 += side * side;
      dec2 += x * x;
    }
    // the added side is uncorrelated with what's there: powers add
    const need = target * target * mid2 - side2;
    if (need <= 0 || dec2 <= 0) continue;
    const k = Math.sqrt(need / dec2);
    for (let i = 0; i < n; i++) {
      L[i] += k * dec[i];
      R[i] -= k * dec[i];
    }
  }
}

/** Loudness of what a bus plays dry (before the room and the echoes). */
function dryLufs(x: Bus): number {
  return lufs(x.sr, x.L.map((v, i) => v + x.ML[i]), x.R.map((v, i) => v + x.MR[i]));
}

/**
 * Renders a stem on buses of its own, runs its dry buses through `process` (a bus's own compressor), then mixes it
 * into `b` at the gain `level` gives for its loudness.
 */
function stem(
  b: Bus,
  score: Score,
  events: readonly Ev[],
  salt: number,
  level: (own: number) => number,
  process?: (s: Bus) => void,
): void {
  if (!events.length) return;
  const s = new Bus(b.sr, score.duration + score.tail, (score.noiseSeed ^ salt) >>> 0, score.movement.tone, b.a4);
  s.duck = b.duck;
  playAll(s, events, score.movement.mix.amp);
  process?.(s);
  const g = level(dryLufs(s));
  for (const k of ['L', 'R', 'ML', 'MR', 'REV', 'DLY'] as const) {
    const from = s[k];
    const to = b[k];
    for (let i = 0; i < b.n; i++) to[i] += from[i] * g;
  }
}

function master(b: Bus, score: Score): { gain: number; measured: number } {
  const { sr, n, L, R, ML, MR, REV, DLY } = b;
  const mix = score.movement.mix;
  const ev = <K extends Ev['i']>(k: K) => score.events.filter((e): e is E<K> => e.i === k);

  // a build's high-pass sweeps up through the music bus, then snaps open on the downbeat
  for (const s of ev('sweep')) {
    const hl = new SVF(sr, 20);
    const hr = new SVF(sr, 20);
    const i0 = Math.round(s.t * sr);
    const len = Math.round(s.d * sr);
    const x5 = Math.round(0.005 * sr);
    for (let j = 0; j < len + x5 && i0 + j < n; j++) {
      if ((j & 31) === 0) {
        const x = (s.x0 ?? 0) + ((s.x1 ?? 1) - (s.x0 ?? 0)) * Math.min(1, j / len);
        const c = 20 * 30 ** (x * x);
        hl.set(c);
        hr.set(c);
      }
      const i = i0 + j;
      const w = j < len ? 1 : 1 - (j - len) / x5;
      hl.run(ML[i]);
      hr.run(MR[i]);
      ML[i] += (hl.hp - ML[i]) * w;
      MR[i] += (hr.hp - MR[i]) * w;
    }
  }
  for (let i = 0; i < n; i++) {
    L[i] += ML[i];
    R[i] += MR[i];
  }
  // the breath before a drop: every dry bus and send falls silent for a sixteenth; only tails remain
  for (const f of ev('breath')) {
    const i0 = Math.round(f.t * sr);
    const i1 = Math.min(n, Math.round((f.t + f.d) * sr));
    const r = 0.004 * sr;
    for (let i = i0; i < i1; i++) {
      const w = 1 - Math.min(1, (i - i0) / r, (i1 - i) / r);
      L[i] *= w;
      R[i] *= w;
      REV[i] *= w;
      DLY[i] *= w;
    }
  }

  // silences: the dry parts and sends stop; the room rings on unless the gap wants true silence
  const hush = new Float32Array(n).fill(1);
  for (const g of ev('gap')) {
    const i0 = Math.round(g.t * sr);
    // a silence that runs to the end of the section stays silent through the tail: nothing still decaying
    // under it may come back after it (the next section starts from its own silence)
    const toEnd = g.t + g.d >= score.duration - 1e-3;
    const i1 = toEnd ? n : Math.min(n, Math.round((g.t + g.d) * sr));
    const r = 0.005 * sr;
    for (let i = Math.max(0, i0); i < i1; i++) {
      const w = 1 - Math.min(1, (i - i0) / r, (i1 - i) / r);
      L[i] *= w;
      R[i] *= w;
      REV[i] *= w;
      DLY[i] *= w;
      if (!g.room) hush[i] = Math.min(hush[i], 1 - Math.min(1, (i - i0) / (0.12 * sr), (i1 - i) / r));
    }
  }

  // echoes: dotted-eighth-ish ping-pong, darker and thinner each time, feeding a little into the room
  const beat = 60 / score.bpm;
  if (mix.echo === 'tape') tapeEcho(b, mix.delayBeats * beat, mix.delayFeedback, mix.delayWet);
  else pingpong(b, mix.delayBeats * beat, mix.delayFeedback, mix.delayWet);
  // the room hears nothing below 350 Hz (no mud) and starts 45 ms late (the dry attack stays clear)
  const rl = new SVF(sr, 7000);
  const rh = new SVF(sr, 350);
  for (let i = 0; i < n; i++) {
    rh.run(rl.run(REV[i]));
    REV[i] = rh.hp;
  }
  early(b, mix);
  const pre = Math.round(0.045 * sr);
  if (mix.hall) hall(sr, REV, L, R, { ...hallFor(mix.room), wet: mix.reverb, pre, shimmer: mix.shimmer ?? 0 });
  else freeverb(sr, REV, L, R, mix.room, mix.reverb, pre, 0.35);
  for (let i = 0; i < n; i++) {
    if (hush[i] < 1) {
      L[i] *= hush[i];
      R[i] *= hush[i];
    }
  }

  // 4th-order 30 Hz high-pass (DC, rumble)
  const H = [0, 1, 2, 3].map((k) => new SVF(sr, 30, k & 1 ? 1.31 : 0.54));
  for (let i = 0; i < n; i++) {
    H[0].run(L[i]);
    H[1].run(H[0].hp);
    H[2].run(R[i]);
    H[3].run(H[2].hp);
    L[i] = H[1].hp;
    R[i] = H[3].hp;
  }

  // leveling by measurement: each section is brought to the loudness its energy calls for
  const end = Math.round(score.duration * sr);
  const measured = lufs(sr, L, R, end);
  const target = targetLufs(mix, score.section.energy);
  const gain = Number.isFinite(measured) ? Math.min(6, 10 ** ((target - measured) / 20)) : 1;
  const stops = () => {
    for (const s of ev('stop')) tapeStop(b, s.t, s.d);
  };
  let makeup = 1;
  if (mix.bus === 'rock') makeup = rockMaster(b, mix, gain, target, end, stops);
  else {
    // glue compressor, 2:1 above -10 dBFS
    const ca = Math.exp(-1 / (0.01 * sr));
    const cr = Math.exp(-1 / (0.15 * sr));
    let env = 0;
    const warm = tape(mix.warmth);
    for (let i = 0; i < n; i++) {
      const l = warm(L[i] * gain);
      const r = warm(R[i] * gain);
      const pk = Math.max(Math.abs(l), Math.abs(r));
      env = pk > env ? ca * env + (1 - ca) * pk : cr * env + (1 - cr) * pk;
      const over = 20 * Math.log10(env + 1e-9) + 10;
      const gr = over > 0 ? 10 ** (-over / 40) : 1;
      L[i] = l * gr;
      R[i] = r * gr;
    }
    stops();
    limit(b, CEILING);
  }

  // the tail is cut where the next section's own tails take over; fade it so the cut can't click
  const f0 = Math.round((score.duration + score.tail - 1.5) * sr);
  for (let i = Math.max(0, f0); i < n; i++) {
    const g = 0.5 + 0.5 * Math.cos((Math.PI * (i - f0)) / (n - 1 - f0));
    L[i] *= g;
    R[i] *= g;
  }
  return { gain: gain * makeup, measured };
}

/** The master's ceiling, -1.5 dBFS (peaks between the samples included: see limit()). */
const CEILING = 10 ** (-1.5 / 20);

// A rock record's buses (Mix.bus 'rock'), fitted to post-rock records: see out/research/proposals/sound-master.md.
/**
 * The drum bus (4:1, 3 to 7 dB on the hits), the crushed copy of it mixed `crush` under it (New York compression: it
 * lifts the drums' tails about 2 dB against their hits) and the tape it is printed to (1 to 5 dB off the loudest
 * hits), all in dB over the stem's own loudness: a soft build is compressed as much as a climax (the stem is leveled
 * against the band after).
 */
export const DRUM_BUS: {
  readonly bus: Readonly<Comp>;
  readonly crushed: Readonly<Comp>;
  readonly crush: number;
  readonly tape: { readonly knee: number; readonly ceil: number };
} = {
  bus: { threshold: 2, rms: 0.002, ratio: 4, knee: 6, attack: 0.005, release: 0.12, slow: 0.6, hp: 0 },
  crushed: { threshold: -6, rms: 0.0003, ratio: 20, knee: 6, attack: 0.0005, release: 0.08, slow: 0.3, hp: 0 },
  crush: 1,
  tape: { knee: 12, ceil: 16 },
};
/**
 * The mix bus (3:1, auto release, the sidechain deaf below 40 Hz), its threshold in dB against the style's peak
 * loudness: about 4 dB at a climax, dipping 1 to 2 dB more on the hits (the wall breathes with the kit), 1 dB in a
 * build, nothing in the quiet parts.
 */
export const GLUE: Readonly<Comp> = {
  threshold: -8,
  rms: 0.005,
  ratio: 3,
  knee: 6,
  attack: 0.01,
  release: 0.12,
  slow: 1.2,
  hp: 40,
};
/** The tape the master is printed to: where it starts to bend and where it tops out, dBFS. */
export const TAPE: { readonly knee: number; readonly ceil: number } = { knee: -3, ceil: 0 };

/** A rock record's drum bus (see DRUM_BUS): the crushed copy and the bus are one gain curve on the same drums. */
export function drumBus(s: Bus): void {
  const { sr, n } = s;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = s.L[i] + s.ML[i];
    r[i] = s.R[i] + s.MR[i];
  }
  const own = lufs(sr, l, r);
  if (!Number.isFinite(own)) return;
  const at = (c: Comp) => ({ ...c, threshold: own + c.threshold });
  const g = compress(sr, l, r, at(DRUM_BUS.bus));
  const h = compress(sr, l, r, at(DRUM_BUS.crushed));
  for (const x of [s.L, s.R, s.ML, s.MR]) for (let i = 0; i < n; i++) x[i] *= g[i] + DRUM_BUS.crush * h[i];
  // the kit plays on the main bus
  const { knee, ceil } = DRUM_BUS.tape;
  const sat = clipper(10 ** ((own + knee) / 20), 10 ** ((own + ceil) / 20));
  oversampled(s.L, sat);
  oversampled(s.R, sat);
}

/**
 * A rock record's master: the band glued by the mix bus compressor, printed to tape (a soft clipper at twice the rate)
 * and limited, made up to its target loudness through all three (measured again after the tape and the limiter, which
 * take some of it). Returns the make-up gain.
 */
function rockMaster(b: Bus, mix: Mix, gain: number, target: number, end: number, stops: () => void): number {
  const { sr, n, L, R } = b;
  const warm = tape(mix.warmth);
  for (let i = 0; i < n; i++) {
    L[i] = warm(L[i] * gain);
    R[i] = warm(R[i] * gain);
  }
  const g = compress(sr, L, R, { ...GLUE, threshold: mix.peak + GLUE.threshold });
  const dl = L.map((v, i) => v * g[i]);
  const dr = R.map((v, i) => v * g[i]);
  const sat = clipper(10 ** (TAPE.knee / 20), 10 ** (TAPE.ceil / 20));
  const print = (k: number) => {
    oversampled(dl, sat, k, L);
    oversampled(dr, sat, k, R);
    stops();
    limit(b, CEILING);
    return k;
  };
  const before = lufs(sr, dl, dr, end);
  if (!Number.isFinite(before)) return print(1);
  let k = print(10 ** ((target - before) / 20));
  for (let pass = 0; pass < 2; pass++) {
    const short = target - lufs(sr, L, R, end);
    if (!(short > 0.1)) break;
    k = print(k * 10 ** (short / 20));
  }
  return k;
}

/** Early reflections [ms in a room of size 1, gain], a set for each ear: walls, floor and ceiling. */
const EARLY: readonly (readonly (readonly [number, number])[])[] = [
  [[6.3, 0.62], [11.9, 0.48], [16.1, 0.41], [22.7, 0.33], [28.4, 0.27], [35.9, 0.21], [43.3, 0.16]],
  [[7.4, 0.58], [10.8, 0.5], [18.3, 0.39], [21.1, 0.34], [30.6, 0.26], [33.7, 0.22], [41.2, 0.17]],
];
/** Reflections at `early` 1 carry about as much energy as the reverb's tail. */
const EARLY_GAIN = 0.65;

/**
 * The room answering: in the first 45 ms, before the reverb's tail builds, the walls, floor and ceiling send
 * each sound back, a little darker. They come from the reverb send, so what sits further back in the mix has
 * more of them; each ear hears its own set, which makes the room wide (and keeps the mono sum clean enough at
 * this level).
 */
export function early(b: Bus, mix: Pick<Mix, 'size' | 'early'>): void {
  const { sr, n, REV } = b;
  EARLY.forEach((taps, side) => {
    const out = side ? b.R : b.L;
    const sum = new Float32Array(n);
    for (const [ms, a] of taps) {
      const d = Math.round((ms * mix.size * sr) / 1000);
      const g = a * mix.early * EARLY_GAIN;
      for (let i = d; i < n; i++) sum[i] += REV[i - d] * g;
    }
    const lp = new SVF(sr, 6000, 0.6);
    for (let i = 0; i < n; i++) out[i] += lp.run(sum[i]);
  });
}

/**
 * A console and tape driven gently: a soft cubic that rounds the loudest peaks by a fraction of a dB and a touch
 * of asymmetry for the even harmonics tape adds. At `warmth` 1 a sine at full scale has about 2.7% distortion;
 * at a mix's average level it is far below hearing.
 */
export function tape(warmth: number): (x: number) => number {
  if (!warmth) return (x) => x;
  const a = 0.08 * warmth;
  const c = 0.03 * warmth;
  return (x) => x + c * x * x - a * x * x * x;
}

/**
 * The noise floor of a recording: faint pink-ish hiss and room tone under everything, on both channels
 * independently, at `level` dBFS. It runs through a movement without a seam: each section crossfades (equal
 * power, the noises being unrelated) into the next where their tails overlap, fades in with a movement's first
 * section and out after its last, and stops dead with a tape stop.
 */
function air(b: Bus, score: Score, level: number): void {
  const { sr, n } = b;
  const mv = score.movement;
  if (score.section.role === 'rest') return;
  let lastSounding = mv.sections.length - 1;
  if (mv.sections[lastSounding].role === 'rest') lastSounding--;
  const first = score.local === 0;
  const last = score.local === lastSounding;
  const X = 0.25;
  const fadeIn = first ? 1 : X;
  const stop = score.events.find((e) => e.i === 'stop');
  const end = stop ? stop.t + stop.d : last ? score.duration + Math.min(3, score.tail - 1.5) : score.duration + X;
  const fadeOut = stop ? 0.02 : last ? 1.5 : X;
  const g = 10 ** (level / 20) * AIR_NORM;
  const len = Math.min(n, Math.round(end * sr));
  for (const [ch, salt] of [[b.L, 0x61697231], [b.R, 0x61697232]] as const) {
    const noise = new Noise((score.noiseSeed ^ salt) >>> 0);
    const hp = new SVF(sr, 40, 0.7);
    const lp = new SVF(sr, 14000, 0.7);
    // Kellet's economy pink filter
    let p0 = 0;
    let p1 = 0;
    let p2 = 0;
    for (let i = 0; i < len; i++) {
      const w = noise.next();
      p0 = 0.99765 * p0 + w * 0.099046;
      p1 = 0.963 * p1 + w * 0.2965164;
      p2 = 0.57 * p2 + w * 1.0526913;
      const pink = p0 + p1 + p2 + w * 0.1848;
      hp.run(lp.run(0.5 * pink + 0.5 * w));
      const t = i / sr;
      let f = g;
      if (t < fadeIn) f *= Math.sin((Math.PI / 2) * (t / fadeIn));
      if (t > end - fadeOut) f *= Math.cos((Math.PI / 2) * Math.min(1, (t - (end - fadeOut)) / fadeOut));
      ch[i] += hp.hp * f;
    }
  }
}
/** Scales the shaped noise above to unit rms. */
const AIR_NORM = 1.18;

/** The crunch amp: gain, mid push before the drive, mid scoop after it, cabinet corner, presence, low cut. */
const CRUNCH = { drive: 16, mids: 1.5, scoop: 0.8, cab: 8000, presence: 0.5, hp: 110 };

/**
 * A crunchy rock amp: a high-pass (no flub) and a pre-emphasis so the drive bites in the mids, then hard, slightly
 * asymmetric clipping that holds a note up the way a real amp's compression does, a mid scoop (the tone stack),
 * and a speaker cabinet: 24 dB/oct above 8 kHz with a presence peak near 3.5 kHz.
 */
export function crunch(sr: number, n: number, inp: Float32Array): Float32Array {
  const A = CRUNCH;
  const hp = new SVF(sr, A.hp, 0.7);
  const pre = new SVF(sr, 900, 0.7);
  const scoop = new SVF(sr, 550, 0.6);
  const cab1 = new SVF(sr, A.cab, 0.54);
  const cab2 = new SVF(sr, A.cab, 1.31);
  const presence = new SVF(sr, 3500, 1.2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // a tiny alternating offset keeps the filters out of subnormal numbers in the silences between notes, where
    // tanh(x + 0.3) - tanh(0.3) rounds to exactly 0 and the states decay toward 0 (30x slower on x86)
    hp.run(inp[i] + (i & 1 ? 1e-15 : -1e-15));
    pre.run(hp.hp);
    const x = hp.hp + A.mids * pre.bp;
    const clipped = Math.tanh(A.drive * x + 0.3) - Math.tanh(0.3);
    scoop.run(clipped);
    // the scoop's band-pass peaks at Q: take out A.scoop of the band around 550 Hz
    const toned = clipped - (A.scoop * scoop.bp) / 0.6;
    presence.run(toned);
    out[i] = (cab2.run(cab1.run(toned)) + (A.presence * presence.bp) / 1.2) * 0.2;
  }
  return out;
}

/**
 * A Marshall 1960AX 4x12 (Celestion Greenback G12M-25s) close-miked with an SM57: the mean of four CC0 captures
 * (Jester Dyne's Emerald pack) fitted with biquads to 0.7 dB rms from 60 Hz to 8 kHz. The low-end resonance, the
 * dip at 440 Hz, the presence around 2.4 kHz and the notch just above it, and a steep fall from 5 kHz.
 */
export const GREENBACK_4X12: readonly Section[] = [
  ['hp', 153, 1.64],
  ['lp', 4067, 2.35],
  ['lp', 11853, 0.4],
  ['peak', 104, 1.49, 8.8],
  ['peak', 436, 2.29, -1.5],
  ['peak', 1251, 8, 3.7],
  ['peak', 2475, 0.5, -3],
  ['peak', 2396, 3.63, 5.5],
  ['peak', 2917, 8, -6.2],
];

/**
 * The other guitarist's rig: a 4x12 with Celestion Vintage 30s, close-miked with an SM57: the mean of two CC0 captures
 * (Jester Dyne's Brutal pack) fitted to 0.8 dB rms from 60 Hz to 8 kHz. Less low resonance than the Greenbacks, more
 * bite at 2.3 kHz, and a steeper fall above 6 kHz: two players on two different rigs, as double-tracked walls are.
 */
export const V30_4X12: readonly Section[] = [
  ['hp', 147, 1.16],
  ['lp', 4176, 3],
  ['lp', 9082, 0.4],
  ['peak', 110, 2.73, 5.4],
  ['peak', 639, 8, -5],
  ['peak', 1221, 5.71, 3.6],
  ['peak', 1475, 7.66, -4.8],
  ['peak', 2279, 3.88, 7.8],
  ['peak', 4950, 0.5, -9.5],
  ['peak', 5612, 2.97, 12],
];

/**
 * The Big Muff Pi's tone stack at noon, from the circuit (J.L., "Re-engineering the Big Muff Pi", 2014): a 39k/10 nF
 * low-pass and a 4 nF/22k high-pass mixed by the 100k tone pot. Its notch sits at 1 kHz, 8 dB under its ends.
 */
const MUFF_TONE = (() => {
  const [RT, CT, CB, RB, R1, R2] = [39e3, 10e-9, 4e-9, 22e3, 50e3, 50e3];
  return {
    b: [CB * CT * R2 * RB * RT, CB * RB * (R1 + R2 + RT), R1 + RB],
    a: [
      CB * CT * RB * RT * (R1 + R2),
      CB * R1 * RB + CB * R2 * RB + CB * RB * RT + CT * R1 * RT + CT * R2 * RT + CT * RB * RT,
      R1 + R2 + RB + RT,
    ],
  };
})();

/** How the wall drives: the Muff's three stages' gains, the diodes' knee (V), the amp's drive, and the output level. */
const MUFF = { boost: 12, clip: 40, knee: 0.6, amp: 1.6, level: 0.22 };

/**
 * Post-rock's wall: a Big Muff Pi into a big amp and a 4x12. Before its tone stack the Muff is three transistor
 * stages, each with a 470 pF cap across its 470k feedback resistor (a one-pole low-pass at 720 Hz on its gain): a
 * booster, then two stages with a pair of diodes in the feedback that clip softly at their knee, so the note is
 * squared twice over and holds at full level for as long as the string rings; they run at twice the rate, so the
 * harmonics the clipping makes don't fold back. Then the tone stack's mid notch (a fourth stage after it only makes up
 * the level), the power amp's gentle saturation, and the cabinet.
 */
export function wall(sr: number, n: number, inp: Float32Array, cabinet = GREENBACK_4X12, gain = 1): Float32Array {
  const hp = new SVF(sr, 40, 0.7);
  const os = new Oversampled();
  const a = 1 - Math.exp((-TAU * 720) / (2 * sr));
  const { boost, clip, knee } = MUFF;
  const s = new Float64Array(3);
  const muff = (x: number) => {
    s[0] += a * (x - s[0]);
    // the booster clips only at its rails (about 4 V)
    s[1] += a * (4 * softClip((boost * s[0]) / 4) - s[1]);
    s[2] += a * (knee * softClip((clip * s[1]) / knee) - s[2]);
    return knee * softClip((clip * s[2]) / knee);
  };
  const tone = analog(sr, MUFF_TONE.b, MUFF_TONE.a, 1000);
  const cab = new Chain(sr, cabinet);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hp.run(inp[i] + (i & 1 ? 1e-15 : -1e-15));
    const t = tone.run(os.run(hp.hp, muff));
    out[i] = cab.run(softClip(MUFF.amp * t)) * MUFF.level * gain;
  }
  return out;
}

/**
 * The guitar amp (see Mix.amp): crunch() or wall(). One amp is widened by a doubled, slightly delayed copy on the
 * other side; two (a guitarist on each side) are a real double-track.
 */
function amp(b: Bus, tone: AmpTone): void {
  const { sr, n, ML, MR, REV, DLY } = b;
  // the wall's guitarists play different rigs: the one on the right through the Vintage 30s
  // (3 dB up, as loud as the other: they have less low resonance)
  const run = (inp: Float32Array, cab: readonly Section[], gain: number) =>
    tone === 'fuzz' ? wall(sr, n, inp, cab, gain) : crunch(sr, n, inp);
  const left = b.ampUsed ? run(b.AMP, GREENBACK_4X12, 1) : null;
  const right = b.amp2Used ? run(b.AMP2, V30_4X12, 1.41) : null;
  const dbl = Math.round(0.013 * sr);
  for (let i = 0; i < n; i++) {
    const d = 1 - 0.3 * (1 - b.duck[i]);
    let l: number;
    let r: number;
    if (left && right) {
      // two guitarists, one on each side, a little of each in the other's room
      l = (left[i] * 0.95 + right[i] * 0.2) * d;
      r = (right[i] * 0.95 + left[i] * 0.2) * d;
    } else {
      const out = (left ?? right)!;
      const o = out[i] * d;
      const other = (i >= dbl ? out[i - dbl] : 0) * d;
      l = o * 0.9 + other * 0.35;
      r = other * 0.9 + o * 0.35;
    }
    ML[i] += l;
    MR[i] += r;
    const m = left && right ? (l + r) / 2 : (left ?? right)![i] * d;
    REV[i] += m * 0.2;
    DLY[i] += m * 0.1;
  }
}

/**
 * The hall's decay for a movement's `room`: freeverb's at the same setting (its combs average 31 ms and feed back
 * room * 0.28 + 0.7), so a style keeps the size it was given; 4 kHz dies in 40% of the time, as it does in freeverb
 * with its damping at 0.35 (both measured: T30 per octave within 0.3 s from 125 Hz to 8 kHz).
 */
export function hallFor(room: number): { t60: number; t60hi: number } {
  const t60 = (-3 * 0.031) / Math.log10(room * 0.28 + 0.7);
  return { t60, t60hi: 0.4 * t60 };
}

/**
 * Tape echo: what a tape transport does to a delay. The transport wows and flutters, so a repeat comes back a little
 * early or late and its pitch sways (0.2% at 0.55 Hz and 0.05% at 5.7 Hz, a little different on each side, so the
 * repeats also chorus against each other). The heads lose the lows and highs (a band per pass, 100 Hz to 3.8 kHz:
 * each repeat darker and thinner than the one before), and the tape saturates softly as each repeat is recorded again.
 * Ping-ponged, as pingpong() is.
 */
export function tapeEcho(
  b: Pick<Bus, 'sr' | 'n' | 'L' | 'R' | 'REV' | 'DLY'>,
  time: number,
  fb: number,
  wet: number,
): void {
  const { sr, n, L, R, REV, DLY } = b;
  const D = Math.max(4, time * sr);
  // delay swings in seconds for the pitch sways above: a sway of p at rate r moves the delay by p / (2 pi r)
  const wow = 0.002 / (TAU * 0.55);
  const flutter = 0.0005 / (TAU * 5.7);
  const size = Math.ceil(D + (wow + flutter) * sr) + 4;
  const bl = new Float64Array(size);
  const br = new Float64Array(size);
  const band = () => ({ lp: new SVF(sr, 3800, 0.6), hp: new SVF(sr, 100, 0.7) });
  const hl = band();
  const hr = band();
  // the tape's saturation: transparent at the send's usual level, a soft knee above it
  const sat = (x: number) => 0.8 * softClip(x / 0.8);
  const read = (buf: Float64Array, w: number, d: number) => {
    let r = w - d;
    if (r < 0) r += size;
    const i = r | 0;
    const f = r - i;
    const x0 = buf[i];
    const x1 = buf[i + 1 < size ? i + 1 : i + 1 - size];
    const x2 = buf[i + 2 < size ? i + 2 : i + 2 - size];
    const xm = buf[i > 0 ? i - 1 : size - 1];
    // 4-point Hermite: the swaying read doesn't dull or rough the repeats
    const c1 = 0.5 * (x1 - xm);
    const c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  };
  // the four sways (left wow and flutter, right wow and flutter) as rotating phasors: rate Hz, phase, depth s
  const SWAYS = [[0.55, 0, wow], [5.7, 1, flutter], [0.61, 2, wow], [6.3, 2.5, flutter]] as const;
  const sways = SWAYS.map(([f, ph, a]) => ({
    c: Math.cos(ph),
    s: Math.sin(ph),
    rc: Math.cos((TAU * f) / sr),
    rs: Math.sin((TAU * f) / sr),
    a: a * sr,
  }));
  const sway = (k: number) => {
    const o = sways[k];
    const s = o.s * o.rc + o.c * o.rs;
    o.c = o.c * o.rc - o.s * o.rs;
    o.s = s;
    return o.a * s;
  };
  let w = 0;
  for (let i = 0; i < n; i++) {
    const dl = D + sway(0) + sway(1);
    const dr = D + sway(2) + sway(3);
    hl.hp.run(hl.lp.run(read(bl, w, dl)));
    hr.hp.run(hr.lp.run(read(br, w, dr)));
    const yl = hl.hp.hp;
    const yr = hr.hp.hp;
    bl[w] = sat(DLY[i] + yr * fb);
    br[w] = sat(yl * fb);
    w = w + 1 < size ? w + 1 : 0;
    L[i] += yl * wet;
    R[i] += yr * wet;
    REV[i] += (yl + yr) * 0.12;
  }
}

export function pingpong(
  b: Pick<Bus, 'sr' | 'n' | 'L' | 'R' | 'REV' | 'DLY'>,
  time: number,
  fb: number,
  wet: number,
): void {
  const { sr, n, L, R, REV, DLY } = b;
  const D = Math.max(1, Math.round(time * sr));
  const bl = new Float32Array(D);
  const br = new Float32Array(D);
  const a = 1 - Math.exp((-TAU * 3000) / sr);
  let p = 0;
  let fl = 0;
  let fr = 0;
  let hl = 0;
  let hr = 0;
  for (let i = 0; i < n; i++) {
    const yl = bl[p];
    const yr = br[p];
    fl += a * (yl - fl);
    fr += a * (yr - fr);
    hl += 0.02 * (fl - hl);
    hr += 0.02 * (fr - hr);
    bl[p] = DLY[i] + (fr - hr) * fb;
    br[p] = (fl - hl) * fb;
    p = p + 1 < D ? p + 1 : 0;
    L[i] += yl * wet;
    R[i] += yr * wet;
    REV[i] += (yl + yr) * 0.12;
  }
}

/**
 * Tape stop: over [t, t+d] the mix slows to a halt (the read head decelerates, the highs close), a reversed
 * whoosh pulls everything in, then true silence: the next movement starts from nothing.
 */
function tapeStop(b: Bus, t: number, d: number): void {
  const { sr, n, L, R } = b;
  const s0 = Math.round(t * sr);
  const g0 = Math.min(n, Math.round((t + d) * sr));
  const span = g0 - s0;
  if (span <= 2) return;
  const cL = L.slice(s0, g0 + 2);
  const cR = R.slice(s0, g0 + 2);
  const tl = new SVF(sr, 18000);
  const tr = new SVF(sr, 18000);
  for (let j = 0, pos = 0; j < span; pos += (1 - j / span) ** 2, j++) {
    const x = j / span;
    const k = pos | 0;
    const fr = pos - k;
    if ((j & 31) === 0) {
      const c = 150 + 17000 * (1 - x) ** 3;
      tl.set(c);
      tr.set(c);
    }
    L[s0 + j] = tl.run(cL[k] + (cL[k + 1] - cL[k]) * fr) * (1 - x) ** 0.6;
    R[s0 + j] = tr.run(cR[k] + (cR[k + 1] - cR[k]) * fr) * (1 - x) ** 0.6;
  }
  L.fill(0, g0);
  R.fill(0, g0);
  const wn = new Float32Array(Math.round(0.9 * sr));
  const wl = new Float32Array(wn.length);
  const wr = new Float32Array(wn.length);
  const wf = new SVF(sr, 5000);
  const burst = Math.round(0.05 * sr);
  for (let j = 0; j < burst; j++) wn[j] = wf.run(b.noise.next()) * (1 - j / burst);
  freeverb(sr, wn, wl, wr, 0.9, 1, 0, 0.2);
  const m = wn.length;
  for (let j = 0; j < m; j++) {
    const i = g0 - m + j;
    if (i < 0) continue;
    const w = 0.5 * Math.min(1, (m - j) / (0.005 * sr));
    L[i] += wl[m - 1 - j] * w;
    R[i] += wr[m - 1 - j] * w;
  }
}

/**
 * Look-ahead limiter that also watches the peaks between samples (a 4-tap half-band estimate of each
 * midpoint): the gain starts falling 1.5 ms before a peak and recovers over 120 ms.
 */
export function limit(b: Pick<Bus, 'sr' | 'n' | 'L' | 'R'>, ceil: number): void {
  const { sr, n, L, R } = b;
  const mid = (c: Float32Array, i: number) => Math.abs(9 * (c[i] + c[i + 1]) - c[i - 1] - c[i + 2]) / 16;
  const G = new Float32Array(n).fill(1);
  for (let i = 1; i < n - 2; i++) {
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i]), mid(L, i), mid(R, i));
    if (p > ceil) {
      G[i] = Math.min(G[i], ceil / p);
      G[i + 1] = ceil / p;
    }
  }
  const katt = 1 - Math.exp(-1 / (0.0015 * sr));
  const krel = 1 - Math.exp(-1 / (0.12 * sr));
  let v = 1;
  for (let i = n - 1; i >= 0; i--) G[i] = v = Math.min(G[i], v + (1 - v) * katt);
  v = 1;
  for (let i = 0; i < n; i++) {
    v = Math.min(G[i], v + (1 - v) * krel);
    L[i] *= v;
    R[i] *= v;
  }
}
