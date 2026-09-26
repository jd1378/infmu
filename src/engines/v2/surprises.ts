// A piece's surprise: one moment it is remembered by, placed where the listener already knows what to expect of it.
// A surprise with no pattern before it sounds like a mistake; pleasure comes where a clear expectation is broken
// (Huron, "Sweet Anticipation", 2006; Cheung et al. 2019). At most one a piece, and not the kind either of the two
// pieces before had, so it never becomes the engine's habit.

import type { Role, SectionDef, Surprise } from './types.ts';

type Planned = Omit<SectionDef, 'seconds'>;
const BIG: ReadonlySet<Role> = new Set(['chorus', 'drop']);

/**
 * Places a surprise in a planned form, in place (a key jump is the lift's, see planForm): the kind placed, or null
 * when the form has no room for it. Each goes after the piece's first big part, at the point its kind reads best:
 * - `subito`: the returning big part nearest two thirds of the way in, before the peak, hushed;
 * - `alone`: a verse, bridge or break between a third and most of the way in, played bare;
 * - `pause`: a returning big part of eight bars or more, nearest seven tenths of the way in, stops for a bar;
 * - `halfTime`: the peak's run of big parts, its drums in half time.
 */
export function placeSurprise(kind: Surprise, secs: Planned[]): Surprise | null {
  const total = secs.reduce((n, s) => n + (s.role === 'rest' ? 0 : s.bars), 0);
  const pos = (i: number) => secs.slice(0, i).reduce((n, s) => n + (s.role === 'rest' ? 0 : s.bars), 0) / total;
  const bigs = secs.map((s, i) => (BIG.has(s.role) ? i : -1)).filter((i) => i >= 0);
  const top = Math.max(...secs.map((s) => s.energy));
  const peak = secs.findIndex((s) => s.energy === top);
  const nearest = (cands: number[], x: number) =>
    cands.length ? cands.reduce((a, b) => (Math.abs(pos(b) - x) < Math.abs(pos(a) - x) ? b : a)) : -1;
  const after = (i: number) => bigs.length > 0 && i > bigs[0] && !secs[i].treatment;
  const last = secs.findLastIndex((s) => s.role !== 'rest');
  switch (kind) {
    case 'subito': {
      const i = nearest(bigs.filter((i) => after(i) && i < peak), 0.65);
      if (i < 0) return null;
      secs[i] = { ...secs[i], treatment: 'hushed', energy: Math.min(secs[i].energy, 0.5) };
      return kind;
    }
    case 'alone': {
      const calm = secs.map((s, i) => (['verse', 'bridge', 'break'].includes(s.role) ? i : -1));
      const i = nearest(calm.filter((i) => i >= 0 && i < last && after(i) && pos(i) >= 0.35 && pos(i) <= 0.85), 0.6);
      if (i < 0) return null;
      secs[i] = { ...secs[i], treatment: 'bare', energy: Math.min(secs[i].energy, 0.3) };
      return kind;
    }
    case 'pause': {
      const i = nearest(bigs.filter((i) => after(i) && secs[i].bars >= 8), 0.7);
      if (i < 0) return null;
      secs[i] = { ...secs[i], surprise: 'pause' };
      return kind;
    }
    case 'halfTime': {
      if (!BIG.has(secs[peak].role)) return null;
      let a = peak;
      while (secs[a - 1]?.role === secs[peak].role && !secs[a - 1].treatment) a--;
      for (let i = a; secs[i]?.role === secs[peak].role && !secs[i].treatment; i++) {
        secs[i] = { ...secs[i], surprise: 'halfTime' };
      }
      return kind;
    }
    case 'keyJump':
      return null;
  }
}
