// Curated grooves: for each style, a bank of drum and bass patterns written the way a producer programs them.
// A movement picks one groove and keeps it. Sections vary it only in the ways written here (light or full, the
// layer, the answer bar, the fill), so a piece stays coherent while pieces of one style sound different.

import type { BassKind, Meter } from '../types.ts';
import { hash32, Rng } from '../rng.ts';
import type { Ctx } from './context.ts';
import { bassFigure, type BassHit, type DrumBar, type DrumKit, drums, grid, type PercBar, percBar } from './parts.ts';
import { drummed } from './perform.ts';

/** Pitched drums, taiko or toms: `lo` on the tonic (octave 2), `mid` a fifth above it, `hi` an octave above it. */
export interface TomBar {
  lo?: string;
  mid?: string;
  hi?: string;
}

/** Every lane one bar of a groove can use. */
export type GrooveBar = DrumBar & PercBar & TomBar;

export interface Groove {
  name: string;
  /** Kit sounds merged over the style's kit (a clap instead of a gated snare, a rim instead of a snare). */
  kit?: DrumKit;
  /** Verse, prechorus, solo backing, outro. */
  light: GrooveBar;
  /** Chorus and drop. */
  full: GrooveBar;
  /** Lanes swapped in on the last bar of an 8-bar phrase. */
  fill: GrooveBar;
  /** Lanes swapped in on every second bar of full sections: the reply that turns one bar into a 2-bar loop. */
  answer?: GrooveBar;
  /** Lanes added from the second verse on, and in every chorus or drop after the first 8 bars of the first. */
  layer?: GrooveBar;
  bassLight: readonly BassHit[];
  bassFull: readonly BassHit[];
  /** Bass on fill bars of full sections; by default the bar's figure before step 12, leaving the fill room. */
  bassFill?: readonly BassHit[];
  /** Bass on answer bars, when the answer moves the kick. */
  bassAnswer?: readonly BassHit[];
  /** Bass sound for full sections, when not the style's usual one. */
  bassKind?: BassKind;
  /** Snare, clap and rim this fraction of a 16th behind the grid: the lazy backbeat (`drums()` must apply it). */
  lag?: number;
}

export type Weighted<T> = readonly (readonly [T, number])[];

/** A style's banks for each time it plays in: the movement's time picks one (four when it has no other). */
export type Banks<G extends Groove = Groove> = { '4/4': Weighted<G> } & Partial<Record<Meter, Weighted<G>>>;
export const inTime = <G extends Groove>(ctx: Ctx, banks: Banks<G>): Weighted<G> => banks[ctx.mv.meter] ?? banks['4/4'];

/** The lanes of one bar; `runBar` counts from the start of the run, so phrases line up across sections. */
export function grooveLanes(g: Groove, full: boolean, runBar: number, layer: boolean, fill: boolean): GrooveBar {
  return {
    ...(full ? g.full : g.light),
    ...(layer ? g.layer : undefined),
    ...(full && runBar % 2 ? g.answer : undefined),
    ...(fill ? g.fill : undefined),
  };
}

export function grooveBass(g: Groove, full: boolean, runBar: number, fill: boolean): readonly BassHit[] {
  const base = full ? g.bassFull : g.bassLight;
  if (fill) return (full && g.bassFill) || base.filter(([s]) => s < 12);
  return full && runBar % 2 && g.bassAnswer ? g.bassAnswer : base;
}

/** One bar of a groove: the kit, hand percussion at `perc` relative level, and pitched drums. */
export function grooveBar(ctx: Ctx, bar: number, p: GrooveBar, kit: DrumKit, gain = 1, perc = 0.6): void {
  drums(ctx, bar, p, kit, gain);
  percBar(ctx, bar, p, gain * perc, kit.acoustic);
  const t = (s: number) => Math.max(0, ctx.barAt(bar, s) + ctx.rng.jitter(0.005));
  const lo = ctx.tonicLow + 12;
  for (const [pat, n] of [[p.lo, lo], [p.mid, lo + 7], [p.hi, lo + 12]] as const) {
    if (pat) {
      grid(
        pat,
        (s, v) => ctx.push({ i: 'tom', t: t(s), v: v * gain, n, ...(kit.acoustic ? { k: 'acoustic' } : {}) }),
        ctx.spb,
      );
    }
  }
}

/**
 * The movement's groove, drawn once from its style's bank. A piece right after one of the same style draws
 * again until it differs, so two in a row never share a beat.
 */
export function grooveFor<G extends Groove>(ctx: Ctx, bank: Weighted<G>): G {
  const draw = (seed: number, k: number) => new Rng(hash32(seed, 0x6d6f74)).fork('groove', k).weighted(bank);
  const prev = ctx.mv.index > 0 ? ctx.song.movement(ctx.mv.index - 1) : null;
  const taken = prev?.style === ctx.mv.style ? draw(prev.seed, 0).name : null;
  for (let k = 0; k < 8; k++) {
    const g = draw(ctx.mv.seed, k);
    if (g.name !== taken) return g;
  }
  return draw(ctx.mv.seed, 0);
}

/** How a style plays its groove: its kit and bass voice, and the levels. */
export interface GroovePlay {
  kit: DrumKit;
  bass: BassKind;
  bassGain: number;
  gain?: number;
  perc?: number;
  /** False when the section writes its own bass (sustained, say). */
  withBass?: boolean;
}

/** Styles whose drummer fills round the toms. */
const TOMS: ReadonlySet<string> = new Set(['ember', 'cathedral']);

/**
 * A drummer's fill is never quite the same twice: as written, or started half-way through the bar, or with a
 * pickup of ghost notes into the downbeat, or (on a kit with toms) its last beat taken round the toms. A drum
 * machine plays its programmed fill every time.
 */
function fillOf(ctx: Ctx, g: Groove, full: boolean, rb: number, layer: boolean): GrooveBar {
  const written = grooveLanes(g, full, rb, layer, true);
  if (!drummed(ctx.mv.style)) return written;
  const rng = new Rng(hash32(ctx.mv.seed, ctx.local, rb, 0x66696c));
  const ways: [string, number][] = [['written', 3], ['late', 2], ['pickup', 2]];
  if (TOMS.has(ctx.mv.style)) ways.push(['toms', 2]);
  const base = grooveLanes(g, full, rb, layer, false);
  const out: GrooveBar = { ...written };
  const lanes = Object.keys(g.fill) as (keyof GrooveBar)[];
  const spb = ctx.spb;
  const rest = '.'.repeat(spb);
  switch (rng.weighted(ways)) {
    case 'late':
      for (const k of lanes) out[k] = (base[k] ?? rest).slice(0, spb / 2) + (written[k] ?? '').slice(spb / 2);
      break;
    case 'pickup': {
      const sn = [...(written.snare ?? rest)];
      for (let s = spb - 4; s < spb; s++) if (sn[s] === '.') sn[s] = '-';
      out.snare = sn.join('');
      break;
    }
    case 'toms': {
      const sn = [...(written.snare ?? rest)];
      const toms = { hi: [...rest], mid: [...rest], lo: [...rest] };
      const order = ['hi', 'hi', 'mid', 'lo'] as const;
      let k = 0;
      for (let s = spb - 4; s < spb; s++) {
        if (sn[s] === '.') continue;
        toms[order[Math.min(3, k++)]][s] = sn[s];
        sn[s] = '.';
      }
      if (!k) break;
      out.snare = sn.join('');
      out.hi = toms.hi.join('');
      out.mid = toms.mid.join('');
      out.lo = toms.lo.join('');
      break;
    }
  }
  return out;
}

