// Part writers shared by the styles: drum grids, basslines, chord beds, arpeggios and transition effects.
// Each writes events into the section's context; the styles decide which ones play when.

import { mod, voiceLead } from '../theory.ts';
import type { Rng } from '../rng.ts';
import type { AcidNote, BassKind, HatKind, KickKind, PadKind, SnareKind, StringKind } from '../types.ts';
import { type ChordSlot, type Ctx, PAD_HI, PAD_LO, sectionChords } from './context.ts';

const VEL: Record<string, number> = { x: 1, o: 0.72, '-': 0.42 };

/** Calls `fn` for each hit in a grid string: x = full, o = medium, - = ghost, anything else = rest. */
export function grid(pattern: string, fn: (step: number, v: number) => void): void {
  for (let s = 0; s < pattern.length; s++) {
    const v = VEL[pattern[s]];
    if (v) fn(s, v);
  }
}

export interface DrumKit {
  kick?: KickKind;
  snare?: SnareKind;
  hat?: HatKind;
  /** Sidechain depth of the kick: how far the music bus ducks on each hit. */
  sc?: number;
  /** Level of hats and shakers relative to the rest of the kit. */
  hats?: number;
}

export interface DrumBar {
  kick?: string;
  snare?: string;
  hat?: string;
  open?: string;
  shaker?: string;
}

/** One bar of drums from grid strings, with humanized velocity and timing (the kick stays on the grid). */
export function drums(ctx: Ctx, bar: number, p: DrumBar, kit: DrumKit, gain = 1): void {
  const r = ctx.rng;
  const t = (s: number) => ctx.barAt(bar, s);
  const human = (s: number) => Math.max(0, t(s) + r.jitter(0.004));
  if (p.kick) {
    grid(
      p.kick,
      (s, v) =>
        ctx.push({ i: 'kick', t: t(s), v: v * gain, k: kit.kick ?? 'big', sc: (kit.sc ?? 0.4) * v, n: ctx.kickNote }),
    );
  }
  if (p.snare) {
    grid(
      p.snare,
      (s, v) => ctx.push({ i: 'snare', t: human(s), v: v * gain * (0.94 + 0.06 * r.next()), k: kit.snare ?? 'big' }),
    );
  }
  const hg = gain * (kit.hats ?? 1);
  if (p.hat) {
    grid(
      p.hat,
      (s, v) => ctx.push({ i: 'hat', t: human(s), v: v * hg * (0.82 + 0.18 * r.next()), k: kit.hat ?? 'closed' }),
    );
  }
  if (p.open) grid(p.open, (s, v) => ctx.push({ i: 'hat', t: human(s), v: v * hg, k: 'open' }));
  if (p.shaker) {
    grid(p.shaker, (s, v) => ctx.push({ i: 'hat', t: human(s), v: v * hg * (0.8 + 0.2 * r.next()), k: 'shaker' }));
  }
}

/** A snare roll that accelerates: [bars, hits] segments starting at `bar`, velocity rising v0 -> v1. */
export function roll(
  ctx: Ctx,
  bar: number,
  segs: [number, number][],
  v0: number,
  v1: number,
  k: SnareKind = 'roll',
): void {
  const hits: number[] = [];
  let t = ctx.barAt(bar);
  for (const [bars, n] of segs) {
    const d = bars * ctx.bar;
    for (let i = 0; i < n; i++) hits.push(t + (i * d) / n);
    t += d;
  }
  hits.forEach((x, i) =>
    ctx.push({ i: 'snare', t: x, v: v0 + (v1 - v0) * (i / Math.max(1, hits.length - 1)) ** 1.5, k })
  );
}

/**
 * A build's roll across its whole run of sections: quarters, then eighths, then sixteenths, velocity rising
 * throughout; each section writes the hits that fall inside it.
 */
export function runRoll(ctx: Ctx, v0: number, v1: number, k: SnareKind = 'roll'): void {
  const T = ctx.runBars;
  const plan: [number, number][] = [[T / 2, T * 2], [T / 4, T * 2], [T / 4, T * 4]];
  const hits: number[] = [];
  let start = 0;
  for (const [bars, n] of plan) {
    for (let i = 0; i < n; i++) hits.push(start + (i * bars) / n);
    start += bars;
  }
  hits.forEach((bar, i) => {
    const local = bar - ctx.runStartBar;
    if (local < 0 || local >= ctx.bars) return;
    ctx.push({ i: 'snare', t: ctx.barAt(local), v: v0 + (v1 - v0) * (i / Math.max(1, hits.length - 1)) ** 1.5, k });
  });
}

