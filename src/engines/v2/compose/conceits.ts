// A piece's one big idea (see Conceit), written over its style's arrangement.
//
// An ostinato: a one-bar figure on fixed notes of the key, the same in every bar from the intro on, so that each
// chord moving under it recolours it (as Glass's and Reich's figures do, or a post-rock guitar's picked pattern over
// a changing bass). A phase piece: two or three soft loops of a few notes each, their lengths unrelated to each other
// and to the bar, drifting so that their meeting never repeats (Eno, "Music for Airports", 1978: tape loops of 23 1/2,
// 25 7/8 and 29 15/16 seconds).

import { bounces } from '../moods.ts';
import { degreeToMidi, MAJOR_MODES, tonicNear } from '../theory.ts';
import type { Meter, StyleId } from '../types.ts';
import type { Ctx } from './context.ts';
import { moves } from './parts.ts';

/** Ostinato figures: scale degrees (7 the octave) on the eighths of a bar, grouped 3 + 3 + 2. */
const FIGURES: readonly (readonly number[])[] = [
  [0, 4, 7, 0, 4, 7, 0, 4],
  [0, 4, 2, 0, 4, 2, 4, 7],
  [2, 0, 4, 2, 0, 4, 2, 4],
  [0, 7, 4, 2, 0, 7, 4, 2],
];

/** Where a figure's groups of eighths start, in 16ths: 3 + 3 + 2 in four. */
const GROUPS: Record<Meter, readonly number[]> = {
  '4/4': [0, 6, 12],
  '3/4': [0, 4, 8],
  '6/8': [0, 6],
};

/** Who plays a style's ostinato, and around which note (the tonic nearest it). */
const OSTINATO: Partial<Record<StyleId, { voice: 'piano' | 'pluck' | 'string' | 'kalimba'; around: number }>> = {
  nocturne: { voice: 'piano', around: 60 },
  cathedral: { voice: 'piano', around: 50 },
  haze: { voice: 'piano', around: 62 },
  pulse: { voice: 'pluck', around: 62 },
  ember: { voice: 'string', around: 64 },
  garden: { voice: 'kalimba', around: 64 },
};

/**
 * Phase loops: each a period in beats and its notes as [beat, degree]. The periods are primes, so the loops meet
 * the same way only after their product (thousands of beats): never inside a piece. None starts on the piece's first
 * beat: a piece opens quietly (see opening()).
 */
const LOOPS: readonly (readonly [number, readonly (readonly [number, number])[]])[] = [
  [23, [[1.5, 0], [10, 4]]],
  [29, [[3, 2], [14, 7], [21, 1]]],
  [37, [[6, 9], [25, 5]]],
];

/** Who plays a style's loops, and around which note. */
const PHASE: Partial<Record<StyleId, { voice: 'bell' | 'piano' | 'vibes'; around: number }>> = {
  drift: { voice: 'bell', around: 72 },
  nocturne: { voice: 'piano', around: 72 },
  cathedral: { voice: 'bell', around: 72 },
  garden: { voice: 'vibes', around: 67 },
};

export function conceit(ctx: Ctx): void {
  if (ctx.role === 'rest') return;
  if (ctx.mv.conceit === 'ostinato') ostinato(ctx);
  if (ctx.mv.conceit === 'phase') phase(ctx);
}

/**
 * The figure, on the eighths the piece's motion lets through (in a major key in three, unless the mood is joy, on
 * the beats only: a figure going round in a major waltz is a carousel), from the intro's second half to the end,
 * leaning on its groups' first notes and growing with the piece.
 */
function ostinato(ctx: Ctx): void {
  const who = OSTINATO[ctx.mv.style];
  if (!who) return;
  const figure = ctx.mrng.fork('ostinato').pick(FIGURES);
  const tonic = tonicNear(ctx.key, who.around);
  const waltz = ctx.mv.meter !== '4/4' && MAJOR_MODES.has(ctx.key.mode) && !bounces(ctx.mv.mood);
  const groups = GROUPS[ctx.mv.meter];
  const from = ctx.role === 'intro' ? Math.floor(ctx.bars / 2) : 0;
  for (let b = from; b < ctx.bars; b++) {
    for (let s = 0, k = 0; s < ctx.spb; s += 2, k++) {
      if (!moves(ctx, s) || (waltz && !ctx.onBeat(s))) continue;
      const n = degreeToMidi(ctx.key, figure[k % figure.length], tonic);
      const v = (0.3 + 0.3 * ctx.sec.energy) * (groups.includes(s) ? 1.15 : 0.9);
      const t = ctx.barAt(b, s);
      const d = 1.4 * 2 * ctx.s16;
      if (who.voice === 'piano') ctx.push({ i: 'piano', t, d, n: [n], v });
      else if (who.voice === 'pluck') {
        ctx.push({ i: 'pluck', t, n, v, cut: 900 + 1800 * ctx.sec.energy, p: k % 2 ? 0.3 : -0.3 });
      } else if (who.voice === 'string') ctx.push({ i: 'string', t, n, v, k: 'clean', d, p: 0.3 });
      else ctx.push({ i: 'mallet', t, n, v, k: 'kalimba', p: -0.3 });
    }
  }
}

/** The loops, each note where its loop's clock puts it, counted from the start of the piece. */
function phase(ctx: Ctx): void {
  const who = PHASE[ctx.mv.style];
  if (!who) return;
  const tonic = tonicNear(ctx.key, who.around);
  const start = ctx.mv.sections.slice(0, ctx.local).reduce((n, s) => n + s.bars, 0) * ctx.spb;
  const end = start + ctx.bars * ctx.spb;
  LOOPS.forEach(([period, notes], l) => {
    const P = period * 4;
    for (const [beat, deg] of notes) {
      const O = beat * 4;
      for (let g = Math.ceil((start - O) / P) * P + O; g < end; g += P) {
        const t = ctx.at(g - start);
        const n = degreeToMidi(ctx.key, deg, tonic);
        const v = 0.32 + 0.12 * l;
        if (who.voice === 'bell') ctx.push({ i: 'bell', t, n: [n], v });
        else if (who.voice === 'piano') ctx.push({ i: 'piano', t, d: 3 * ctx.beat, n: [n], v, pedal: true });
        else ctx.push({ i: 'mallet', t, n, v, k: 'vibes', p: [-0.5, 0.5, 0][l] });
      }
    }
  });
}