/** A bar's hats and shakers on the eighths only. */
function eighths(p: GrooveBar): GrooveBar {
  const out = { ...p };
  for (const lane of ['hat', 'shaker'] as const) {
    const pat = out[lane];
    if (pat) out[lane] = [...pat].map((c, s) => (s % 2 ? '.' : c)).join('');
  }
  return out;
}

/**
 * Bar `b` of the movement's groove in the current section. Verses, prechoruses and outros play it light,
 * choruses, drops and solos full (with the answer bar on every second bar). A returning part adds the groove's
 * layer, as does the second half of a long chorus or drop; the last bar of each 8-bar phrase fills. The
 * prechorus lifts the bass before the drums.
 */
export function playGroove(ctx: Ctx, g: Groove, b: number, o: GroovePlay): void {
  const rb = ctx.runBar(b);
  const full = ctx.role === 'chorus' || ctx.role === 'drop' || ctx.role === 'solo';
  const layer = ctx.role !== 'solo' && (ctx.returning || rb >= 8);
  const fill = rb % 8 === 7 && (full || ctx.role === 'verse');
  const kit = { ...o.kit, ...g.kit, lag: g.lag };
  // a still piece's drums play only its big parts; a flowing one's hats and shakers play eighths
  const lanes = fill ? fillOf(ctx, g, full, rb, layer) : grooveLanes(g, full, rb, layer, false);
  if (ctx.mv.motion !== 'still' || full) {
    grooveBar(ctx, b, ctx.mv.motion === 'flowing' ? eighths(lanes) : lanes, kit, o.gain ?? 1, o.perc ?? 0.6);
  }
  if (o.withBass === false) return;
  const bass = ctx.role === 'prechorus' ? g.bassFull : grooveBass(g, full, rb, fill);
  bassFigure(ctx, b, bass, full ? g.bassKind ?? o.bass : o.bass, o.bassGain);
}

// ------------------------------------------------------------------ rise: trance, 120-128 bpm
// Always four on the floor with the clap on 2 and 4; the bass lives between the kicks.

export const RISE: Weighted<Groove> = [
  [{
    name: 'uplifting roller',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', hat: '--.---.---.---.-', open: '..o...o...o...o.' },
    full: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xo.xxo.xxo.xxo.x', open: '..x...x...x...x.' },
    fill: { kick: 'x...x...x.......', snare: '....x.......-oxx' },
    layer: { ride: 'o...o...o...o...' },
    bassLight: [[2, 2, 0, 1], [6, 2, 0, 0.9], [10, 2, 0, 1], [14, 2, 0, 0.9]],
    bassFull: [
      [1, 1, 12, 0.8],
      [2, 1, 0, 1],
      [3, 1, 0, 0.6],
      [5, 1, 0, 0.8],
      [6, 1, 0, 1],
      [7, 1, 12, 0.6],
      [9, 1, 12, 0.8],
      [10, 1, 0, 1],
      [11, 1, 0, 0.6],
      [13, 1, 12, 0.8],
      [14, 1, 0, 1],
      [15, 1, 7, 0.6],
    ],
    bassKind: 'roll',
  }, 3],
  [{
    name: 'nineties offbeat',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', open: '..o...o...o...o.' },
    full: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '.-.o.-.o.-.o.-.o', open: '..x...x...x...x.' },
    fill: { snare: '....x.....o.oxxx', open: '..x...x.........' },
    layer: { ride: '..o...o...o...o.' },
    bassLight: [[2, 2, 0, 1], [6, 2, 0, 0.85], [10, 2, 0, 1], [14, 2, 12, 0.85]],
    bassFull: [[2, 2, 0, 1], [6, 2, 12, 0.9], [10, 2, 0, 1], [14, 2, 12, 0.9]],
    bassKind: 'saw',
  }, 2],
  [{
    name: 'progressive gallop',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', hat: '..o...o...o...o.', shaker: '-o-o-o-o-o-o-o-o' },
    full: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: '..x...x...x...x.',
      shaker: '-o-o-o-o-o-o-o-o',
      snap: '.......o.......o',
    },
    fill: { snare: '....x.......x-o-', hat: '..x...x...x.....', open: '..............x.' },
    layer: { conga: '...o......o..o..', congaHi: '......o.......o.' },
    bassLight: [[2, 2, 0, 1], [6, 1, 0, 0.9], [7, 1, 0, 0.7], [10, 2, 0, 1], [14, 1, 0, 0.9], [15, 1, 0, 0.7]],
    bassFull: [
      [2, 1, 0, 1],
      [3, 1, 0, 0.7],
      [6, 1, 0, 1],
      [7, 1, 12, 0.75],
      [10, 1, 0, 1],
      [11, 1, 0, 0.7],
      [14, 1, 0, 1],
      [15, 1, 7, 0.75],
    ],
    bassKind: 'roll',
  }, 2],
  [{
    name: 'tech driver',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', hat: '.-.-.-.-.-.-.-.-', ride: '..o...o...o...o.' },
    full: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: '.-.-.-.-.-.-.-.-',
      ride: 'o.x.o.x.o.x.o.x.',
      snap: '..o..o..o..o..o.',
    },
    fill: { kick: 'x...x...x...xxxx', snare: '....x...........' },
    layer: { open: '..o...o...o...o.' },
    bassLight: [[2, 1, 0, 1], [6, 1, 0, 1], [7, 1, 0, 0.6], [10, 1, 0, 1], [14, 1, 0, 1], [15, 1, 0, 0.6]],
    bassFull: [
      [1, 1, 0, 0.7],
      [2, 1, 0, 1],
      [3, 1, 0, 0.55],
      [5, 1, 0, 0.7],
      [6, 1, 0, 1],
      [7, 1, 0, 0.55],
      [9, 1, 0, 0.7],
      [10, 1, 0, 1],
      [11, 1, 0, 0.55],
      [13, 1, 0, 0.7],
      [14, 1, 0, 1],
      [15, 1, 12, 0.6],
    ],
    bassKind: 'roll',
  }, 1],
  [{
    name: 'balearic',
    light: {
      kick: 'x...x...x...x...',
      snare: '....o.......o...',
      shaker: '-.o.-.o.-.o.-.o.',
      congaHi: '......o.......o.',
    },
    full: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      open: '..o...o...o...o.',
      shaker: '-o-o-o-o-o-o-o-o',
      conga: '...o......o.....',
      congaHi: '......o.......o.',
    },
    fill: { kick: 'x...x...x.......', snare: '....x.......o.x.', open: '..o...o...o.....' },
    layer: { hat: 'o-.-o-.-o-.-o-.-' },
    bassLight: [[2, 2, 0, 0.9], [6, 2, 0, 0.8], [10, 2, 0, 0.9], [14, 1, 0, 0.8], [15, 1, 12, 0.6]],
    bassFull: [
      [2, 1, 0, 1],
      [3, 1, 12, 0.7],
      [6, 1, 0, 1],
      [7, 1, 12, 0.7],
      [10, 1, 0, 1],
      [11, 1, 12, 0.7],
      [14, 1, 0, 1],
      [15, 1, 7, 0.7],
    ],
    bassKind: 'saw',
  }, 1],
];

