// Melody by motif. A movement invents a two-bar idea (a rhythm and a contour in scale steps) and every
// melodic part is that idea restated: fitted to whatever chords lie under it, answered, varied, slowed
// down. Repetition with variation is what makes generated melody sound written rather than random.

import type { Rng } from '../rng.ts';
import type { Note } from '../types.ts';
import type { ChordSlot, Ctx } from './context.ts';

export interface Motif {
  /** Onsets and lengths in 16ths inside a 2-bar window. `rest` notes keep the grid but aren't played. */
  rhythm: { on: number; len: number; rest: boolean }[];
  /** Scale-step movement from the previous note (first entry unused). */
  steps: number[];
  /** Chord tone the motif starts on: 0 root, 1 third, 2 fifth. */
  start: number;
}

// One beat of melody rhythm: onsets in 16ths inside the beat (none: the previous note holds, or a rest).
// Weights move with density: slow melodies lean on held quarters, busy ones on eighths, dotted figures and
// syncopations (a note on the "and" with the beat left empty, the push that makes a pop line lilt).
const FIGURES: readonly { on: readonly number[]; w: (d: number) => number; rest?: boolean }[] = [
  { on: [0], w: (d) => 2.6 - 2 * d },
  { on: [0, 2], w: (d) => 1.3 + 2 * d },
  { on: [0, 3], w: (d) => 0.4 + 1.2 * d },
  { on: [2], w: () => 0.9 },
  { on: [0, 2, 3], w: (d) => 1.6 * d },
  { on: [0, 1, 2], w: (d) => 0.8 * d },
  { on: [], w: (d) => 1.2 - d }, // the note before holds
  { on: [], w: () => 0.35, rest: true },
];

/** Interval weights in scale steps, as melodies move: many repeated notes and steps, few leaps (pop corpora). */
const INTERVALS = [[0, 28], [1, 47], [2, 15], [3, 6], [4, 4]] as const;

/**
 * A two-bar motif built the way hooks are: a one-bar rhythmic cell, then the cell's first half again and a
 * held note to end on (so the idea is heard twice before it lets go). density 0..1: 0 is mostly held notes,
 * 1 is busy eighths and sixteenths.
 */
export function makeMotif(rng: Rng, density: number): Motif {
  const onsets: { at: number; rest: boolean }[] = [];
  const beat = (b: number, f: (typeof FIGURES)[number]) => {
    if (f.rest) onsets.push({ at: b * 4, rest: true });
    for (const o of f.on) onsets.push({ at: b * 4 + o, rest: false });
  };
  const figures = FIGURES.map((f) => [f, f.w(density)] as const);
  // the cell: the first beat always sounds, so the idea starts on the downbeat or just after it
  const cell = [0, 1, 2, 3].map((b) => rng.weighted(b === 0 ? figures.filter(([f]) => f.on.length) : figures));
  cell.forEach((f, b) => beat(b, f));
  // bar two: the cell's first half, then a new figure and a note held to the end
  beat(4, cell[0]);
  beat(5, cell[1]);
  beat(6, rng.weighted(figures.filter(([f]) => f.on.length && !f.rest)));
  onsets.sort((a, b) => a.at - b.at);
  const rhythm: Motif['rhythm'] = onsets.map((o, k) => ({
    on: o.at,
    len: (onsets[k + 1]?.at ?? 32) - o.at,
    rest: o.rest,
  }));
  // a phrase ends on something held: the last sounding note lasts at least a beat
  while (rhythm.length > 2 && (rhythm[rhythm.length - 1].rest || rhythm[rhythm.length - 1].len < 4)) {
    const last = rhythm.pop()!;
    rhythm[rhythm.length - 1].len += last.len;
  }

  const shape = rng.pick(['arch', 'arch', 'fall', 'rise', 'wave'] as const);
  const steps = [0];
  let prevStep = 0;
  for (let i = 1; i < rhythm.length; i++) {
    const x = i / rhythm.length;
    let s: number;
    if (Math.abs(prevStep) >= 3) s = -Math.sign(prevStep) * rng.pick([1, 1, 2]); // a leap is answered by a step back
    else {
      const size = rng.weighted(INTERVALS);
      const upBias = shape === 'arch'
        ? (x < 0.55 ? 0.72 : 0.25)
        : shape === 'rise'
        ? 0.68
        : shape === 'fall'
        ? 0.3
        : x < 0.3 || (x > 0.6 && x < 0.8)
        ? 0.7
        : 0.35;
      s = rng.chance(upBias) ? size : -size;
    }
    steps.push(s);
    prevStep = s;
  }
  // bar two starts as bar one did: the same notes, so the cell is heard as a cell
  const second = rhythm.findIndex((r) => r.on >= 16);
  const firstHalf = rhythm.filter((r) => r.on < 8).length;
  if (second > 0) {
    for (let k = 1; k < firstHalf && second + k < steps.length; k++) steps[second + k] = steps[k];
  }
  return { rhythm, steps, start: rng.pick([0, 1, 2, 2]) };
}

