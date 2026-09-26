// Melody by motif, written for instruments. A movement's hook is a rhythm cell in its style's idiom and a
// contour planned around one climax (the first note, a peak past the middle, the way down, the last note, with
// steps in between), not a random walk. Phrases restate it the way themes are built: each statement continues
// from the last, one slot carries the climax, and the phrase breathes at bars 4 and 8. Fitting to the chords
// bends the contour instead of breaking it. Calibrated on instrumental lines (POP909's lead-instrument track:
// few repeated notes, one peak, continuation by step), not on sung ones.

import { hash32, Rng } from '../rng.ts';
import { type Key, mod, pc } from '../theory.ts';
import { type Meter, type Note, stepsPerBar, type StyleId, type Tune } from '../types.ts';
import type { ChordSlot, Ctx } from './context.ts';

// ------------------------------------------------------------------ vocabulary

/** One bar of melodic rhythm: [onset, length] in 16ths. A whole rhythmic idea, not per-beat dice. */
type Cell = readonly (readonly [on: number, len: number])[];
type Shape = 'arch' | 'leap' | 'wave' | 'fall' | 'descent';

const SPARSE: Cell[] = [
  [[0, 8], [8, 8]],
  [[0, 12], [12, 4]],
  [[0, 6], [6, 10]],
  [[0, 4], [4, 12]],
  [[0, 8], [8, 4], [12, 4]],
];
const LYRICAL: Cell[] = [
  [[0, 6], [6, 2], [8, 8]], // long-short-long
  [[0, 4], [4, 4], [8, 8]],
  [[0, 6], [6, 6], [12, 4]], // 3+3+2
  [[0, 3], [3, 1], [4, 4], [8, 8]], // a snap into the beat
  [[0, 4], [4, 2], [6, 10]], // the push onto the "and"
  [[0, 2], [2, 2], [4, 4], [8, 8]],
  [[0, 4], [4, 8], [12, 4]],
  [[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]], // four eighths into a long note
  [[0, 4], [4, 2], [6, 2], [8, 4], [12, 4]],
  [[0, 3], [3, 3], [6, 2], [8, 2], [10, 6]],
];
const RIFF: Cell[] = [
  [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]], // 3-3-2 3-3-2
  [[0, 3], [3, 3], [6, 3], [9, 3], [12, 2], [14, 2]],
  [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 4]],
  [[0, 2], [2, 1], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]],
];
// second bars that end a statement on a held note: short mid-phrase, long at a cadence
const TAIL_SHORT: Cell[] = [[[0, 4], [4, 4], [8, 8]], [[0, 6], [6, 2], [8, 8]], [[0, 2], [2, 2], [4, 4], [8, 8]]];
const TAIL_LONG: Cell[] = [[[0, 4], [4, 12]], [[0, 16]], [[0, 2], [2, 2], [4, 12]], [[0, 6], [6, 10]]];

// the same ideas in three: a waltz's bar of three quarters, and 6/8's two groups of three eighths
const SPARSE_3: Cell[] = [[[0, 12]], [[0, 8], [8, 4]], [[0, 4], [4, 8]], [[0, 6], [6, 6]]];
const LYRICAL_3: Cell[] = [
  [[0, 4], [4, 4], [8, 4]],
  [[0, 6], [6, 2], [8, 4]], // dotted quarter, eighth, quarter
  [[0, 4], [4, 2], [6, 2], [8, 4]],
  [[0, 2], [2, 2], [4, 8]],
  [[0, 8], [8, 2], [10, 2]],
  [[0, 3], [3, 1], [4, 8]], // a snap onto the second beat
  [[0, 4], [4, 6], [10, 2]],
  [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4]],
];
const SPARSE_6: Cell[] = [[[0, 12]], [[0, 6], [6, 6]], [[0, 9], [9, 3]]];
const LYRICAL_6: Cell[] = [
  [[0, 4], [4, 2], [6, 6]], // the lilt: quarter, eighth, dotted quarter
  [[0, 2], [2, 2], [4, 2], [6, 6]],
  [[0, 6], [6, 4], [10, 2]],
  [[0, 4], [4, 2], [6, 4], [10, 2]], // rocking
  [[0, 3], [3, 1], [4, 2], [6, 6]], // a siciliano's dotted eighth
  [[0, 2], [2, 4], [6, 6]],
  [[0, 6], [6, 2], [8, 2], [10, 2]],
];
/** Second bars (short mid-phrase, long at a cadence) for each bar length and time. */
const TAILS: Record<Meter, { short: Cell[]; long: Cell[] }> = {
  '4/4': { short: TAIL_SHORT, long: TAIL_LONG },
  '3/4': {
    short: [[[0, 4], [4, 8]], [[0, 6], [6, 6]], [[0, 2], [2, 2], [4, 8]]],
    long: [[[0, 12]], [[0, 4], [4, 8]], [[0, 2], [2, 2], [4, 8]]],
  },
  '6/8': {
    short: [[[0, 4], [4, 2], [6, 6]], [[0, 6], [6, 6]]],
    long: [[[0, 12]], [[0, 6], [6, 6]], [[0, 4], [4, 8]]],
  },
};