// ------------------------------------------------------------------ acid: acid house, 122-128 bpm
// Four on the floor, clap on 2 and 4. The 303 is the bassline: each groove fixes its rhythm (notes, accents,
// slides, octave jumps) and `acidPattern` keeps drawing only the pitches. The sub, when there is one, sits on
// the offbeats under it.

/** A TB-303 rhythm: notes (x accented, o plain, . rest), slides into the next step, octave-up steps. */
export interface AcidRhythm {
  notes: string;
  slide: string;
  up: string;
}

export interface AcidGroove extends Groove {
  acid: AcidRhythm;
}

export const ACID: Weighted<AcidGroove> = [
  [{
    name: 'warehouse',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', open: '..o...o...o...o.' },
    full: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '.-.-.-.-.-.-.-.-', open: '..x...x...x...x.' },
    fill: { snare: '....x.......xoxx', open: '..x...x...x.....' },
    layer: { ride: 'o.o.o.o.o.o.o.o.' },
    bassLight: [[2, 2, 0, 0.7], [6, 2, 0, 0.6], [10, 2, 0, 0.7], [14, 2, 0, 0.6]],
    bassFull: [[2, 2, 0, 0.8], [6, 2, 0, 0.7], [10, 2, 0, 0.8], [14, 2, 0, 0.7]],
    bassKind: 'sub',
    acid: { notes: 'o.xoo.xoo.xoo.xo', slide: '...x.......x....', up: '..x.......x.....' },
  }, 3],
  [{
    name: 'jack 707',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', hat: 'o-o-o-o-o-o-o-o-' },
    full: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x-o-x-o-x-o-x-o-', snap: '.....-.....-...o' },
    fill: { shaker: '..........-.oxxx' },
    layer: { shaker: '-o-o-o-o-o-o-o-o' },
    bassLight: [],
    bassFull: [[3, 1, 0, 0.7], [7, 1, 0, 0.6], [11, 1, 0, 0.7], [15, 1, 0, 0.6]],
    bassKind: 'saw',
    acid: { notes: 'x..o..x..o..x..o', slide: '................', up: '...x.....x......' },
  }, 2],
  [{
    name: 'cowbell rave',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', hat: '-...-...-...-...', open: '..o...o...o...o.' },
    full: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: 'x-.-x-.-x-.-x-.-',
      open: '..x...x...x...x.',
      cowbell: '...o..o....o..o.',
    },
    fill: { snare: '....x...x.x.xxxx' },
    layer: { shaker: '-o-o-o-o-o-o-o-o' },
    bassLight: [[2, 2, 0, 0.7], [6, 2, 0, 0.6], [10, 2, 0, 0.7], [14, 2, 0, 0.6]],
    bassFull: [[2, 2, 0, 0.85], [6, 2, 12, 0.7], [10, 2, 0, 0.85], [14, 2, 12, 0.7]],
    bassKind: 'sub',
    acid: { notes: 'o.x.ooxoo.x.ooxx', slide: '.....x.......x..', up: '..x.......x.....' },
  }, 2],
  [{
    name: 'deep acid',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', ride: 'o...o...o...o...' },
    full: {
      kick: 'x...x...x...x...',
      snare: '....o.......o...',
      ride: 'o...o...o...o...',
      open: '..-...-...-...-.',
      congaHi: '...-..o....-..o.',
    },
    fill: { snare: '....o.......o..-', open: '..-...-...-...o.' },
    layer: { hat: '.-.-.-.-.-.-.-.-' },
    bassLight: [[2, 2, 0, 0.7], [10, 2, 0, 0.7]],
    bassFull: [[2, 2, 0, 0.8], [6, 2, 0, 0.6], [10, 2, 0, 0.8], [14, 2, 7, 0.6]],
    bassKind: 'sub',
    acid: { notes: 'x..ooo..x..o.oo.', slide: '...xx........x..', up: '.....x........x.' },
  }, 1],
  [{
    name: 'acid techno',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', hat: '-o-o-o-o-o-o-o-o' },
    full: {
      kick: 'x...x...x...x...',
      snare: '....x..-....x..-',
      hat: 'oo.ooo.ooo.ooo.o',
      open: '..x...x...x...x.',
    },
    fill: { snare: '....x.......oxxx' },
    layer: { ride: '..o...o...o...o.' },
    bassLight: [],
    bassFull: [[2, 1, 0, 0.8], [6, 1, 0, 0.8], [10, 1, 0, 0.8], [14, 1, 0, 0.8]],
    bassKind: 'saw',
    acid: { notes: 'oxooxooxooxooxoo', slide: '...x..x..x..x...', up: '....x.....x.....' },
  }, 1],
  [{
    name: 'shuffle jack',
    light: { kick: 'x...x...x...x...', snare: '....o.......o...', hat: '-.o.-.o.-.o.-.o.' },
    full: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: 'x-o-x-o-x-o-x-.-',
      open: '..............o.',
      snap: '...-.......-....',
    },
    fill: { snare: '....x.......x-ox' },
    layer: { conga: '.....o.....o..o.' },
    bassLight: [[2, 2, 0, 0.7], [6, 2, 0, 0.6], [10, 2, 0, 0.7], [14, 2, 0, 0.6]],
    bassFull: [[2, 2, 0, 0.8], [7, 1, 0, 0.6], [10, 2, 0, 0.8], [14, 1, 12, 0.6], [15, 1, 0, 0.5]],
    bassKind: 'sub',
    acid: { notes: 'o.x.o.xoo.x.o.xo', slide: '......x.......x.', up: '..x.......x.....' },
  }, 1],
];

// ------------------------------------------------------------------ pulse: synthwave, 96-112 bpm
// Backbeat grooves lock the bass to the kick by doubling it; four-on-the-floor grooves put it between the kicks.