/** Same rhythm and opening, a new ending: the answer to the motif's question. */
export function vary(rng: Rng, m: Motif, amount = 3): Motif {
  const steps = m.steps.slice();
  for (let i = Math.max(1, steps.length - amount); i < steps.length; i++) {
    steps[i] = rng.pick([-2, -1, -1, 1, 1, 2, 0]);
  }
  return { ...m, steps };
}

// Beyond these a melody stops sounding like a melody (and the bell turns to a whistle).
const MIN_NOTE = 45;
const MAX_NOTE = 93;

export interface RealizeOpts {
  /** Where the motif starts, in 16ths from the section start. */
  step: number;
  /** Degree the melody gravitates around (0 = tonic in the melody register). */
  center: number;
  lo: number;
  hi: number;
  /** 'close' lands the last note on the tonic, 'open' on another chord tone (a question). */
  ending?: 'close' | 'open';
  /** Rhythm multiplier: 2 plays the motif at half speed over four bars. */
  stretch?: number;
  /** Scale degrees (mod 7) to step around, e.g. [3, 6] for a pentatonic feel. */
  avoid?: readonly number[];
  velocity?: number;
  /** Semitone shift applied after fitting (12 for an octave-up restatement). */
  transpose?: number;
}

/** Fits a motif to the harmony under it and returns playable notes. */
export function realize(ctx: Ctx, m: Motif, o: RealizeOpts): Note[] {
  const stretch = o.stretch ?? 1;
  const notes: Note[] = [];
  let deg = 0;
  const avoid = new Set(o.avoid ?? []);
  // a line that reaches the edge of its range turns back (an octave jump down would tear its shape)
  const fit = (d: number, dir: number) => {
    if (d > o.hi) d = Math.max(o.lo, 2 * o.hi - d);
    if (d < o.lo) d = Math.min(o.hi, 2 * o.lo - d);
    if (avoid.has(((d % 7) + 7) % 7)) d += dir >= 0 ? -1 : 1;
    return d;
  };
  const snapToChord = (d: number, slot: ChordSlot, dir: number, prefer?: (d: number) => boolean): number => {
    const order = dir >= 0 ? [0, 1, -1, 2, -2, 3, -3] : [0, -1, 1, -2, 2, -3, 3];
    for (const k of order) {
      const c = d + k;
      if (c >= o.lo - 1 && c <= o.hi + 1 && ctx.isChordTone(c, slot) && (!prefer || prefer(c))) return c;
    }
    // no preferred tone in this chord (a close over a dominant): any chord tone, a half cadence
    return prefer ? snapToChord(d, slot, dir) : d;
  };

  for (let i = 0; i < m.rhythm.length; i++) {
    const r = m.rhythm[i];
    const step = o.step + r.on * stretch;
    const slot = ctx.chordAtStep(step);
    const strong = (r.on * stretch) % 8 === 0 || r.len * stretch >= 8;
    const last = i === m.rhythm.length - 1;
    if (i === 0) {
      // the chord tone `start` closest to the centre
      const base = [0, 2, 4][m.start];
      const rootDeg = degreeOfRoot(ctx, slot);
      deg = rootDeg + base;
      while (deg - o.center > 3) deg -= 7;
      while (o.center - deg > 3) deg += 7;
      deg = snapToChord(deg, slot, 1);
    } else {
      const dir = m.steps[i];
      deg = fit(deg + dir, dir);
      if (last && o.ending === 'close') deg = snapToChord(deg, slot, dir, (d) => ((d % 7) + 7) % 7 === 0);
      else if (last && o.ending === 'open') deg = snapToChord(deg, slot, dir, (d) => ((d % 7) + 7) % 7 !== 0);
      else if (strong) deg = snapToChord(deg, slot, dir);
    }
    if (r.rest) continue;
    const n = ctx.pitch(deg, slot) + (o.transpose ?? 0);
    notes.push({ t: ctx.at(step), d: r.len * stretch * ctx.s16, n, v: (o.velocity ?? 1) * (strong ? 1 : 0.86) });
  }
  // keep the phrase in range by moving all of it an octave at a time; fold single notes only if it can't fit
  const hi = () => notes.reduce((x, n) => Math.max(x, n.n), -Infinity);
  const lo = () => notes.reduce((x, n) => Math.min(x, n.n), Infinity);
  while (notes.length && hi() > MAX_NOTE && lo() - 12 >= MIN_NOTE) for (const n of notes) n.n -= 12;
  while (notes.length && lo() < MIN_NOTE && hi() + 12 <= MAX_NOTE) for (const n of notes) n.n += 12;
  for (const n of notes) {
    while (n.n > MAX_NOTE) n.n -= 12;
    while (n.n < MIN_NOTE) n.n += 12;
  }
  // make each note end where the next begins (legato), except before rests
  for (let i = 0; i < notes.length - 1; i++) notes[i].d = Math.min(notes[i].d, notes[i + 1].t - notes[i].t);
  return notes;
}