/** How a style writes melody: its idiom. */
export interface Profile {
  head: readonly Cell[];
  /** Bar two restates bar one's first half and holds (a loop hook), instead of a tail cell. */
  riff: boolean;
  /** Height of the motif's peak above its first note, in scale steps. */
  climb: readonly [number, number];
  /** Signature leap sizes in scale steps (2 a third, 4 a fifth, 7 an octave). */
  leaps: readonly number[];
  /** Chance a spare note repeats instead of turning. */
  repeat: number;
  /** Accented non-chord tones allowed per statement; each resolves by step. */
  appoggiaturas: number;
  /** 0 triad tones only, 1 also 9ths (and a sus chord's 2nd and 4th), 2 also 11ths on minor, 13ths on major. */
  tensions: 0 | 1 | 2;
  shapes: readonly (readonly [Shape, number])[];
  /** 16ths after the bar line the motif's first note enters: a tune that comes in just after the downbeat. */
  offset?: number;
  /** The time its cells are written in (4/4 unless inMeter() moved it). */
  meter?: Meter;
  /** Scale degrees (mod 7) the line steps past: a pentatonic flavour (see RealizeOpts.avoid). */
  avoid?: readonly number[];
  /** A reciting tune: its spare notes dwell on the note they're on rather than turning round it. */
  recite?: boolean;
}

const LYRIC_SHAPES = [['arch', 4], ['leap', 2], ['wave', 1]] as const;
const TRANCE: Profile = {
  head: RIFF,
  riff: true,
  climb: [4, 6],
  leaps: [4, 7],
  repeat: 0.15,
  appoggiaturas: 0,
  tensions: 1,
  shapes: [['arch', 2], ['wave', 2], ['leap', 1]],
};
export const PROFILES: Record<StyleId, Profile> = {
  rise: TRANCE,
  acid: TRANCE,
  pulse: {
    head: [...LYRICAL, LYRICAL[2], LYRICAL[4]],
    riff: false,
    climb: [4, 5],
    leaps: [3, 4, 7],
    repeat: 0.08,
    appoggiaturas: 1,
    tensions: 1,
    shapes: LYRIC_SHAPES,
  },
  haze: {
    head: LYRICAL,
    riff: false,
    climb: [3, 5],
    leaps: [2, 3, 4],
    repeat: 0.1,
    appoggiaturas: 1,
    tensions: 2,
    shapes: LYRIC_SHAPES,
  },
  garden: {
    head: LYRICAL,
    riff: false,
    climb: [3, 5],
    leaps: [2, 3, 4],
    repeat: 0.08,
    appoggiaturas: 1,
    tensions: 1,
    shapes: LYRIC_SHAPES,
  },
  nocturne: {
    head: [...LYRICAL, ...SPARSE],
    riff: false,
    climb: [4, 6],
    leaps: [2, 3, 4, 5],
    repeat: 0.06,
    appoggiaturas: 2,
    tensions: 1,
    shapes: LYRIC_SHAPES,
  },
  cathedral: {
    head: [...SPARSE, LYRICAL[0], LYRICAL[1]],
    riff: false,
    climb: [4, 7],
    leaps: [3, 4, 7],
    repeat: 0.05,
    appoggiaturas: 1,
    tensions: 0,
    shapes: [['leap', 3], ['arch', 3]],
  },
  drift: {
    head: [...SPARSE, ...LYRICAL.slice(0, 3)],
    riff: false,
    climb: [3, 4],
    leaps: [2, 3, 4],
    repeat: 0.04,
    appoggiaturas: 0,
    tensions: 1,
    shapes: [['arch', 3], ['leap', 2], ['fall', 1]],
  },
  // post-rock themes are few, long notes, mostly by step: a line a guitar can tremolo-pick over a wall
  ember: {
    head: [...SPARSE, LYRICAL[0], LYRICAL[1], LYRICAL[6]],
    riff: false,
    climb: [3, 5],
    leaps: [3, 4],
    repeat: 0.12,
    appoggiaturas: 0,
    tensions: 1,
    shapes: [['arch', 3], ['fall', 2], ['leap', 1]],
  },
};

/** Degrees a pentatonic line steps past: the 4th and 7th of a major mode, the 2nd and 6th of a minor one. */
const PENTATONIC: Record<Key['mode'], readonly number[]> = {
  ionian: [3, 6],
  lydian: [3, 6],
  mixolydian: [3, 6],
  aeolian: [1, 5],
  dorian: [1, 5],
  phrygian: [1, 5],
  harmonic: [1, 5],
};