export const PULSE: Weighted<Groove> = [
  [{
    name: 'night drive',
    light: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
    full: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x-o-x-o-x-o-x-.-', open: '..............o.' },
    answer: { kick: 'x.......x.x....o' },
    fill: {
      kick: 'x.......x.......',
      snare: '....x...........',
      hat: 'x-o-x-o-x-o-....',
      hi: '............xx..',
      mid: '..............x.',
      lo: '...............x',
    },
    layer: { shaker: '....x.......x...' },
    bassLight: [
      [0, 2, 0, 1],
      [2, 2, 0, 0.8],
      [4, 2, 0, 0.9],
      [6, 2, 0, 0.8],
      [8, 2, 0, 1],
      [10, 2, 0, 0.85],
      [12, 2, 0, 0.9],
      [14, 2, 0, 0.8],
    ],
    bassFull: [
      [0, 2, 0, 1],
      [2, 2, 12, 0.8],
      [4, 2, 0, 0.9],
      [6, 2, 12, 0.8],
      [8, 2, 0, 1],
      [10, 2, 12, 0.85],
      [12, 2, 0, 0.9],
      [14, 2, 12, 0.8],
    ],
    bassAnswer: [
      [0, 2, 0, 1],
      [2, 2, 12, 0.8],
      [4, 2, 0, 0.9],
      [6, 2, 12, 0.8],
      [8, 2, 0, 1],
      [10, 2, 12, 0.85],
      [12, 2, 0, 0.9],
      [14, 1, 12, 0.8],
      [15, 1, 'A', 0.9],
    ],
  }, 3],
  [{
    name: 'outrun four',
    light: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' },
    full: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x-.-x-.-x-.-x-.-', open: '..o...o...o...o.' },
    fill: { snare: '....x.......xoxx' },
    layer: { ride: 'o...o...o...o...' },
    bassLight: [[2, 2, 0, 1], [6, 2, 0, 0.85], [10, 2, 0, 1], [14, 2, 0, 0.85]],
    bassFull: [[2, 2, 0, 1], [6, 2, 12, 0.85], [10, 2, 0, 1], [14, 1, 12, 0.85], [15, 1, 'A', 0.7]],
  }, 2],
  [{
    name: 'italo',
    kit: { snare: 'clap' },
    light: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    full: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x...x...x...x...', open: '..x...x...x...x.' },
    fill: { snare: '....x.......x...', hi: '..........xx....', mid: '............xx..', lo: '..............xx' },
    layer: { shaker: 'o-o-o-o-o-o-o-o-' },
    bassLight: [
      [2, 1, 12, 0.9],
      [3, 1, 0, 0.7],
      [6, 1, 12, 0.9],
      [7, 1, 0, 0.7],
      [10, 1, 12, 0.9],
      [11, 1, 0, 0.7],
      [14, 1, 12, 0.9],
      [15, 1, 0, 0.7],
    ],
    bassFull: [
      [1, 1, 0, 0.75],
      [2, 1, 12, 1],
      [3, 1, 0, 0.8],
      [5, 1, 0, 0.75],
      [6, 1, 12, 1],
      [7, 1, 0, 0.8],
      [9, 1, 0, 0.75],
      [10, 1, 12, 1],
      [11, 1, 0, 0.8],
      [13, 1, 0, 0.75],
      [14, 1, 12, 1],
      [15, 1, 7, 0.8],
    ],
  }, 2],
  [{
    name: 'darksynth',
    kit: { sc: 0.5 },
    light: { kick: 'x.....x...x.....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.' },
    full: { kick: 'x.....x...x.x...', snare: '........x.......', hat: 'x-o-x-o-x-o-x-o-' },
    fill: { kick: 'x.....x.........', snare: '........x...oxxx' },
    layer: { ride: 'o...o...o...o...' },
    bassLight: [[0, 6, 0, 1], [6, 4, 0, 0.85], [10, 4, 0, 0.9], [14, 2, 12, 0.8]],
    bassFull: [
      [0, 1, 0, 1],
      [1, 1, 0, 0.65],
      [2, 1, 0, 0.75],
      [3, 1, 0, 0.65],
      [4, 1, 0, 0.75],
      [5, 1, 0, 0.65],
      [6, 1, 0, 1],
      [7, 1, 0, 0.65],
      [8, 1, 0, 0.75],
      [9, 1, 0, 0.65],
      [10, 1, 0, 1],
      [11, 1, 0, 0.65],
      [12, 1, 0, 1],
      [13, 1, 0, 0.65],
      [14, 1, 12, 0.8],
      [15, 1, 7, 0.7],
    ],
    bassKind: 'roll',
  }, 1],
  [{
    name: 'half-time ballad',
    light: { kick: 'x.........x.....', snare: '........x.......', hat: 'x.o.x.o.x.o.x.o.' },
    full: { kick: 'x.........x.....', snare: '........x.......', hat: 'x-o-x-..x-o-x-..', open: '......o.......o.' },
    answer: { kick: 'x.........x...o.' },
    fill: {
      kick: 'x...............',
      hat: 'x-o-x-..x-o-....',
      hi: '............xo..',
      mid: '..............x.',
      lo: '...............x',
    },
    layer: { shaker: '-.o.-.o.-.o.-.o.' },
    bassLight: [[0, 10, 0, 1], [10, 6, 0, 0.8]],
    bassFull: [
      [0, 2, 0, 1],
      [2, 2, 0, 0.7],
      [4, 2, 0, 0.8],
      [6, 2, 0, 0.7],
      [8, 2, 0, 0.9],
      [10, 2, 0, 0.85],
      [12, 2, 0, 0.8],
      [14, 2, 12, 0.7],
    ],
    bassAnswer: [
      [0, 2, 0, 1],
      [2, 2, 0, 0.7],
      [4, 2, 0, 0.8],
      [6, 2, 0, 0.7],
      [8, 2, 0, 0.9],
      [10, 2, 0, 0.85],
      [12, 2, 0, 0.8],
      [14, 2, 0, 0.95],
    ],
  }, 2],
  [{
    name: 'boogie',
    light: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
    full: { kick: 'x......x..x.....', snare: '....x-......x..-', hat: 'x-o-x-o-x-o-x-..', open: '..............o.' },
    fill: { kick: 'x......x........', snare: '....x-......-oxx', hat: 'x-o-x-o-x-o-....' },
    layer: { conga: '...o......o..o..' },
    bassLight: [[0, 3, 0, 1], [7, 2, 0, 0.85], [10, 2, 0, 0.9], [14, 1, 12, 0.7], [15, 1, 0, 0.6]],
    bassFull: [
      [0, 2, 0, 1],
      [3, 1, 12, 0.7],
      [6, 1, 0, 0.6],
      [7, 2, 0, 0.95],
      [10, 2, 0, 0.9],
      [12, 1, 12, 0.7],
      [13, 1, 7, 0.6],
      [14, 2, 'A', 0.8],
    ],
  }, 1],
];

// ------------------------------------------------------------------ haze: lo-fi hip hop, 72-88 bpm, swung
// The movement's swing pushes every odd 16th late, so a kick, ghost or hat written on an odd step leans back.
// The bass doubles the kick and walks into the next chord.