/** A riser (and the build's high-pass sweep, if asked) covering this section's share of the run. */
export function runRiser(ctx: Ctx, k: 'build' | 'sweep', sweep: boolean): void {
  const x0 = ctx.runAt(0);
  const x1 = ctx.runAt(1);
  ctx.push({ i: 'rise', t: 0, d: ctx.duration, k, x0, x1 });
  if (sweep) ctx.push({ i: 'sweep', t: 0, d: ctx.duration, x0, x1 });
}

/** Four toms falling through the chord on the last beat of a bar. */
export function tomFill(ctx: Ctx, bar: number, slot: ChordSlot, v = 0.8): void {
  const ns = slot.voicing.slice().sort((a, b) => b - a).slice(0, 4).map((n) => n - 12);
  ns.forEach((n, i) => ctx.push({ i: 'tom', t: ctx.barAt(bar, 12 + i), v: v * (0.85 + 0.05 * i), n }));
}

// ------------------------------------------------------------------ bass

/** Folds a chord root into the bass register (E1..G2). */
export function bassRoot(ctx: Ctx, slot: ChordSlot): number {
  let r = ctx.root(slot);
  while (r > 43) r -= 12;
  while (r < 28) r += 12;
  return r;
}

export function sustainedBass(ctx: Ctx, k: BassKind, v: number, fromBar = 0, toBar = ctx.bars, rel?: number): void {
  for (const slot of ctx.chords) {
    const a = Math.max(slot.bar, fromBar);
    const b = Math.min(slot.bar + slot.bars, toBar);
    if (b <= a) continue;
    ctx.push({ i: 'bass', t: ctx.barAt(a), d: (b - a) * ctx.bar - 0.02, n: bassRoot(ctx, slot), v, k, rel });
  }
}

/**
 * A bass figure per bar from a grid: each hit is [step, length in 16ths, interval above the root, velocity].
 * `approach` turns interval 'A' into a chromatic step into the next bar's root.
 */
export type BassHit = readonly [step: number, len: number, interval: number | 'A', v: number];

export function bassFigure(ctx: Ctx, bar: number, hits: readonly BassHit[], k: BassKind, gain: number): void {
  const slot = ctx.chordAt(bar);
  const root = bassRoot(ctx, slot);
  const nextRoot = bar + 1 < ctx.bars ? bassRoot(ctx, ctx.chordAt(bar + 1)) : root;
  for (const [s, len, iv, v] of hits) {
    const n = iv === 'A' ? (nextRoot === root ? root + 7 : nextRoot + (nextRoot > root ? -1 : 1)) : root + iv;
    ctx.push({ i: 'bass', t: ctx.barAt(bar, s), d: len * ctx.s16 * 0.92, n, v: v * gain, k });
  }
}

// Rolling bass under a four-on-the-floor kick: the kick owns each beat's first 16th, the bass plays 16ths 2-4,
// written here as intervals above the root per beat.
const rolling = (beats: number[][]): BassHit[] =>
  beats.flatMap((ivs, b) => ivs.map((iv, j): BassHit => [b * 4 + j + 1, 1, iv, [0.8, 1, 0.6][j]]));
export const ROLLING: readonly BassHit[][] = [
  rolling([[12, 0, 0], [0, 0, 12], [12, 0, 0], [12, 0, 7]]),
  rolling([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 12, 0]]),
];
export const OFFBEAT: readonly BassHit[] = [[2, 2, 0, 1], [6, 2, 0, 1], [10, 2, 0, 1], [14, 2, 0, 1]];
export const EIGHTHS: readonly BassHit[] = [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 2, 0, s % 4 ? 0.8 : 1] as const);
export const OCTAVES: readonly BassHit[] = [0, 2, 4, 6, 8, 10, 12, 14].map((s) =>
  [s, 2, s % 4 === 2 ? 12 : 0, s % 4 ? 0.8 : 1] as const
);

// ------------------------------------------------------------------ chords

export interface PadOpts {
  cut: (slot: ChordSlot, i: number) => [number, number];
  g?: number;
  transpose?: number;
  fromBar?: number;
  toBar?: number;
  rel?: number;
}