/**
 * A movement's own melodic character inside its style's idiom, so two pieces of a style don't sing alike: its
 * rhythm drawn from the sparser or the busier of the style's cells (or all of them), a climb a little lower or
 * higher, a line that moves by step or one that leaps, more or fewer repeated notes, a tune that enters on the
 * downbeat or just after it, and now and then a pentatonic one. A riff (trance, acid) keeps its idiom's rhythm.
 */
export function character(rng: Rng, p: Profile, mode: Key['mode']): Profile {
  const count = (c: Cell) => c.length;
  const sorted = [...p.head].sort((a, b) => count(a) - count(b));
  const half = Math.ceil(sorted.length / 2);
  const density = p.riff ? 'all' : rng.weighted([['sparse', 1], ['all', 2], ['busy', 1]] as const);
  const head = density === 'sparse' ? sorted.slice(0, half) : density === 'busy' ? sorted.slice(-half) : p.head;
  const reach = rng.pick([-1, 0, 0, 1, 2]);
  const steppy = rng.chance(0.3);
  return {
    ...p,
    head,
    climb: [Math.max(2, p.climb[0] + reach), Math.max(3, p.climb[1] + reach)],
    leaps: steppy ? p.leaps.filter((l) => l <= 3).concat(2).slice(0, 2) : p.leaps,
    repeat: Math.min(0.3, p.repeat * rng.pick([0.5, 1, 1, 2.5])),
    offset: p.riff ? 0 : rng.weighted([[0, 5], [2, 2], [4, 2]] as const),
    avoid: rng.chance(0.25) ? PENTATONIC[mode] : undefined,
  };
}

/**
 * A movement's tune (see Tune) in its style's idiom: a lament falls from a high note by step and sighs onto its chord
 * tones; a riff is a one-bar figure restated; a recitation stays near one note and repeats it; a fanfare calls in
 * fourths, fifths and octaves. A song, or no tune, is the style's own.
 */
export function tuned(p: Profile, tune: Tune): Profile {
  switch (tune) {
    case 'lament':
      return {
        ...p,
        shapes: [['descent', 3], ['fall', 2]],
        leaps: [2],
        repeat: Math.min(p.repeat, 0.06),
        appoggiaturas: Math.max(1, p.appoggiaturas),
      };
    case 'riff':
      return { ...p, head: RIFF, riff: true, climb: [3, 5], leaps: [3, 4], shapes: [['arch', 2], ['wave', 2]] };
    case 'recitation':
      return { ...p, climb: [1, 2], leaps: [1], repeat: 0.35, recite: true, shapes: [['wave', 2], ['arch', 1]] };
    case 'fanfare':
      return { ...p, climb: [5, 7], leaps: [3, 4, 7], repeat: 0.05, shapes: [['leap', 4], ['arch', 1]] };
    default:
      return p;
  }
}

/**
 * A style's idiom in three: the same share of long, sparse notes against lyrical ones, in the time's own cells.
 * A riff keeps four (trance and acid stay in four).
 */
export function inMeter(p: Profile, meter: Meter): Profile {
  if (meter === '4/4' || p.riff) return p;
  const sparse = p.head.some((c) => SPARSE.includes(c));
  const [sp, ly] = meter === '3/4' ? [SPARSE_3, LYRICAL_3] : [SPARSE_6, LYRICAL_6];
  return { ...p, head: sparse ? [...sp, ...ly] : ly, meter };
}

/** Counter-lines and textures (a glockenspiel line, a hum): sparse and gentle. */
export const TEXTURE: Profile = {
  head: [...SPARSE, ...LYRICAL.slice(0, 2)],
  riff: false,
  climb: [2, 4],
  leaps: [2, 3],
  repeat: 0.06,
  appoggiaturas: 0,
  tensions: 1,
  shapes: [['arch', 2], ['fall', 1]],
};

// ------------------------------------------------------------------ motif: rhythm and a planned contour

export interface Motif {
  /** Onsets and lengths in 16ths inside a 2-bar window. `rest` notes keep the grid but aren't played. */
  rhythm: { on: number; len: number; rest: boolean }[];
  /** Scale-step movement from the previous note (first entry unused). */
  steps: number[];
  /** Chord tone the motif starts on: 0 root, 1 third, 2 fifth. */
  start: number;
  /** What it was drawn from, so its variants (the climax, the answers) are the same motif, reaching further. */
  seed: number;
  profile: Profile;
}

/** 16ths in a bar of a profile's time. */
const barOf = (p: Profile) => stepsPerBar(p.meter ?? '4/4');

const cellNotes = (c: Cell, bar: number, spb: number) =>
  c.map(([on, len]) => ({ on: bar * spb + on, len, rest: false }));

/**
 * A two-bar rhythm whose first note enters `by` 16ths late (after the downbeat); the rest keep their places. A first
 * note too short to give up the time makes way for the next.
 */
function shift(rhythm: Motif['rhythm'], by: number): Motif['rhythm'] {
  if (!by) return rhythm;
  const [first, ...rest] = rhythm;
  return first.len > by ? [{ ...first, on: first.on + by, len: first.len - by }, ...rest] : rest;
}

