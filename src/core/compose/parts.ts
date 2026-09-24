// Part writers shared by the styles: drum grids, basslines, chord beds, arpeggios and transition effects.
// Each writes events into the section's context; the styles decide which ones play when.

import { voiceLead } from '../theory.ts';
import type { BassKind, HatKind, KickKind, PadKind, SnareKind } from '../types.ts';
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