export function padChords(ctx: Ctx, k: PadKind, o: PadOpts): void {
  const bright = ctx.mv.tone.bright;
  ctx.chords.forEach((slot, i) => {
    const a = Math.max(slot.bar, o.fromBar ?? 0);
    const b = Math.min(slot.bar + slot.bars, o.toBar ?? ctx.bars);
    if (b <= a) return;
    const [c0, c1] = o.cut(slot, i);
    ctx.push({
      i: 'pad',
      t: ctx.barAt(a),
      d: (b - a) * ctx.bar,
      k,
      n: slot.voicing.map((n) => n + (o.transpose ?? 0)),
      cut: [c0 * bright, c1 * bright],
      g: o.g,
      rel: o.rel,
    });
  });
}

/**
 * The organ plays voice by voice, like an organist's fingers: a note that survives the chord change is held,
 * so the sound never dips at the bar line.
 */
export function organChords(ctx: Ctx, g: number, swell = 0, fromBar = 0, toBar = ctx.bars): void {
  const held: { i: 'organ'; t: number; d: number; n: number; att: number; g: number; swell: number }[] = [];
  ctx.chords.forEach((slot) => {
    const a = Math.max(slot.bar, fromBar);
    const b = Math.min(slot.bar + slot.bars, toBar);
    if (b <= a) return;
    const t = ctx.barAt(a);
    const d = (b - a) * ctx.bar;
    slot.voicing.forEach((n, v) => {
      if (held[v] && held[v].n === n && Math.abs(held[v].t + held[v].d - 0.04 - t) < 1e-6) held[v].d += d;
      else {
        held[v] = { i: 'organ', t, d: d + 0.04, n, att: held[v] ? 0.06 : 0.03, g, swell };
        ctx.push(held[v]);
      }
    });
  });
}

/** Chords on a comping rhythm: [step, length in 16ths] hits per bar. */
export function comp(ctx: Ctx, bar: number, hits: readonly (readonly [number, number])[], v: number): void {
  const slot = ctx.chordAt(bar);
  for (const [s, len] of hits) {
    ctx.push({ i: 'keys', t: ctx.barAt(bar, s), d: len * ctx.s16 * 0.95, n: slot.voicing, v: v * (s === 0 ? 1 : 0.8) });
  }
}

// ------------------------------------------------------------------ arpeggios

export type ArpShape = 'hemi' | 'up' | 'updown' | 'broken';

/** Chord tones stacked upward from near `from`: root, third, fifth (seventh), root an octave up. */
export function arpNotes(slot: ChordSlot, from: number): number[] {
  const root = from + ((slot.pcs[0] - from) % 12 + 12) % 12;
  const out = [root];
  for (const p of slot.pcs.slice(1, 4)) {
    let n = out[out.length - 1] + 1;
    while ((n % 12) !== p) n++;
    out.push(n);
  }
  out.push(root + 12);
  return out;
}

export function arp(
  ctx: Ctx,
  bar: number,
  shape: ArpShape,
  o: { v: number; cut: (x: number) => number; from?: number; rate?: 1 | 2; dec?: number },
): void {
  const slot = ctx.chordAt(bar);
  const ns = arpNotes(slot, o.from ?? 62);
  const rate = o.rate ?? 1;
  for (let s = 0; s < 16; s += rate) {
    // a global step counter keeps the 3-note hemiola drifting across bar lines
    const g = bar * 16 + s + ctx.local * 997;
    const k = s / rate;
    let n: number;
    switch (shape) {
      case 'hemi':
        n = ns[(g % 3) + (Math.floor(g / 3) % 2)];
        break;
      case 'up':
        n = ns[k % ns.length];
        break;
      case 'updown': {
        const cyc = 2 * ns.length - 2;
        const q = k % cyc;
        n = ns[q < ns.length ? q : cyc - q];
        break;
      }
      case 'broken':
        n = ns[[0, 2, 1, 3, 4, 3, 2, 1][k % 8] % ns.length];
        break;
    }
    ctx.push({
      i: 'pluck',
      t: ctx.barAt(bar, s),
      n,
      v: o.v * (s % 4 ? 0.72 : 1),
      cut: o.cut((bar + s / 16) / ctx.bars),
      p: k % 2 ? 0.35 : -0.35,
      dec: o.dec,
    });
  }
}

