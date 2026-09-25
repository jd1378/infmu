// Renders one section's score to stereo audio: every instrument into the buses, then the section's own
// master chain. Sections are rendered independently and overlap by their tails when played, so any
// section can be rendered (and heard) without the ones before it.

import type { Ev, Score } from '../types.ts';
import { Bus } from './bus.ts';
import { freeverb, lufs, SVF, TAU } from './dsp.ts';
import * as I from './instruments.ts';

export interface Rendered {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Loudness of the section before leveling, and the gain applied to reach its target. */
  lufs: number;
  gain: number;
}

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;

/** Target loudness: a drop sits at streaming loudness, an ambient intro well below it. */
export const targetLufs = (energy: number) => -14 - 7 * (1 - energy);

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
};

export function renderScore(score: Score, sampleRate: number): Rendered {
  const b = new Bus(sampleRate, score.duration + score.tail, score.noiseSeed, score.movement.tone);
  const kicks = score.events.filter((e): e is E<'kick'> => e.i === 'kick');
  b.duck = I.sidechain(b, kicks);
  for (const e of score.events) {
    const play = PLAY[e.i] as ((b: Bus, e: Ev) => void) | undefined;
    play?.(b, e);
  }
  const { gain, measured } = master(b, score);
  return { left: b.L, right: b.R, sampleRate, lufs: measured, gain };
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
        const c = 20 * 30 ** (Math.min(1, j / len) ** 2);
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
  const gain = Number.isFinite(measured) ? Math.min(6, 10 ** ((targetLufs(score.section.energy) - measured) / 20)) : 1;

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