export const HAZE: Weighted<Groove> = [
  [{
    name: 'boom bap',
    light: { kick: 'x.o...x...x.....', snare: '....x.......x...', hat: 'x.o.x.o-x.o.x.o.' },
    full: { kick: 'x.o...x...x.....', snare: '....x.......x..-', hat: 'x.o.x.o-x.o.x...', open: '..............o.' },
    answer: { kick: 'x.o...x...x..o..' },
    fill: { snare: '....x.......x-o-' },
    layer: { shaker: '..-...-...-...-.' },
    bassLight: [[0, 6, 0, 1], [6, 4, 7, 0.8], [10, 4, 0, 0.85], [14, 2, 'A', 0.7]],
    bassFull: [[0, 2, 0, 1], [2, 4, 12, 0.7], [6, 4, 7, 0.85], [10, 4, 0, 0.9], [14, 2, 'A', 0.75]],
    bassAnswer: [[0, 2, 0, 1], [2, 4, 12, 0.7], [6, 4, 7, 0.85], [10, 3, 0, 0.9], [13, 3, 'A', 0.8]],
    lag: 0.1,
  }, 3],
  [{
    name: 'dilla lean',
    light: { kick: 'x......x.x......', snare: '....x.......x...', hat: 'x-o-x-o-x-o-x-o-' },
    full: { kick: 'x......x.x....-.', snare: '....x..-....x..-', hat: 'x-o-x-o-x-o-x-o-' },
    answer: { kick: 'x.x....x.x......' },
    fill: { snare: '....x.....-.x.-o' },
    layer: { snap: '....o.......o...' },
    bassLight: [[0, 7, 0, 1], [7, 2, 0, 0.85], [9, 5, 7, 0.8], [14, 2, 'A', 0.7]],
    bassFull: [[0, 5, 0, 1], [5, 2, 12, 0.6], [7, 2, 0, 0.9], [9, 5, 7, 0.85], [14, 2, 'A', 0.75]],
    bassAnswer: [[0, 2, 0, 1], [2, 5, 0, 0.7], [7, 2, 0, 0.9], [9, 5, 7, 0.85], [14, 2, 'A', 0.75]],
    lag: 0.18,
  }, 2],
  [{
    name: 'jazzhop ride',
    light: { kick: 'x.........x.....', snare: '....o.......o...', hat: '....-.......-...', ride: 'o...o..-o...o..-' },
    full: { kick: 'x.........x..o..', snare: '....x.......x...', hat: '....o.......o...', ride: 'x...x..ox...x..o' },
    fill: { snare: '....x.....-.x.oo' },
    layer: { congaHi: '..-...-...-...o.' },
    bassLight: [[0, 4, 0, 1], [4, 4, 7, 0.75], [8, 2, 12, 0.8], [10, 4, 7, 0.85], [14, 2, 'A', 0.75]],
    bassFull: [[0, 4, 0, 1], [4, 2, 7, 0.75], [6, 2, 12, 0.7], [8, 2, 7, 0.8], [10, 3, 0, 0.9], [13, 3, 'A', 0.8]],
    lag: 0.12,
  }, 2],
  [{
    name: 'sleepy half-time',
    light: { kick: 'x.........x.....', snare: '........x.......', hat: 'x.o.x.o.x.o.x.o.' },
    full: { kick: 'x.........x.....', snare: '........x......-', hat: 'x-o-x-o-x-o-x-o-' },
    answer: { kick: 'x......-..x.....' },
    fill: { snare: '........x.....-o', hat: 'x-o-x-o-x-o-....' },
    layer: { snap: '........o.......' },
    bassLight: [[0, 10, 0, 1], [10, 4, 0, 0.85], [14, 2, 'A', 0.7]],
    bassFull: [[0, 10, 0, 1], [10, 4, 12, 0.8], [14, 2, 'A', 0.7]],
    bassKind: '808',
    lag: 0.15,
  }, 2],
  [{
    name: 'chillhop bounce',
    light: { kick: 'x..x......x..x..', snare: '....x.......x...', hat: 'x.o.x.oox.o.x.o-' },
    full: { kick: 'x..x......x..x..', snare: '....x..-....x...', hat: 'x.o.x.oox.o.x...', open: '..............o.' },
    fill: { kick: 'x..x......x.....', snare: '....x.......x-x-' },
    layer: { shaker: '-o-o-o-o-o-o-o-o' },
    bassLight: [[0, 3, 0, 1], [3, 7, 0, 0.8], [10, 3, 0, 0.9], [13, 3, 'A', 0.75]],
    bassFull: [[0, 3, 0, 1], [3, 3, 12, 0.7], [6, 4, 7, 0.8], [10, 3, 0, 0.9], [13, 3, 'A', 0.8]],
    lag: 0.08,
  }, 2],
  [{
    name: 'bossa-hop',
    kit: { snare: 'rim' },
    light: { kick: 'x.....x.x.....x.', snare: 'x.....x.....x...', shaker: '-.o.-.o.-.o.-.o.' },
    full: {
      kick: 'x.....x.x.....x.',
      snare: 'x.....x.....x...',
      shaker: 'o-x-o-x-o-x-o-x-',
      snap: '....x.......x...',
    },
    answer: { snare: '....x.....x.....' },
    fill: { kick: 'x.....x.x.......', snare: 'x.....x.....x.x.' },
    layer: { congaHi: '......o.......o.' },
    bassLight: [[0, 6, 0, 1], [6, 2, 7, 0.7], [8, 6, 7, 0.9], [14, 2, 'A', 0.7]],
    bassFull: [[0, 6, 0, 1], [6, 2, 7, 0.75], [8, 4, 7, 0.9], [12, 2, 12, 0.7], [14, 2, 'A', 0.8]],
  }, 1],
];

// ------------------------------------------------------------------ garden: organic downtempo, 88-104 bpm
// Hand drums carry the groove (`grooveBar` with perc around 0.8); the kick is soft and the bass doubles it.

export const GARDEN: Weighted<Groove> = [
  [{
    name: 'cumbia sway',
    light: {
      kick: 'x.......x.......',
      shaker: 'o.o-o.o-o.o-o.o-',
      congaHi: '....x...........',
      conga: '............o.o.',
    },
    full: {
      kick: 'x.......x.......',
      snare: '....o.......o...',
      shaker: 'o.o-o.o-o.o-o.o-',
      congaHi: '....x...........',
      conga: '............x.o.',
      bongo: '..-...-...-...-.',
    },
    fill: { congaHi: '....x.......x.x.', conga: '.............x.x' },
    layer: { cowbell: '..-...-...-...-.' },
    bassLight: [[0, 6, 0, 1], [8, 6, 7, 0.85]],
    bassFull: [[0, 6, 0, 1], [6, 2, 12, 0.6], [8, 6, 7, 0.9], [14, 2, 'A', 0.7]],
  }, 2],
  [{
    name: 'son clave',
    kit: { snare: 'rim' },
    light: {
      kick: 'x.......x.......',
      snare: 'x.....x.....x...',
      congaHi: '-...x...-...x...',
      conga: '..............x.',
      bongo: 'o.-.o.-.o.-.x.-.',
    },
    full: {
      kick: 'x.......x.......',
      snare: 'x.....x.....x...',
      congaHi: '-...x...-...x...',
      conga: '..............x.',
      cowbell: 'o.-.o.-.o.-.o.-.',
    },
    answer: { snare: '....x...x.......' },
    fill: { congaHi: '-...x.......xx..', conga: '..............xx' },
    layer: { shaker: '-.o.-.o.-.o.-.o.' },
    bassLight: [[0, 6, 0, 1], [6, 6, 7, 0.85], [12, 4, 12, 0.75]],
    bassFull: [[0, 4, 0, 1], [6, 6, 7, 0.9], [12, 2, 12, 0.75], [14, 2, 'A', 0.7]],
  }, 2],
  [{
    name: 'tresillo lilt',
    light: { kick: 'x.....x.....x...', snare: '....o.......o...', shaker: '-o-o-o-o-o-o-o-o' },
    full: {
      kick: 'x.....x.....x...',
      snare: '....x.......x...',
      shaker: '-o-o-o-o-o-o-o-o',
      conga: '...o......o.....',
      congaHi: '......x.......x.',
    },
    fill: { kick: 'x.....x.........', congaHi: '......x.....x.x.', conga: '.............x.x' },
    layer: { bongo: '.x...x.x.x...x..' },
    bassLight: [[0, 6, 0, 1], [6, 6, 0, 0.85], [12, 4, 7, 0.85]],
    bassFull: [[0, 5, 0, 1], [6, 5, 12, 0.8], [12, 2, 7, 0.85], [14, 2, 'A', 0.7]],
  }, 2],
  [{
    name: 'downtempo break',
    kit: { kick: 'big', snare: 'big' },
    light: { kick: 'x.x.......x.....', snare: '....o.......o...', hat: 'x.o.x.o.x.o.x.o.' },
    full: { kick: 'x.x.......xo....', snare: '....x..-.-..x..-', hat: 'x-o-x-o-x-o-x-o-' },
    fill: { kick: 'x.x.......x.....', snare: '....x..-.-..xoxx' },
    layer: { bongo: '..x-..x-..x-..x-' },
    bassLight: [[0, 2, 0, 1], [2, 8, 0, 0.85], [10, 4, 7, 0.85], [14, 2, 'A', 0.7]],
    bassFull: [[0, 2, 0, 1], [2, 6, 12, 0.75], [8, 2, 7, 0.7], [10, 1, 0, 0.9], [11, 3, 0, 0.85], [14, 2, 'A', 0.75]],
  }, 1],
  [{
    name: 'desert maqsum',
    light: { kick: 'x.......x.......', congaHi: '..x...x.....x...', shaker: '-.-.-.-.-.-.-.-.' },
    full: {
      kick: 'x.......x.......',
      snare: '............o...',
      conga: 'x.......x.......',
      congaHi: '..x...x.....x...',
      bongo: '...-...-.-...-.-',
    },
    fill: { congaHi: '..x...x.....xxxx' },
    layer: { shaker: 'o-x-o-x-o-x-o-x-' },
    bassLight: [[0, 8, 0, 1], [8, 8, 0, 0.85]],
    bassFull: [[0, 6, 0, 1], [6, 2, 12, 0.65], [8, 6, 0, 0.9], [14, 2, 7, 0.7]],
  }, 1],
  [{
    name: 'soft four',
    kit: { sc: 0.25 },
    light: { kick: 'x...x...x...x...', shaker: '-o-o-o-o-o-o-o-o', congaHi: '......o.......o.' },
    full: {
      kick: 'x...x...x...x...',
      snare: '....o.......o...',
      shaker: '-o-o-o-o-o-o-o-o',
      open: '..o...o...o...o.',
      conga: '...o......o.....',
      congaHi: '......x.......x.',
    },
    fill: { congaHi: '......x.....xxx.', conga: '...o......o....x' },
    layer: { bongo: '.x...x.x.x...x..' },
    bassLight: [[2, 2, 0, 0.85], [6, 2, 0, 0.75], [10, 2, 0, 0.85], [14, 2, 0, 0.75]],
    bassFull: [[2, 2, 0, 1], [6, 1, 0, 0.85], [7, 1, 12, 0.6], [10, 2, 0, 1], [14, 1, 0, 0.85], [15, 1, 7, 0.6]],
  }, 1],
];