// ------------------------------------------------------------------ effects and transitions

/** A chord voicing an octave up, bright enough to cut through an impact. */
export function stab(slot: ChordSlot): number[] {
  return slot.voicing.map((n) => n + 12);
}

/** Reversed crash into the next section when it's bigger than this one. */
export function cymbalInto(ctx: Ctx, beats = 2): void {
  const d = beats * ctx.beat;
  ctx.push({ i: 'rise', t: ctx.duration - d, d, k: 'cymbal' });
}

/** The chord the next movement opens on, voiced, for a reverse swell into it. */
export function nextOpeningChord(ctx: Ctx): number[] {
  const next = ctx.nextMovement;
  if (!next) return [];
  const first = sectionChords(next, 0)[0];
  return voiceLead(null, first.pcs, 4, PAD_LO, PAD_HI);
}

/** Movement hand-over, written into the last section. */
export function transition(ctx: Ctx): void {
  if (!ctx.isLast) return;
  switch (ctx.mv.transition) {
    case 'swell':
      ctx.push({ i: 'rise', t: ctx.duration - 2.4, d: 2.4, k: 'swell', n: nextOpeningChord(ctx) });
      break;
    case 'stop':
      ctx.push({ i: 'stop', t: ctx.duration - ctx.beat, d: ctx.beat });
      break;
    case 'fade':
      break;
  }
}

// ------------------------------------------------------------------ v2: guitars, piano, percussion, acid

/** A guitar voicing: the chord spread over six strings' worth of range, low to high. */
export function guitarVoicing(slot: ChordSlot, low = 40): number[] {
  const out: number[] = [];
  let n = low + mod(slot.pcs[0] - low, 12);
  out.push(n);
  const order = [
    slot.pcs[2] ?? slot.pcs[0],
    slot.pcs[0],
    slot.pcs[1],
    slot.pcs[2] ?? slot.pcs[0],
    slot.pcs[3] ?? slot.pcs[0],
  ];
  for (const p of order) {
    n += 1 + mod(p - (n + 1), 12);
    if (n > low + 26) break;
    out.push(n);
  }
  return out;
}

/** A strum: the strings a few milliseconds apart, down (low to high) or up. */
export function strum(
  ctx: Ctx,
  t: number,
  notes: readonly number[],
  k: StringKind,
  v: number,
  d?: number,
  up = false,
): void {
  const ns = up ? notes.slice().reverse() : notes;
  ns.forEach((n, i) => ctx.push({ i: 'string', t: t + i * 0.011, n, v: v * (up ? 0.8 : 1) * (1 - 0.04 * i), k, d }));
}

/** Fingerpicking or an arpeggio on a plucked string instrument, one bar, from a pattern of voicing indices. */
export function pick(
  ctx: Ctx,
  bar: number,
  k: StringKind,
  idx: readonly number[],
  every: 1 | 2,
  v: number,
  low = 40,
): void {
  const ns = guitarVoicing(ctx.chordAt(bar), low);
  for (let s = 0, j = 0; s < 16; s += every, j++) {
    const i = idx[j % idx.length];
    if (i < 0) continue;
    ctx.push({ i: 'string', t: ctx.barAt(bar, s), n: ns[Math.min(ns.length - 1, i)], v: v * (s % 4 ? 0.8 : 1), k });
  }
}

export type PianoFigure = 'broken' | 'alberti' | 'block' | 'rolling';

/** The left hand under a piano melody, one bar: a figure over the chord's root, fifth and tenth. */
export function pianoBar(ctx: Ctx, bar: number, fig: PianoFigure, v: number): void {
  const slot = ctx.chordAt(bar);
  const root = ctx.root(slot) + 12 > 55 ? ctx.root(slot) : ctx.root(slot) + 12;
  const up = arpNotes(slot, root);
  const t = (s: number) => ctx.barAt(bar, s);
  const note = (s: number, n: number, d: number, vv = v) =>
    ctx.push({ i: 'piano', t: t(s), d: d * ctx.s16, n: [n], v: vv });
  switch (fig) {
    case 'broken':
      [0, 2, 4, 6, 8, 10, 12, 14].forEach((s, k) =>
        note(s, up[[0, 2, 1, 3, 4, 3, 1, 2][k] % up.length], 3, v * (k % 4 ? 0.75 : 1))
      );
      break;
    case 'alberti':
      [0, 2, 4, 6, 8, 10, 12, 14].forEach((s, k) => note(s, up[[0, 2, 1, 2][k % 4]], 2, v * (k % 2 ? 0.7 : 0.9)));
      break;
    case 'rolling':
      for (let s = 0; s < 16; s++) {
        note(s, up[[0, 1, 2, 3, 4, 3, 2, 1][s % 8] % up.length], 2, v * (s % 4 ? 0.65 : 0.9));
      }
      break;
    case 'block':
      ctx.push({ i: 'piano', t: t(0), d: 7.5 * ctx.s16, n: [up[0], up[1], up[2]], v: v * 0.9 });
      ctx.push({ i: 'piano', t: t(8), d: 7.5 * ctx.s16, n: [up[0], up[1], up[2]], v: v * 0.75 });
      break;
  }
}