/**
 * A path of k intervals from `a` to `b`, never above `ceil` (the motif's peak): a scalar run, spare notes spent
 * on a dip before a rise or an overshoot at the end of a fall, a third or a leap only when it must. Returns the
 * k - 1 notes between a and b.
 */
function fill(rng: Rng, a: number, b: number, k: number, repeat: number, ceil = Infinity, recite = false): number[] {
  const d = b - a;
  const dir = Math.sign(d) || (a >= ceil || rng.chance(0.6) ? -1 : 1);
  let ivs: number[];
  if (Math.abs(d) <= k) {
    const run: number[] = new Array(Math.abs(d)).fill(dir);
    let extra = k - Math.abs(d);
    const turns: number[] = [];
    for (; extra >= 2; extra -= 2) turns.push(...(recite && rng.chance(0.7) ? [0, 0] : [-1, 1]));
    if (extra === 1) {
      if (rng.chance(repeat) || !run.length) turns.push(0);
      else if (dir > 0) run.splice(0, 1, -1, 2); // dip, then a third up
      else run.splice(run.length - 1, 1, -2, 1); // a third past the goal, then back up to it
    }
    ivs = dir > 0 ? [...turns, ...run] : [...run, ...turns];
  } else if (Math.abs(d) <= 2 * k) {
    const thirds = Math.abs(d) - k;
    ivs = Array.from({ length: k }, (_, i) => (i < thirds ? 2 : 1) * dir); // arpeggiate, then step in
  } else {
    ivs = [...new Array(k - 1).fill(dir), d - (k - 1) * dir]; // steps, then a leap into the goal
  }
  const out: number[] = [];
  let cur = a;
  for (const s of ivs.slice(0, k - 1)) out.push(Math.min(ceil, cur += s));
  return out;
}

/**
 * A two-bar motif: a rhythm from the style's cells, and a contour planned from a few anchors (the first note,
 * one peak, the downbeat of bar two, the last note) with every other note filled in by step. `lift` raises the
 * peak: drawn again from the same seed, it's the climax of the same motif.
 */
export function makeMotif(rng: Rng, p: Profile, tail: 'short' | 'long' = 'short', lift = 0): Motif {
  const spb = barOf(p);
  const head = rng.pick(p.head);
  const tails = TAILS[p.meter ?? '4/4'];
  const bar2 = p.riff
    ? [...head.filter(([on]) => on < 8), [8, 8] as const]
    : rng.fork('tail').pick(tail === 'short' ? tails.short : tails.long);
  const rhythm = shift([...cellNotes(head, 0, spb), ...cellNotes(bar2, 1, spb)], p.offset ?? 0);
  const n = rhythm.length;
  const shape = rng.weighted(p.shapes);
  const leap = rng.pick(p.leaps);
  const px = rng.range(0.4, 0.65);
  // the peak: early for a leap (the leap is the hook), the first note of a descent, otherwise past the middle, on a
  // longer note if it can
  let peak = shape === 'descent' ? 0 : 1;
  if (shape !== 'leap' && shape !== 'descent') {
    let best = Infinity;
    rhythm.forEach((r, i) => {
      const dist = Math.abs(r.on / (2 * spb) - px) - (r.len >= 4 ? 0.06 : 0);
      if (i > 0 && i < n - 1 && dist < best) [best, peak] = [dist, i];
    });
  }
  const climb = Math.round(rng.range(p.climb[0], p.climb[1] + 0.99));
  const endPick = rng.pick([0, 1, 2, -1]);
  // room to climb before the peak and to come down after it, mostly by step (a third at most per note)
  const room = 2 * (n - 1 - peak) + Math.max(0, endPick);
  const h = Math.min(
    shape === 'leap' ? Math.min(7, leap + lift) : Math.min(climb, Math.ceil(peak * 1.5)) + lift,
    room,
  );
  const endV = shape === 'fall'
    ? -rng.pick([1, 2, 3])
    : shape === 'descent'
    ? h - rng.pick([3, 4, 5])
    : Math.min(h - 1, endPick);
  const anchors = new Map<number, number>([[0, 0], [peak, h], [n - 1, endV]]);
  const down = rhythm.findIndex((r) => r.on >= spb);
  if (down > peak + 1 && down < n - 2) anchors.set(down, Math.round((h + endV) / 2)); // the way down
  const idx = [...anchors.keys()].sort((a, b) => a - b);
  // a held note is arrived at, not struck again: adjacent anchors on one pitch become a step
  for (let k = 1; k < idx.length; k++) {
    const [i, j] = [idx[k - 1], idx[k]];
    if (j - i === 1 && anchors.get(i) === anchors.get(j) && j !== peak) anchors.set(j, anchors.get(j)! - 1);
  }
  const line = new Array(n).fill(0);
  for (const i of idx) line[i] = anchors.get(i)!;
  for (let s = 1; s < idx.length; s++) {
    const [i, j] = [idx[s - 1], idx[s]];
    fill(rng, line[i], line[j], j - i, p.repeat, h - 1, p.recite).forEach((v, q) => (line[i + 1 + q] = v));
  }
  const steps = line.map((v, i) => (i ? v - line[i - 1] : 0));
  // (a descent starts high in the chord, with room to fall)
  const start = shape === 'leap'
    ? rng.pick([0, 0, 2])
    : shape === 'descent'
    ? rng.pick([2, 2, 1])
    : rng.pick([0, 1, 2, 2]);
  return { rhythm, steps, start, seed: rng.seed, profile: p };
}