// ------------------------------------------------------------------ ember: post-rock
// Drawn from the references (Explosions in the Sky, Mono, April Rain): the quiet parts have no drums at all (the
// arranger leaves them out); a build rides the floor tom and the kick, and crescendoes into a roll; a climax is
// heavy and half-time under a wash of crashes ridden like a ride cymbal. The bass is the arranger's (sustained).

export const EMBER: Weighted<Groove> = [
  [{
    name: 'crash wash',
    light: { lo: 'x.x.x.x.x.x.x.x.', kick: 'x.......x.......' },
    full: { kick: 'x.....x.x.......', snare: '........x.......', crash: 'x.o.x.o.x.o.x.o.' },
    fill: { snare: '........x.x.xxxx', crash: 'x.o.x.o.........' },
    layer: { lo: 'x...x...x...x...' },
    bassLight: [[0, 16, 0, 0.9]],
    bassFull: [[0, 16, 0, 1]],
  }, 3],
  [{
    name: 'driving eighths',
    light: { lo: 'x...x...x...x...', ride: 'o.o.o.o.o.o.o.o.' },
    full: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      ride: 'x.x.x.x.x.x.x.x.',
      crash: 'x...............',
    },
    fill: { snare: '....x.......x.xx', mid: '..........xx....', lo: '............xx..' },
    layer: { crash: 'x.......x.......' },
    bassLight: [[0, 16, 0, 0.9]],
    bassFull: [[0, 16, 0, 1]],
  }, 2],
  [{
    name: 'tom march',
    light: { lo: 'x..x..x.x..x..x.', mid: '....x.......x...' },
    full: {
      kick: 'x..x..x.x..x..x.',
      snare: '....x.......x...',
      crash: 'x.......x.......',
      lo: 'x..x..x.x..x..x.',
    },
    fill: { lo: 'x..x..x.x.x.xxxx', snare: '....x.......x...' },
    layer: { ride: '..x...x...x...x.' },
    bassLight: [[0, 16, 0, 0.9]],
    bassFull: [[0, 16, 0, 1]],
  }, 2],
];

// ------------------------------------------------------------------ cathedral: cinematic, 68-82 bpm
// Taiko in the tom lanes: `lo` (odaiko) sparse and on the downbeat, `mid` (chu-daiko) the ostinato, `hi` the
// short crescendos. The fastest figures go on the highest, shortest drums. The bass is the low-string line.

export const CATHEDRAL: Weighted<Groove> = [
  [{
    name: 'hybrid half-time',
    light: { lo: 'x.........o.....', mid: '......o.........' },
    full: {
      kick: 'x.........x.....',
      snare: '........x.......',
      hat: 'o.-.o.-.o.-.o.-.',
      lo: 'x.........x.....',
      mid: '......o.......o.',
    },
    fill: { mid: '......o.....oo..', hi: '..............xx' },
    layer: { shaker: '-oo.-oo.-oo.-oo.' },
    bassLight: [[0, 16, 0, 0.9]],
    bassFull: [[0, 10, 0, 1], [10, 6, 0, 0.9]],
  }, 3],
  [{
    name: 'ostinato drive',
    light: { lo: 'x...............', mid: 'o---o---o---o---' },
    full: {
      kick: 'x.......x.......',
      snare: '........x.......',
      lo: 'x.......x.......',
      mid: 'x-o-x-o-x-o-x-o-',
    },
    fill: { hi: '........o-o-oxox' },
    layer: { shaker: '-oo.-oo.-oo.-oo.' },
    bassLight: [[0, 4, 0, 1], [4, 4, 0, 0.7], [8, 4, 0, 0.85], [12, 4, 0, 0.7]],
    bassFull: [
      [0, 2, 0, 1],
      [2, 2, 0, 0.7],
      [4, 2, 0, 0.85],
      [6, 2, 0, 0.7],
      [8, 2, 0, 0.95],
      [10, 2, 0, 0.7],
      [12, 2, 0, 0.85],
      [14, 2, 12, 0.75],
    ],
  }, 2],
  [{
    name: 'three-three-two',
    light: { lo: 'x.......x.......', mid: '...o..o....o..o.' },
    full: {
      kick: 'x.......x.......',
      snare: '............x...',
      lo: 'x.......x.......',
      mid: 'x..x..x.x..x..x.',
    },
    fill: { hi: '........o.o.oxxx' },
    layer: { shaker: '-o-o-o-o-o-o-o-o' },
    bassLight: [[0, 8, 0, 1], [8, 8, 0, 0.85]],
    bassFull: [[0, 3, 0, 1], [3, 3, 0, 0.7], [6, 2, 0, 0.8], [8, 3, 0, 0.95], [11, 3, 0, 0.7], [14, 2, 12, 0.8]],
  }, 2],
  [{
    name: 'heartbeat',
    light: { lo: 'x..o............' },
    full: { kick: 'x..o....x..o....', snare: '............x...', lo: 'x..o....x..o....' },
    fill: { hi: '............-oxx' },
    layer: { mid: '......-.......-.' },
    bassLight: [[0, 16, 0, 0.9]],
    bassFull: [[0, 3, 0, 1], [3, 5, 0, 0.75], [8, 3, 0, 0.95], [11, 5, 0, 0.75]],
  }, 1],
  [{
    name: 'doko gallop',
    light: { lo: 'o...o...o...o...', mid: '..--..--..--..--' },
    full: {
      kick: 'x.......x.......',
      snare: '........x.......',
      lo: 'x...o...x...o...',
      mid: '..oo..oo..oo..ox',
    },
    fill: { mid: '..oo..oo..oo....', hi: '............xxxx' },
    layer: { hi: '.o...o...o...o..' },
    bassLight: [[0, 4, 0, 0.9], [4, 4, 0, 0.7], [8, 4, 0, 0.85], [12, 4, 0, 0.7]],
    bassFull: [
      [0, 2, 0, 1],
      [2, 1, 0, 0.6],
      [3, 1, 0, 0.6],
      [4, 2, 0, 0.85],
      [6, 1, 0, 0.6],
      [7, 1, 0, 0.6],
      [8, 2, 0, 0.95],
      [10, 1, 0, 0.6],
      [11, 1, 0, 0.6],
      [12, 2, 12, 0.85],
      [14, 1, 0, 0.6],
      [15, 1, 0, 0.65],
    ],
  }, 1],
];