export interface PercBar {
  conga?: string;
  congaHi?: string;
  bongo?: string;
  cowbell?: string;
  ride?: string;
  snap?: string;
}

// hand drums tuned to the key: the low conga on the fifth, the high one on the tonic, the bongo a fifth above
const DRUM_TUNING: Partial<Record<keyof PercBar, number>> = { conga: 19, congaHi: 24, bongo: 31 };

export function percBar(ctx: Ctx, bar: number, p: PercBar, gain = 1): void {
  const r = ctx.rng;
  for (const k of ['conga', 'congaHi', 'bongo', 'cowbell', 'ride', 'snap'] as const) {
    const pat = p[k];
    const tune = DRUM_TUNING[k];
    const n = tune === undefined ? undefined : ctx.tonicLow + tune;
    if (pat) {
      grid(pat, (s, v) =>
        ctx.push({
          i: 'perc',
          t: Math.max(0, ctx.barAt(bar, s) + r.jitter(0.004)),
          v: v * gain * (0.85 + 0.15 * r.next()),
          k,
          n,
        }));
    }
  }
}

export const crash = (ctx: Ctx, bar = 0, v = 0.8) => ctx.push({ i: 'perc', t: ctx.barAt(bar), v, k: 'crash' });

/**
 * An acid pattern for the movement: sixteen steps of notes drawn from the key's darker degrees (root, octave,
 * minor third, fifth, seventh), with rests, accents and slides placed where the groove wants them.
 */
export function acidPattern(rng: Rng): { deg: number; oct: number; on: boolean; accent: boolean; slide: boolean }[] {
  const pool: readonly (readonly [number, number])[] = [[0, 6], [0, 6], [2, 2], [4, 2], [6, 1.5], [7, 2], [1, 0.6], [
    3,
    0.8,
  ]];
  return Array.from({ length: 16 }, (_, s) => ({
    deg: rng.weighted(pool),
    oct: rng.chance(s % 4 === 2 ? 0.35 : 0.15) ? 1 : 0,
    on: s % 4 === 0 || rng.chance(0.62),
    accent: rng.chance(s % 4 === 2 ? 0.5 : 0.18),
    slide: rng.chance(0.22),
  }));
}

/** The acid pattern over `bars` bars as one phrase, fitted to each bar's chord root. */
export function acidLine(
  ctx: Ctx,
  pattern: ReturnType<typeof acidPattern>,
  fromBar: number,
  bars: number,
  cut: [number, number],
  res: number,
  env: number,
  square: boolean,
): void {
  const ns: AcidNote[] = [];
  for (let b = fromBar; b < fromBar + bars; b++) {
    const slot = ctx.chordAt(b);
    const rd = ctx.rootDegree(slot);
    // degrees count up the mode from the chord's root, in the register the 303 lives in (around C2-C3)
    const base = ctx.pitch(rd, slot, ctx.tonicLow + 12);
    const lift = base > 50 ? -12 : 0;
    pattern.forEach((p, s) => {
      if (!p.on) return;
      const n = ctx.pitch(rd + p.deg, slot, ctx.tonicLow + 12) + lift + 12 * p.oct;
      ns.push({
        t: ctx.barAt(b, s),
        d: ctx.s16 * (p.slide ? 1.05 : 0.6),
        n,
        v: p.accent ? 1 : 0.7,
        accent: p.accent,
        slide: p.slide,
      });
    });
  }
  if (ns.length) ctx.push({ i: 'acid', t: ns[0].t, ns, cut, res, env, square });
}