/** The motif reaching further: the same rhythm and shape from the same seed, its peak two steps higher. */
const climaxOf = (m: Motif) => makeMotif(new Rng(m.seed), m.profile, 'short', 2);

/** The motif's first bar, then a new second bar that ends on a long note (the answer, or the cadence). */
function withTail(rng: Rng, m: Motif, dir: number): Motif {
  const spb = barOf(m.profile);
  const head = m.rhythm.filter((r) => r.on < spb);
  const bar2 = cellNotes(rng.pick(TAILS[m.profile.meter ?? '4/4'].long), 1, spb);
  const steps = m.steps.slice(0, head.length);
  for (let k = 0; k < bar2.length; k++) steps.push(k === 0 ? rng.pick([1, -1]) : dir);
  return { ...m, rhythm: [...head, ...bar2], steps };
}

/**
 * The motif ornamented, the way a player varies a returning tune: each long note split in two, the new note a
 * step towards the next one (a passing tone) or an upper neighbour before a repeat. Level 1 splits notes of a
 * quarter or longer, level 2 also eighths.
 */
export function embellish(m: Motif, level: 1 | 2): Motif {
  const min = level === 1 ? 4 : 2;
  const rhythm: Motif['rhythm'] = [];
  const steps: number[] = [];
  let carry = 0;
  m.rhythm.forEach((r, i) => {
    const step = m.steps[i] - carry;
    carry = 0;
    const next = m.steps[i + 1];
    if (r.rest || r.len < min || next === undefined) {
      rhythm.push(r);
      steps.push(step);
      return;
    }
    const half = Math.floor(r.len / 2);
    const toward = next === 0 ? 1 : Math.sign(next);
    rhythm.push({ on: r.on, len: half, rest: false }, { on: r.on + half, len: r.len - half, rest: false });
    steps.push(step, toward);
    carry = toward;
  });
  return { ...m, rhythm, steps };
}

/** The motif upside down: every step goes the other way. */
export const invert = (m: Motif): Motif => ({ ...m, steps: m.steps.map((s, i) => (i ? -s : 0)) });

/** The first bar, twice, the second a step higher: fragmentation that drives towards the cadence. */
export function fragment(m: Motif): Motif {
  const spb = barOf(m.profile);
  const head = m.rhythm.filter((r) => r.on < spb);
  const hs = m.steps.slice(0, head.length);
  const back = hs.slice(1).reduce((a, b) => a + b, 0);
  return {
    ...m,
    rhythm: [...head, ...head.map((r) => ({ ...r, on: r.on + spb }))],
    steps: [...hs, 1 - back, ...hs.slice(1)],
  };
}

// ------------------------------------------------------------------ fitting to the chords

type Cls = 'chord' | 'tension' | 'nct';

/** The pitch of a degree in a melody: harmonic minor's raised 7th only over the dominant or rising home. */
function melPitch(ctx: Ctx, deg: number, slot: ChordSlot, next?: number): number {
  const m = ctx.pitch(deg, slot);
  if (ctx.key.mode === 'harmonic' && mod(deg, 7) === 6 && !slot.pcs.includes(pc(m)) && next !== deg + 1) return m - 1;
  return m;
}

function classify(ctx: Ctx, deg: number, slot: ChordSlot, tensions: number): Cls {
  const p = pc(melPitch(ctx, deg, slot));
  if (slot.pcs.includes(p)) return 'chord';
  const iv = mod(p - slot.pcs[0], 12);
  const minor = slot.pcs.includes(mod(slot.pcs[0] + 3, 12));
  const sus = !minor && !slot.pcs.includes(mod(slot.pcs[0] + 4, 12));
  if (sus && (iv === 2 || iv === 5)) return 'tension';
  if (tensions >= 1 && iv === 2) return 'tension';
  if (tensions >= 2 && ((minor && iv === 5) || (!minor && iv === 9))) return 'tension';
  return 'nct';
}