// ------------------------------------------------------------------ drift: ambient, 60-74 bpm
// Pulses, not beats: most pieces stay beatless, and a groove never fills. A bass figure of one whole-bar note
// means a drone: play it with `sustainedBass` so it does not restrike on every bar of a two-bar chord.

const DRIFT_KIT: DrumKit = { kick: 'soft', snare: 'rim', sc: 0.12, hats: 0.6 };

export const DRIFT: Weighted<Groove> = [
  [{
    name: 'still',
    light: {},
    full: {},
    fill: {},
    bassLight: [[0, 16, 0, 0.85]],
    bassFull: [[0, 16, 0, 1]],
  }, 4],
  [{
    name: 'shaker breath',
    kit: DRIFT_KIT,
    light: {},
    full: { shaker: '-.-o-.-o-.-o-.-o' },
    fill: {},
    layer: { shaker: '-...-...-...-...' },
    bassLight: [[0, 16, 0, 0.85]],
    bassFull: [[0, 16, 0, 1]],
  }, 3],
  [{
    // the distant kick of a club heard through a wall; the drone under it breathes with the gentle duck
    name: 'submerged four',
    kit: { ...DRIFT_KIT, sc: 0.15 },
    light: { kick: '-...-...-...-...' },
    full: { kick: 'o...o...o...o...', shaker: '..-...-...-...-.' },
    fill: {},
    bassLight: [[0, 16, 0, 0.85]],
    bassFull: [[0, 16, 0, 1]],
  }, 1],
  [{
    name: 'heartbeat',
    kit: { ...DRIFT_KIT, sc: 0.1 },
    light: { kick: 'o-..............' },
    full: { kick: 'o-......o-......' },
    fill: {},
    bassLight: [[0, 16, 0, 0.85]],
    bassFull: [[0, 8, 0, 1], [8, 8, 0, 0.8]],
  }, 1],
  [{
    name: 'rim and ride',
    kit: DRIFT_KIT,
    light: { ride: '-...-...-...-...' },
    full: { kick: 'o.........-.....', snare: '............-...', ride: 'o...o..-o...o..-' },
    fill: {},
    layer: { snare: '............-...' },
    bassLight: [[0, 16, 0, 0.85]],
    bassFull: [[0, 8, 0, 1], [8, 8, 7, 0.7]],
  }, 1],
  [{
    name: 'dub pulse',
    kit: DRIFT_KIT,
    light: { kick: 'o.........o.....', snare: '........-.......' },
    full: { kick: 'o.........o.....', snare: '........o.......', shaker: '..-...-...-...-.' },
    fill: {},
    bassLight: [[0, 10, 0, 0.9], [10, 6, 0, 0.7]],
    bassFull: [[0, 8, 0, 1], [10, 4, 0, 0.8], [14, 2, 7, 0.6]],
    bassKind: 'round',
  }, 1],
];

// ------------------------------------------------------------------ in three
// The styles that can sway: a waltz's three quarters (beats on 0, 4, 8 of twelve 16ths) or 6/8's two dotted beats
// (on 0 and 6, eighths on the even steps).

export const DRIFT_TIMES: Banks = {
  '4/4': DRIFT,
  '3/4': [
    [{ name: 'still', light: {}, full: {}, fill: {}, bassLight: [[0, 12, 0, 0.85]], bassFull: [[0, 12, 0, 1]] }, 4],
    [{
      name: 'shaker waltz',
      kit: DRIFT_KIT,
      light: {},
      full: { shaker: 'o.-.o.-.o.-.' },
      fill: {},
      layer: { shaker: '-...-...-...' },
      bassLight: [[0, 12, 0, 0.85]],
      bassFull: [[0, 12, 0, 1]],
    }, 3],
    [{
      name: 'heartbeat in three',
      kit: { ...DRIFT_KIT, sc: 0.1 },
      light: { kick: 'o-..........' },
      full: { kick: 'o-......o...' },
      fill: {},
      bassLight: [[0, 12, 0, 0.85]],
      bassFull: [[0, 8, 0, 1], [8, 4, 7, 0.7]],
    }, 1],
  ],
  '6/8': [
    [{ name: 'still', light: {}, full: {}, fill: {}, bassLight: [[0, 12, 0, 0.85]], bassFull: [[0, 12, 0, 1]] }, 4],
    [{
      name: 'shaker sway',
      kit: DRIFT_KIT,
      light: {},
      full: { shaker: 'o.-.-.o.-.-.' },
      fill: {},
      layer: { shaker: '-.....-.....' },
      bassLight: [[0, 12, 0, 0.85]],
      bassFull: [[0, 12, 0, 1]],
    }, 3],
    [{
      name: 'rocking heartbeat',
      kit: { ...DRIFT_KIT, sc: 0.1 },
      light: { kick: 'o-..........' },
      full: { kick: 'o-....o-....' },
      fill: {},
      bassLight: [[0, 12, 0, 0.85]],
      bassFull: [[0, 6, 0, 1], [6, 6, 7, 0.75]],
    }, 1],
  ],
};