function degreeOfRoot(ctx: Ctx, slot: ChordSlot): number {
  // the chord's root as a degree of the key, in the octave of the tonic
  for (let d = 0; d < 7; d++) if (ctx.pitch(d, slot) % 12 === slot.pcs[0]) return d;
  return 0;
}

/**
 * A phrase built from the motif, the way songs are: statement, answer, statement, cadence.
 * For 8+ bars: M (bars 1-2), M' open (3-4), M (5-6), M'' closed (7-8). For 4 bars: M, M'' closed.
 */
/** How a phrase is built from motifs, in two-bar slots. */
export type PhraseForm = 'period' | 'sentence' | 'aaba' | 'abab' | 'sequence';

export const PHRASE_FORMS: readonly PhraseForm[] = ['period', 'sentence', 'aaba', 'abab', 'sequence'];

/** The motif upside down: every step goes the other way. */
export const invert = (m: Motif): Motif => ({ ...m, steps: m.steps.map((s, i) => (i ? -s : 0)) });

/** The motif's first bar, stated twice: the "fragmentation" that drives a phrase forward. */
export function fragment(m: Motif): Motif {
  const head = m.rhythm.findIndex((r) => r.on >= 16);
  const n = head > 0 ? head : Math.max(1, m.rhythm.length >> 1);
  const half = m.rhythm.slice(0, n);
  const span = half[half.length - 1].on + half[half.length - 1].len;
  const rhythm = [...half, ...half.map((r) => ({ ...r, on: r.on + 16 }))].filter((r) => r.on < 32);
  if (span > 16) rhythm.splice(n); // a first bar that spills over can't be repeated in time
  const steps = [...m.steps.slice(0, n), ...m.steps.slice(0, n).map((s, i) => (i ? s : 1))].slice(0, rhythm.length);
  return { ...m, rhythm, steps };
}

/**
 * A phrase from motif A (and B for contrast), the way written melodies are built:
 * - period: A, A' (open), A, A'' (closed): question and answer
 * - sentence: A, A a step higher, A's first bar twice, cadence: an idea, restated, driven forward, closed
 * - aaba: A, A, B, A'': the song form in miniature
 * - abab: A, B (open), A, B' (closed)
 * - sequence: A climbing a step each time, then home
 */
export function phrase(
  ctx: Ctx,
  rng: Rng,
  m: Motif,
  fromBar: number,
  bars: number,
  o: Omit<RealizeOpts, 'step'>,
  form: PhraseForm = 'period',
  b?: Motif,
): Note[] {
  const out: Note[] = [];
  const answer = vary(rng.fork('answer'), m, 3);
  const cadence = vary(rng.fork('cadence'), m, 2);
  const other = b ?? invert(m);
  const stretch = o.stretch ?? 1;
  const slots = Math.floor(bars / (2 * stretch));
  type Slot = [Motif, 'open' | 'close' | undefined, number];
  const plans: Record<PhraseForm, Slot[]> = {
    period: [[m, undefined, 0], [answer, 'open', 0], [m, undefined, 0], [cadence, 'close', 0]],
    sentence: [[m, undefined, 0], [m, undefined, 1], [fragment(m), undefined, 2], [cadence, 'close', 0]],
    aaba: [[m, undefined, 0], [answer, undefined, 0], [other, undefined, 2], [cadence, 'close', 0]],
    abab: [[m, undefined, 0], [other, 'open', 0], [m, undefined, 0], [vary(rng.fork('b'), other, 2), 'close', 0]],
    sequence: [[m, undefined, 0], [m, undefined, 1], [m, undefined, 2], [cadence, 'close', 0]],
  };
  const full = plans[form];
  const plan: Slot[] = slots >= 4 ? full : slots >= 2 ? [full[0], [cadence, 'close', 0]] : [[m, 'close', 0]];
  for (let k = 0; k < Math.min(slots, plan.length); k++) {
    const [motif, ending, lift] = plan[k];
    out.push(
      ...realize(ctx, motif, {
        ...o,
        center: o.center + lift,
        step: (fromBar + 2 * stretch * k) * 16,
        ending: ending ?? o.ending,
      }),
    );
  }
  return out;
}