export interface RealizeOpts {
  /** Where the motif starts, in 16ths from the section start. */
  step: number;
  /** Degree the melody gravitates around (0 = tonic in the melody register). */
  center: number;
  lo: number;
  hi: number;
  /** Rhythm multiplier: 2 plays the motif at half speed over four bars. */
  stretch?: number;
  /** Scale degrees (mod 7) the line steps past in its direction of motion, e.g. [3, 6] for a pentatonic feel. */
  avoid?: readonly number[];
  velocity?: number;
  /** Semitone shift applied after fitting (12 for an octave-up restatement). */
  transpose?: number;
}

interface Placed {
  s: number;
  len: number;
  n: number;
  deg: number;
  strong: boolean;
}

/** The closest chord tone that keeps the line's direction into and out of the note, without inventing repeats. */
function nearest(
  ctx: Ctx,
  d: number,
  slot: ChordSlot,
  end: ChordSlot,
  p: Profile,
  o: RealizeOpts,
  prev?: number,
  next?: number,
): number {
  let best = d;
  let bestCost = Infinity;
  for (const k of [-1, 1, -2, 2, -3, 3]) {
    const c = d + k;
    if (c < o.lo - 1 || c > o.hi + 1) continue;
    const a = classify(ctx, c, slot, p.tensions);
    const b = classify(ctx, c, end, p.tensions);
    if (a === 'nct' || b === 'nct') continue;
    let cost = Math.abs(k) + (a === 'tension' ? 0.5 : 0);
    if (prev !== undefined) {
      // melodic sevenths, tritones and leaps past the octave are awkward on any instrument
      const semis = Math.abs(ctx.pitch(c, slot) - ctx.pitch(prev, slot));
      if ([6, 10, 11].includes(semis) || semis > 12) cost += 3;
      if (Math.abs(d - prev) >= 2 && Math.abs(c - prev) > Math.abs(d - prev)) cost += 1.5; // don't widen a leap
      if (Math.sign(c - prev) !== Math.sign(d - prev)) cost += 2;
      if (c === prev && d !== prev) cost += 1.5;
      if (Math.abs(c - prev) > 4 && Math.abs(d - prev) <= 4) cost += 1.5;
    }
    if (next !== undefined && Math.sign(next - c) !== Math.sign(next - d)) cost += 1.5;
    if (cost < bestCost) [best, bestCost] = [c, cost];
  }
  return best;
}

/** The last note of a statement: the tonic (a close) or the 2nd or 5th (open), a chord tone near the line. */
function cadence(ctx: Ctx, d: number, slot: ChordSlot, ending: 'open' | 'close', prev?: number): number {
  const want = (c: number) => ending === 'close' ? mod(c, 7) === 0 : [1, 4, 2].includes(mod(c, 7));
  const order = [0, -1, 1, -2, 2, -3, 3].sort((x, y) =>
    (prev === undefined ? 0 : Math.abs(d + x - prev) - Math.abs(d + y - prev)) || Math.abs(x) - Math.abs(y)
  );
  for (const pass of [true, false]) {
    for (const k of order) {
      const c = d + k;
      if (classify(ctx, c, slot, 0) === 'chord' && (!pass || want(c)) && (pass || c !== prev)) return c;
    }
  }
  return d;
}

/**
 * Fits a motif to the harmony under it. The strong notes (first, last, beats one and three, long notes) are
 * fitted first; the notes between them move with them, so the contour is bent, not broken. A statement starts
 * near `anchor` (the previous statement's first note plus the form's offset), continuing instead of restarting.
 */