export const GARDEN_TIMES: Banks = {
  '4/4': GARDEN,
  '6/8': [
    [{
      // the West African bell: its twelve-eighth pattern spread over a bar and its answer
      name: 'bell six',
      light: { kick: 'x.....x.....', shaker: 'o.-.-.o.-.-.', congaHi: '......x.....' },
      full: {
        kick: 'x.....x.....',
        snare: '......o.....',
        shaker: 'o.-.-.o.-.-.',
        cowbell: 'x...x...x.x.',
        congaHi: '......x.....',
        conga: '..........o.',
      },
      answer: { cowbell: '..x...x...x.' },
      fill: { congaHi: '......x.x.x.', conga: '..........xx' },
      layer: { bongo: '..-...-...-.' },
      bassLight: [[0, 6, 0, 1], [6, 6, 7, 0.85]],
      bassFull: [[0, 4, 0, 1], [4, 2, 12, 0.6], [6, 4, 7, 0.9], [10, 2, 'A', 0.7]],
    }, 3],
    [{
      name: 'lullaby sway',
      light: { kick: 'x...........', shaker: '-.-.-.-.-.-.', conga: '......o.....' },
      full: { kick: 'x.....o.....', snare: '......o.....', shaker: 'o.-.-.o.-.-.', congaHi: '....x.....x.' },
      fill: { conga: '......x.x.xx' },
      layer: { snap: '......o.....' },
      bassLight: [[0, 6, 0, 1], [6, 6, 0, 0.8]],
      bassFull: [[0, 6, 0, 1], [6, 4, 7, 0.85], [10, 2, 'A', 0.7]],
    }, 2],
  ],
};

export const EMBER_TIMES: Banks = {
  '4/4': EMBER,
  '3/4': [
    [{
      name: 'waltz wash',
      light: { lo: 'x.x.x.x.x.x.', kick: 'x...........' },
      full: { kick: 'x.......x...', snare: '........x...', crash: 'x.o.x.o.x.o.' },
      fill: { snare: '....x...xxxx', crash: 'x.o.x.......' },
      layer: { lo: 'x...x...x...' },
      bassLight: [[0, 12, 0, 0.9]],
      bassFull: [[0, 12, 0, 1]],
    }, 1],
  ],
  // five as three and two: the snare on the four, where the bar turns
  '5/4': [
    [{
      name: 'five wash',
      light: { lo: 'x.x.x.x.x.x.x.x.x.x.', kick: 'x...........x.......' },
      full: { kick: 'x.....x.....x.......', snare: '............x.......', crash: 'x.o.x.o.x.o.x.o.x.o.' },
      fill: { snare: '............x.x.xxxx', crash: 'x.o.x.o.x.o.........' },
      layer: { lo: 'x...x...x...x...x...' },
      bassLight: [[0, 20, 0, 0.9]],
      bassFull: [[0, 12, 0, 1], [12, 8, 0, 0.9]],
    }, 1],
  ],
  // seven as two, two and three: the kick on each group, the snare into the long one
  '7/8': [
    [{
      name: 'seven wash',
      light: { lo: 'x.x.x.x.x.x.x.', kick: 'x.......x.....' },
      full: { kick: 'x...x...x.....', snare: '........x.....', crash: 'x.o.x.o.x.o.o.' },
      fill: { snare: '........x.xxxx', crash: 'x.o.x.o.......' },
      layer: { lo: 'x...x...x.....' },
      bassLight: [[0, 14, 0, 0.9]],
      bassFull: [[0, 8, 0, 1], [8, 6, 0, 0.9]],
    }, 2],
    [{
      name: 'seven drive',
      light: { lo: 'x...x...x.....', ride: 'o.o.o.o.o.o.o.' },
      full: { kick: 'x...x...x...x.', snare: '....x.......x.', ride: 'x.x.x.x.x.x.x.', crash: 'x.............' },
      fill: { snare: '....x...x.x.xx', lo: '........xx....' },
      layer: { crash: 'x.......x.....' },
      bassLight: [[0, 14, 0, 0.9]],
      bassFull: [[0, 8, 0, 1], [8, 6, 0, 0.9]],
    }, 1],
  ],
  '6/8': [
    [{
      name: 'six wash',
      light: { lo: 'x.x.x.x.x.x.', kick: 'x.....x.....' },
      full: { kick: 'x.....x.x...', snare: '......x.....', crash: 'x.o.o.x.o.o.' },
      fill: { snare: '......x.x.xx', crash: 'x.o.o.......' },
      layer: { lo: 'x.....x.....' },
      bassLight: [[0, 12, 0, 0.9]],
      bassFull: [[0, 12, 0, 1]],
    }, 3],
    [{
      name: 'rolling six',
      light: { kick: 'x.........o.', lo: 'x.o.o.x.o.o.' },
      full: { kick: 'x...o.....x.', snare: '......x.....', ride: 'x.o.o.x.o.o.', crash: 'x...........' },
      fill: { snare: '......x.xoxx' },
      layer: { crash: 'x.....x.....' },
      bassLight: [[0, 12, 0, 0.9]],
      bassFull: [[0, 12, 0, 1]],
    }, 2],
  ],
};

export const CATHEDRAL_TIMES: Banks = {
  '4/4': CATHEDRAL,
  '3/4': [
    [{
      name: 'processional in three',
      light: { lo: 'x...........', mid: '....o...o...' },
      full: {
        kick: 'x...........',
        snare: '........x...',
        hat: 'o.-.o.-.o.-.',
        lo: 'x.......x...',
        mid: '....o.......',
      },
      fill: { mid: '....o...oo..', hi: '..........xx' },
      layer: { shaker: '-oo.-oo.-oo.' },
      bassLight: [[0, 12, 0, 0.9]],
      bassFull: [[0, 8, 0, 1], [8, 4, 0, 0.9]],
    }, 1],
  ],
  // five as three and two, the taiko leaning on the four: the war march of film scores
  '5/4': [
    [{
      name: 'march in five',
      light: { lo: 'x...........x.......', mid: '....o...o.......o...' },
      full: {
        kick: 'x...........x.......',
        snare: '........x.......x...',
        hat: 'o.-.o.-.o.-.o.-.o.-.',
        lo: 'x...x...x...x...x...',
        mid: '....o...o.......o...',
      },
      fill: { mid: '........o...oo..o...', hi: '................xxxx' },
      layer: { shaker: '-oo.-oo.-oo.-oo.-oo.' },
      bassLight: [[0, 20, 0, 0.9]],
      bassFull: [[0, 12, 0, 1], [12, 8, 0, 0.9]],
    }, 1],
  ],
  '7/8': [
    [{
      name: 'seven taiko',
      light: { lo: 'x.......x.....', mid: '....o.......o.' },
      full: {
        kick: 'x.......x.....',
        snare: '....x.......x.',
        hat: 'o.-.o.-.o.-.-.',
        lo: 'x...x...x.....',
        mid: '....o.......o.',
      },
      fill: { mid: '....o...o.oo..', hi: '..........xxxx' },
      layer: { shaker: '-oo.-oo.-oo.o.' },
      bassLight: [[0, 14, 0, 0.9]],
      bassFull: [[0, 8, 0, 1], [8, 6, 0, 0.9]],
    }, 1],
  ],
  '6/8': [
    [{
      name: 'epic six',
      light: { lo: 'x.....o.....', mid: '....o.....o.' },
      full: {
        kick: 'x.....x.....',
        snare: '......x.....',
        hat: 'o.-.-.o.-.-.',
        lo: 'x.....x.....',
        mid: '....o.....o.',
      },
      fill: { mid: '......o.oo..', hi: '..........xx' },
      layer: { shaker: '-.o.o.-.o.o.' },
      bassLight: [[0, 12, 0, 0.9]],
      bassFull: [[0, 6, 0, 1], [6, 6, 0, 0.9]],
    }, 1],
  ],
};
