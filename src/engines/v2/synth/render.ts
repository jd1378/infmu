// Renders one section's score to stereo audio: every instrument into the buses, then the section's own
// master chain. Sections are rendered independently and overlap by their tails when played, so any
// section can be rendered (and heard) without the ones before it.

import { type Ev, isMelody, type Mix, type Score } from '../types.ts';
import { Bus } from './bus.ts';
import { freeverb, lufs, SVF, TAU } from './dsp.ts';
import * as I from './instruments.ts';
import { mallet, perc, piano } from './modal.ts';
import { string } from './strings.ts';
import { acid, choir, wind } from './voice.ts';

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
  pad: (b, e) => I.pad(b, e),
  keys: I.keys,
  pluck: I.pluck,
  lead: I.lead,
  bell: I.bell,
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
  playAll(b, of('bed'));
  widen(b, BED_WIDTH);
  const bed = dryLufs(b);
  playAll(b, of('fx'));
  const against = (ref: number, offset: number, lo: number, hi: number) => (own: number) =>
    Number.isFinite(ref) && Number.isFinite(own) ? Math.min(hi, Math.max(lo, 10 ** ((ref + offset - own) / 20))) : 1;
  stem(b, score, of('drums'), 0x1b873593, against(bed, mix.drums, 0.25, 2));
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
  return { left: b.L, right: b.R, sampleRate, lufs: measured, gain };
}

function playAll(b: Bus, events: readonly Ev[]): void {
  for (const e of events) {
    const play = PLAY[e.i] as ((b: Bus, e: Ev) => void) | undefined;
    play?.(b, e);
  }
  if (b.ampUsed) amp(b);
}

/** Side-to-mid ratio the bed is opened up to (stereo-recorded instruments in a room sit around 0.5 to 0.7). */
const BED_WIDTH = 0.6;

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

/** Renders a stem on buses of its own, then mixes it into `b` at the gain `level` gives for its loudness. */
function stem(b: Bus, score: Score, events: readonly Ev[], salt: number, level: (own: number) => number): void {
  if (!events.length) return;
  const s = new Bus(b.sr, score.duration + score.tail, (score.noiseSeed ^ salt) >>> 0, score.movement.tone, b.a4);
  s.duck = b.duck;
  playAll(s, events);
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
  pingpong(b, mix.delayBeats * beat, mix.delayFeedback, mix.delayWet);
  // the room hears nothing below 350 Hz (no mud) and starts 45 ms late (the dry attack stays clear)
  const rl = new SVF(sr, 7000);
  const rh = new SVF(sr, 350);
  for (let i = 0; i < n; i++) {
    rh.run(rl.run(REV[i]));
    REV[i] = rh.hp;
  }
  freeverb(sr, REV, L, R, mix.room, mix.reverb, Math.round(0.045 * sr), 0.35);
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
  const gain = Number.isFinite(measured)
    ? Math.min(6, 10 ** ((targetLufs(mix, score.section.energy) - measured) / 20))
    : 1;

  // glue compressor, 2:1 above -10 dBFS
  const ca = Math.exp(-1 / (0.01 * sr));
  const cr = Math.exp(-1 / (0.15 * sr));
  let env = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i] * gain;
    const r = R[i] * gain;
    const pk = Math.max(Math.abs(l), Math.abs(r));
    env = pk > env ? ca * env + (1 - ca) * pk : cr * env + (1 - cr) * pk;
    const over = 20 * Math.log10(env + 1e-9) + 10;
    const gr = over > 0 ? 10 ** (-over / 40) : 1;
    L[i] = l * gr;
    R[i] = r * gr;
  }

  for (const s of ev('stop')) tapeStop(b, s.t, s.d);
  limit(b, 10 ** (-1.5 / 20));

  // the tail is cut where the next section's own tails take over; fade it so the cut can't click
  const f0 = Math.round((score.duration + score.tail - 1.5) * sr);
  for (let i = Math.max(0, f0); i < n; i++) {
    const g = 0.5 + 0.5 * Math.cos((Math.PI * (i - f0)) / (n - 1 - f0));
    L[i] *= g;
    R[i] *= g;
  }
  return { gain, measured };
}

/**
 * The guitar amp: a high-pass (no flub), a pre-emphasis so the drive bites in the mids, asymmetric soft
 * clipping, then a speaker cabinet (a low-pass near 4.5 kHz with a presence bump) and a doubled, slightly
 * delayed copy on the other side for width.
 */
function amp(b: Bus): void {
  const { sr, n, AMP, ML, MR, REV, DLY } = b;
  const hp = new SVF(sr, 110, 0.7);
  const pre = new SVF(sr, 900, 0.7);
  const cab = new SVF(sr, 4500, 0.9);
  const presence = new SVF(sr, 2400, 1.4);
  const dbl = Math.round(0.013 * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hp.run(AMP[i]);
    pre.run(hp.hp);
    const x = hp.hp + 1.5 * pre.bp;
    const clipped = Math.tanh(6 * x + 0.3) - Math.tanh(0.3);
    presence.run(clipped);
    out[i] = (cab.run(clipped) + 0.35 * presence.bp) * 0.14;
  }
  for (let i = 0; i < n; i++) {
    const d = 1 - 0.3 * (1 - b.duck[i]);
    const o = out[i] * d;
    const other = (i >= dbl ? out[i - dbl] : 0) * d;
    ML[i] += o * 0.9 + other * 0.35;
    MR[i] += other * 0.9 + o * 0.35;
    REV[i] += o * 0.2;
    DLY[i] += o * 0.1;
  }
}

function pingpong(b: Bus, time: number, fb: number, wet: number): void {
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