function realize(ctx: Ctx, m: Motif, o: RealizeOpts, anchor?: number, ending?: 'open' | 'close'): Placed[] {
  const p = m.profile;
  const st = o.stretch ?? 1;
  const sound = m.rhythm.flatMap((r, i) => (r.rest ? [] : [i]));
  if (!sound.length) return [];
  const slotOf = (i: number) => ctx.chordAtStep(o.step + m.rhythm[i].on * st);
  const endOf = (i: number) => ctx.chordAtStep(o.step + (m.rhythm[i].on + m.rhythm[i].len) * st - 1);
  let off = 0;
  const offs = m.steps.map((s) => (off += s));
  const mid = (Math.max(...offs) + Math.min(...offs)) / 2;
  const s0 = slotOf(0);
  const want = anchor ?? o.center - mid;
  let first = ctx.rootDegree(s0) + [0, 2, 4][m.start];
  while (first - want > 3) first -= 7;
  while (want - first > 3) first += 7;
  if (anchor !== undefined) {
    for (const k of [0, 1, -1, 2, -2]) {
      if (classify(ctx, anchor + k, s0, 0) === 'chord') {
        first = anchor + k;
        break;
      }
    }
  }
  const ideal = offs.map((x) => first + x);
  if (ending) {
    // the cadence is aimed at, not snapped to: a goal below (close) or near (open) the last note of the head,
    // reached by step through the second bar
    const tail = sound.filter((i) => m.rhythm[i].on >= barOf(p));
    const before = sound[sound.indexOf(tail[0]) - 1];
    if (tail.length && before !== undefined) {
      const from = ideal[before];
      const lastSlot = slotOf(tail[tail.length - 1]);
      const goalOk = (c: number) => ending === 'close' ? mod(c, 7) === 0 : [1, 4].includes(mod(c, 7));
      const order = ending === 'close' ? [-1, -2, -3, 1, -4, 2, 3, -5] : [1, -1, 2, -2, 3, -3];
      const goal = order.map((k) => from + k).find((c) => goalOk(c) && classify(ctx, c, lastSlot, 0) === 'chord');
      if (goal !== undefined) {
        const path = [...fill(new Rng(hash32(m.seed, first)), from, goal, tail.length, 0), goal];
        tail.forEach((i, q) => (ideal[i] = path[q]));
      }
    }
  }
  const out = ideal.slice();
  let budget = p.appoggiaturas;
  const strongAt = (q: number) => {
    const r = m.rhythm[sound[q]];
    return q === 0 || q === sound.length - 1 || ctx.strong(r.on * st) || r.len * st >= 8;
  };
  // 1. the anchors are fitted to the chords (an accented non-chord tone may stay if it resolves by step)
  const anchors = sound.map((_, q) => q).filter(strongAt);
  let prevA: number | undefined;
  for (const q of anchors) {
    const i = sound[q];
    const len = m.rhythm[i].len * st;
    const slot = slotOf(i);
    const end = endOf(i);
    const d = ideal[i];
    const nextIdeal = q + 1 < sound.length ? ideal[sound[q + 1]] : undefined;
    if (q === sound.length - 1 && ending) out[i] = cadence(ctx, d, slot, ending, prevA);
    else if (q > 0 && [classify(ctx, d, slot, p.tensions), classify(ctx, d, end, p.tensions)].includes('nct')) {
      const nextSlot = q + 1 < sound.length ? slotOf(sound[q + 1]) : slot;
      const resolves = nextIdeal !== undefined && Math.abs(nextIdeal - d) === 1 &&
        classify(ctx, nextIdeal, nextSlot, 0) === 'chord';
      if (budget > 0 && resolves && len <= 4 * st) budget--;
      else out[i] = nearest(ctx, d, slot, end, p, o, prevA, nextIdeal);
    }
    prevA = out[i];
  }
  // 2. the notes between anchors move with them
  for (let k = 1; k < anchors.length; k++) {
    const [qa, qb] = [anchors[k - 1], anchors[k]];
    const [ca, cb] = [out[sound[qa]] - ideal[sound[qa]], out[sound[qb]] - ideal[sound[qb]]];
    for (let q = qa + 1; q < qb; q++) {
      out[sound[q]] = ideal[sound[q]] + Math.round(ca + ((cb - ca) * (q - qa)) / (qb - qa));
    }
  }
  // a note the motif moves to must still move (rounding the bend can collapse two notes into a repeat)
  for (let q = 1; q < sound.length; q++) {
    if (strongAt(q)) continue;
    const [i, h] = [sound[q], sound[q - 1]];
    if (out[i] === out[h] && ideal[i] !== ideal[h]) out[i] += Math.sign(ideal[i] - ideal[h]);
  }
  // 3. a weak note may clash only as a short passing or neighbour note
  for (let q = 1; q < sound.length - 1; q++) {
    if (strongAt(q)) continue;
    const i = sound[q];
    const len = m.rhythm[i].len * st;
    const d = out[i];
    if (![classify(ctx, d, slotOf(i), p.tensions), classify(ctx, d, endOf(i), p.tensions)].includes('nct')) continue;
    const [pv, nx] = [out[sound[q - 1]], out[sound[q + 1]]];
    const passing = Math.abs(d - pv) === 1 && nx - d === d - pv;
    const neighbour = nx === pv && Math.abs(d - pv) === 1;
    if (len <= 2 * st && (passing || neighbour)) continue;
    out[i] = nearest(ctx, d, slotOf(i), endOf(i), p, o, pv, nx);
  }
  // degrees a style (or a movement's character) avoids are stepped past in the direction the line is going,
  // onto a note that fits
  const avoid = o.avoid ?? p.avoid;
  if (avoid?.length) {
    for (let q = 1; q < sound.length; q++) {
      const i = sound[q];
      if (!avoid.includes(mod(out[i], 7))) continue;
      const dir = out[i] >= out[sound[q - 1]] ? 1 : -1;
      const fits = (d: number) => classify(ctx, d, slotOf(i), p.tensions) !== 'nct';
      const to = [out[i] + dir, out[i] - dir].find((d) => fits(d) && !avoid.includes(mod(d, 7)));
      if (to !== undefined) out[i] = to;
    }
  }
  return sound.map((i, q) => {
    const r = m.rhythm[i];
    const next = q + 1 < sound.length ? out[sound[q + 1]] : undefined;
    return {
      s: o.step + r.on * st,
      len: r.len * st,
      n: melPitch(ctx, out[i], slotOf(i), next),
      deg: out[i],
      strong: strongAt(q),
    };
  });
}

