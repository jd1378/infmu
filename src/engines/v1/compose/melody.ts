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

const SPLITS: Record<number, readonly (readonly number[])[]> = {
  32: [[16, 16]],
  16: [[8, 8], [8, 8], [6, 6, 4], [4, 4, 8], [12, 4]],
  12: [[8, 4], [6, 6], [4, 4, 4]],
  8: [[4, 4], [4, 4], [3, 3, 2], [6, 2], [2, 2, 4]],
  6: [[3, 3], [4, 2], [2, 4]],
  4: [[2, 2], [3, 1], [2, 2]],
  3: [[2, 1]],
  2: [[1, 1]],
};

/** density 0..1: 0 is a few long notes, 1 is busy sixteenths. */
export function makeMotif(rng: Rng, density: number): Motif {
  const rhythm: Motif['rhythm'] = [];
  const pSplit = (len: number) =>
    len >= 32
      ? 1
      : len >= 16
      ? 0.7 + 0.3 * density
      : len >= 8
      ? 0.35 + 0.55 * density
      : len >= 4
      ? 0.1 + 0.45 * density
      : 0.05 * density;
  const split = (on: number, len: number) => {
    const opts = SPLITS[len];
    if (!opts || !rng.chance(pSplit(len))) {
      rhythm.push({ on, len, rest: false });
      return;
    }
    let o = on;
    for (const part of rng.pick(opts)) {
      split(o, part);
      o += part;
    }
  };
  split(0, 32);
  // a motif breathes: a few rests, never on the first note, and it ends on something held
  for (let i = 1; i < rhythm.length - 1; i++) if (rng.chance(0.12)) rhythm[i].rest = true;
  while (rhythm.length > 2 && rhythm[rhythm.length - 1].len < 4) {
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
      const size = rng.weighted([[0, 12], [1, 50], [2, 22], [3, 8], [4, 5], [5, 3]] as const);
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
  const fit = (d: number, dir: number) => {
    while (d > o.hi) d -= 7;
    while (d < o.lo) d += 7;
    if (avoid.has(((d % 7) + 7) % 7)) d += dir >= 0 ? 1 : -1;
    return d;
  };
  const snapToChord = (d: number, slot: ChordSlot, dir: number, prefer?: (d: number) => boolean) => {
    const order = dir >= 0 ? [0, 1, -1, 2, -2, 3, -3] : [0, -1, 1, -2, 2, -3, 3];
    for (const k of order) {
      const c = d + k;
      if (c >= o.lo - 1 && c <= o.hi + 1 && ctx.isChordTone(c, slot) && (!prefer || prefer(c))) return c;
    }
    return d;
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
    let n = ctx.pitch(deg, slot) + (o.transpose ?? 0);
    while (n > MAX_NOTE) n -= 12;
    while (n < MIN_NOTE) n += 12;
    notes.push({ t: ctx.at(step), d: r.len * stretch * ctx.s16, n, v: (o.velocity ?? 1) * (strong ? 1 : 0.86) });
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
export function phrase(
  ctx: Ctx,
  rng: Rng,
  m: Motif,
  fromBar: number,
  bars: number,
  o: Omit<RealizeOpts, 'step'>,
): Note[] {
  const out: Note[] = [];
  const answer = vary(rng.fork('answer'), m, 3);
  const cadence = vary(rng.fork('cadence'), m, 2);
  const stretch = o.stretch ?? 1;
  const slots = Math.floor(bars / (2 * stretch));
  const plan: [Motif, 'open' | 'close' | undefined][] = slots >= 4
    ? [[m, undefined], [answer, 'open'], [m, undefined], [cadence, 'close']]
    : slots >= 2
    ? [[m, undefined], [cadence, 'close']]
    : [[m, 'close']];
  for (let k = 0; k < Math.min(slots, plan.length); k++) {
    const [motif, ending] = plan[k];
    out.push(...realize(ctx, motif, { ...o, step: (fromBar + 2 * stretch * k) * 16, ending: ending ?? o.ending }));
  }
  return out;
}
