// A piece's arc: the story its loudness and its fullness tell. Pieces that all start quiet and peak near their end
// are one journey at different speeds when heard back to back, so each piece tells one of several, as its style's
// idiom allows: the climb; an early peak and its afterglow; a plateau reached soon and held, with no single climax;
// a cold open on the big part; a piece that starts full and lets go; one that ends on its peak. Energy sets the
// loudness (see render's targetLufs); a section's treatment sets who plays, so a quiet chorus is a smaller band,
// not the same band turned down.

import { ROLE_ENERGY } from './styles.ts';
import type { Arc, Role, Treatment } from './types.ts';

interface Step {
  role: Role;
  bars: number;
  optional: boolean;
}

const CALM: ReadonlySet<Role> = new Set(['intro', 'outro', 'rest', 'break', 'bridge']);
const BIG: ReadonlySet<Role> = new Set(['chorus', 'drop']);

/** Arcs that open loud: only after a piece that ended in a pause, a stop or a swell into them, and never first. */
export const LOUD_OPENINGS: ReadonlySet<Arc> = new Set(['cold', 'dissolve']);
/** Arcs whose last big part is their peak: only these lift the key for it. */
export const LIFTS: ReadonlySet<Arc> = new Set(['climb', 'cold', 'lastWord']);

/**
 * The form an arc asks for, from the one the style drew (before it is fitted to its length). A cold open, or a
 * piece that dissolves, starts on eight bars of its big part in place of its intro, and one that dissolves has no
 * builds (it has nothing to build to); a piece that ends on its peak has no outro.
 */
export function shapeForm(arc: Arc, steps: Step[]): Step[] {
  let out = steps;
  const big = out.find((s) => BIG.has(s.role));
  if ((arc === 'cold' || arc === 'dissolve') && big && out[0].role === 'intro') {
    out = [{ role: big.role, bars: 8, optional: false }, ...out.slice(1)];
  }
  if (arc === 'dissolve') out = out.filter((s, i) => i === 0 || (s.role !== 'build' && s.role !== 'prechorus'));
  if (arc === 'lastWord' && out.at(-1)?.role === 'outro') out = out.slice(0, -1);
  return out;
}

/** After fitting to length: a piece that ends on its peak ends on a big part, not on a break fitted in after it. */
export function settle(arc: Arc, steps: Step[]): Step[] {
  if (arc !== 'lastWord') return steps;
  const end = steps.findLastIndex((s) => BIG.has(s.role));
  return end > 0 ? steps.slice(0, end + 1) : steps;
}

/**
 * The arc a fitted form can tell: an early peak needs a big part starting before 60% of the piece, a cold open or
 * a piece that dissolves one to open on, a piece with the last word one to end on. Otherwise it climbs.
 */
export function tells(arc: Arc, steps: readonly { role: Role; bars: number }[]): Arc {
  const total = steps.reduce((n, s) => n + s.bars, 0);
  let at = 0;
  const early = steps.some((s) => {
    const pos = at / total;
    at += s.bars;
    return BIG.has(s.role) && pos < 0.6;
  });
  const ok = arc === 'early'
    ? early
    : arc === 'cold' || arc === 'dissolve'
    ? BIG.has(steps[0].role)
    : arc === 'lastWord'
    ? BIG.has(steps.at(-1)!.role)
    : true;
  return ok ? arc : 'climb';
}

/**
 * The climb, before it is scaled: each part's energy by its role, growing with its place in the piece (to the power
 * `burn`: most climb steadily, some rise early and hold, some smoulder and burn late); a run of builds is one
 * crescendo, from under a build's usual energy to over it.
 */
function climbing(steps: readonly { role: Role; bars: number }[], burn: number): number[] {
  const total = steps.reduce((n, s) => n + s.bars, 0);
  let at = 0;
  const raw = steps.map((s) => {
    const pos = (at / total) ** burn;
    at += s.bars;
    return ROLE_ENERGY[s.role] + (CALM.has(s.role) ? 0.1 : 0.35) * pos;
  });
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].role !== 'build' || steps[i - 1]?.role === 'build') continue;
    let j = i;
    while (steps[j + 1]?.role === 'build') j++;
    for (let k = i; k <= j; k++) raw[k] += j > i ? -0.12 + (0.3 * (k - i)) / (j - i) : 0;
  }
  return raw;
}

/** Scaled so the loudest is 1. */
const peaked = (e: number[]) => {
  const top = Math.max(...e);
  return e.map((x) => x / top);
};

/**
 * Each section's energy (0..1, the peak 1) and treatment, for the arc:
 * - `climb`, `cold`, `lastWord`: every return of a part bigger than the one before, breaks and bridges falling
 *   back, the last big part the peak (a cold open starts high by its role; a piece with the last word ends there);
 * - `early`: the climb to a big part a third to a half of the way in, then an afterglow, each part smaller as it
 *   goes and its big parts hushed;
 * - `plateau`: up by the end of the intro and held near the top, calm parts a little under it: no single climax;
 * - `dissolve`: its first part the fullest, each after it no fuller than the one before, its big parts hushed and
 *   its last stretch bare.
 */
export function arcPlan(
  arc: Arc,
  steps: readonly { role: Role; bars: number }[],
  burn: number,
): { energy: number[]; treatment: (Treatment | undefined)[] } {
  const total = steps.reduce((n, s) => n + s.bars, 0);
  const pos: number[] = [];
  let at = 0;
  for (const s of steps) {
    pos.push(at / total);
    at += s.bars;
  }
  const treatment: (Treatment | undefined)[] = steps.map(() => undefined);
  const bigs = steps.map((s, i) => (BIG.has(s.role) ? i : -1)).filter((i) => i >= 0);
  if (arc === 'early' && bigs.length) {
    const peak = bigs.find((i) => pos[i] >= 0.3 && pos[i] < 0.6) ?? bigs.filter((i) => pos[i] < 0.6).at(-1) ??
      bigs[0];
    const raw = climbing(steps.slice(0, peak + 1), 1);
    const energy = steps.map((s, i) => {
      if (i === peak) return 1;
      if (i < peak) return Math.min(0.95, raw[i] / raw[peak]);
      const after = (pos[i] - pos[peak]) / (1 - pos[peak]);
      if (BIG.has(s.role) || s.role === 'build' || s.role === 'solo') treatment[i] = 'hushed';
      return Math.min(treatment[i] ? 0.5 : 0.6, ROLE_ENERGY[s.role] * (1 - 0.45 * after));
    });
    return { energy, treatment };
  }
  if (arc === 'plateau') {
    const c = peaked(climbing(steps, burn));
    const energy = steps.map((s, i) =>
      s.role === 'intro' ? c[i] : s.role === 'outro' ? 0.45 : CALM.has(s.role) ? 0.55 + 0.2 * c[i] : 0.75 + 0.25 * c[i]
    );
    return { energy: peaked(energy), treatment };
  }
  if (arc === 'dissolve') {
    const energy: number[] = [];
    steps.forEach((s, i) => {
      if (i === 0) return energy.push(1);
      if (BIG.has(s.role)) treatment[i] = 'hushed';
      if (pos[i] >= 0.6) treatment[i] = 'bare';
      energy.push(Math.min(energy[i - 1], Math.max(0.12, ROLE_ENERGY[s.role] * (1 - 0.5 * pos[i]) + 0.1)));
    });
    return { energy, treatment };
  }
  return { energy: peaked(climbing(steps, burn)), treatment };
}