// ------------------------------------------------------------------ phrases

/** How a phrase is built from motif statements, in two-bar slots. */
export type PhraseForm = 'period' | 'sentence' | 'aaba' | 'abab' | 'sequence';

export const PHRASE_FORMS: readonly PhraseForm[] = ['period', 'sentence', 'aaba', 'abab', 'sequence'];

// Beyond these a melody stops sounding like a melody.
const MIN_NOTE = 45;
const MAX_NOTE = 93;

/**
 * A phrase from motif A (and B for contrast), the way themes are built. Each statement continues from the one
 * before (its first note anchored to the phrase's first note plus the form's offset); exactly one slot carries
 * the climax, the motif reaching further; the phrase breathes at bar 4 (open) and closes at bar 8.
 * - period: A, A open, A reaching higher, A closed: question and answer
 * - sentence: A, A a step higher, the climax fragmented, closed: an idea, restated, driven forward, closed
 * - aaba: A, A open, B a step above, A closed
 * - abab: A, B open, A reaching higher, A closed
 * - sequence: A, A a step higher, the climax a step higher again, closed
 * A longer part (twelve bars) ends with a tag: its last line sung again, reaching and closing once more.
 */
export function phrase(
  ctx: Ctx,
  m: Motif,
  fromBar: number,
  bars: number,
  o: Omit<RealizeOpts, 'step'>,
  form: PhraseForm = 'period',
  b?: Motif,
  /** Overrides how the phrase ends: 'open' for the first half of a longer one, so the two halves answer. */
  cadence?: 'open' | 'close',
): Note[] {
  const st = o.stretch ?? 1;
  const climax = climaxOf(m);
  const open = withTail(new Rng(hash32(m.seed, 1)), m, -1);
  const close = withTail(new Rng(hash32(m.seed, 2)), m, -1);
  const other = b ??
    makeMotif(new Rng(hash32(m.seed, 3)), { ...m.profile, shapes: [['fall', 2], ['arch', 1]] }, 'short', 1);
  type Slot = [Motif, number, ('open' | 'close')?];
  const plans: Record<PhraseForm, Slot[]> = {
    period: [[m, 0], [open, 0, 'open'], [climax, 0], [close, 0, 'close']],
    sentence: [[m, 0], [m, 1], [fragment(climax), 1], [close, 0, 'close']],
    aaba: [[m, 0], [open, 0, 'open'], [other, 3], [close, 0, 'close']],
    abab: [[m, 0], [withTail(new Rng(hash32(m.seed, 4)), other, -1), 0, 'open'], [climax, 0], [close, 0, 'close']],
    sequence: [[m, 0], [m, 1], [climax, 2], [close, 0, 'close']],
  };
  const slots = Math.floor(bars / (2 * st));
  const tag: Slot[] = [[climax, 0], [close, 0, 'close']];
  const plan: Slot[] = slots >= 6
    ? [...plans[form], ...tag]
    : slots >= 4
    ? plans[form]
    : slots >= 2
    ? [[m, 0, 'open'], [withTail(new Rng(hash32(m.seed, 2)), climax, -1), 0, 'close']]
    : [[m, 0, 'close']];
  const placed: Placed[] = [];
  let anchor: number | undefined;
  const count = Math.min(slots, plan.length);
  for (let k = 0; k < count; k++) {
    const [motif, rel, planned] = plan[k];
    const ending = k === count - 1 && cadence ? cadence : planned;
    const step = (fromBar + 2 * st * k) * ctx.spb;
    const at = { ...o, step, center: o.center + ctx.register, lo: o.lo + ctx.register, hi: o.hi + ctx.register };
    const ns = realize(ctx, motif, at, anchor === undefined ? undefined : anchor + rel, ending);
    if (anchor === undefined && ns.length) anchor = ns[0].deg;
    placed.push(...ns);
  }
  const notes: Note[] = placed.map((x) => ({
    t: ctx.at(x.s),
    d: x.len * ctx.s16,
    n: x.n + (o.transpose ?? 0),
    v: (o.velocity ?? 1) * (x.strong ? 1 : 0.86),
  }));
  // the whole phrase moves by octaves to stay playable; single notes are never folded
  const hi = () => notes.reduce((x, n) => Math.max(x, n.n), -Infinity);
  const lo = () => notes.reduce((x, n) => Math.min(x, n.n), Infinity);
  while (notes.length && hi() > MAX_NOTE && lo() - 12 >= MIN_NOTE) for (const n of notes) n.n -= 12;
  while (notes.length && lo() < MIN_NOTE && hi() + 12 <= MAX_NOTE) for (const n of notes) n.n += 12;
  // each note ends where the next begins (legato), except before rests
  for (let i = 0; i < notes.length - 1; i++) notes[i].d = Math.min(notes[i].d, notes[i + 1].t - notes[i].t);
  return notes;
}
