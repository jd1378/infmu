// A groove of the movement's own, invented from its genre's grammar: about half the 4/4 pieces of a style with drums
// play one instead of a written groove from its bank, so no bank is heard out. The grammar keeps what defines the
// genre (four on the floor, the backbeat, the half-time snare) and varies the rest: where the kick syncopates, ghost
// notes, the hat figure, the shaker, the fill, the bass.

import type { Rng } from '../rng.ts';
import type { StyleId } from '../types.ts';
import type { Groove, Weighted } from './grooves.ts';
import type { BassHit } from './parts.ts';

export type Family = 'four' | 'backbeat' | 'halftime';

/** The styles that invent grooves, and the family of beat each invents. */
export const INVENTS: Partial<Record<StyleId, Weighted<Family>>> = {
  rise: [['four', 1]],
  acid: [['four', 1]],
  pulse: [['four', 2], ['backbeat', 3]],
  garden: [['halftime', 1]],
  cathedral: [['halftime', 1]],
  ember: [['backbeat', 7], ['halftime', 3]],
};

/** The share of a style's 4/4 pieces that invent their groove. */
export const INVENTED = 0.5;

/** What an invented groove brings; the rest (kit, lag, the acid line) comes from the written groove it replaces. */
export type Invented = Pick<Groove, 'light' | 'full' | 'fill' | 'layer' | 'bassLight' | 'bassFull'>;

const EMPTY = '................';
const put = (p: string, s: number, c: string) => p.slice(0, s) + c + p.slice(s + 1);
const steps = (p: string) => [...p].flatMap((c, s) => (c !== '.' ? [s] : []));

/** Hat figures: the full bar's, and the lighter one a verse plays. */
const HATS: readonly (readonly [full: string, light: string])[] = [
  ['x.o.x.o.x.o.x.o.', 'x...x...x...x...'],
  ['o.x.o.x.o.x.o.x.', 'o...o...o...o...'],
  ['x-o-x-o-x-o-x-o-', 'x.o.x.o.x.o.x.o.'],
  ['xoxoxoxoxoxoxoxo', 'x-o-x-o-x-o-x-o-'],
  ['x.ox.xo.x.ox.xo.', 'x...x.o.x...x.o.'],
  ['..x...x...x...x.', '..o...o...o...o.'],
  ['x.xxx.xxx.xxx.xx', 'x.x.x.x.x.x.x.x.'],
];

function kickFor(family: Family, rng: Rng): string {
  if (family === 'four') return 'x...x...x...x...';
  // the downbeat always; extras where the genre syncopates (never on the backbeat), two hits at least, five at most
  const extras: readonly (readonly [number, number])[] = family === 'backbeat'
    ? [[8, 0.55], [10, 0.4], [6, 0.25], [7, 0.2], [3, 0.2], [11, 0.25], [14, 0.2], [2, 0.1]]
    : [[3, 0.3], [6, 0.35], [10, 0.45], [11, 0.3], [14, 0.25], [7, 0.15]];
  let k = put(EMPTY, 0, 'x');
  for (const [s, p] of extras) if (rng.chance(p)) k = put(k, s, s % 4 ? 'o' : 'x');
  if (steps(k).length < 2) k = put(k, family === 'backbeat' ? 8 : 10, 'x');
  while (steps(k).length > 5) k = put(k, rng.pick(steps(k).slice(1)), '.');
  return k;
}

/** A movement's own groove, from its stream (so every section agrees). */
export function inventGroove(rng: Rng, family: Family): Invented {
  const kick = kickFor(family, rng.fork('kick'));
  const lightKick = family === 'four' ? kick : [...kick].map((c, s) => (s % 8 === 0 || c === 'x' ? c : '.')).join('');
  const backbeat = family === 'halftime' ? put(EMPTY, 8, 'x') : put(put(EMPTY, 4, 'x'), 12, 'x');
  // ghost notes and a pushed last hit: the genre's small liberties
  let snare = backbeat;
  const g = rng.fork('ghosts');
  for (const s of family === 'halftime' ? [3, 11, 14, 15] : [7, 9, 15, 14]) {
    if (g.chance(family === 'four' ? 0.08 : 0.2)) snare = put(snare, s, family === 'four' ? 'o' : '-');
  }
  const [hatFull, hatLight] = rng.fork('hat').pick(HATS);
  const openAt = rng.fork('open').weighted<readonly number[]>([
    [[], 3],
    [[14], 2],
    [[6, 14], 1],
    [[2, 6, 10, 14], family === 'four' ? 3 : 0.5],
  ]);
  let open = EMPTY;
  for (const s of openAt) open = put(open, s, 'o');
  const hat = [...hatFull].map((c, s) => (openAt.includes(s) ? '.' : c)).join('');
  const shaker = rng.fork('shaker').chance(0.35)
    ? rng.fork('shaker-p').pick(['-o-o-o-o-o-o-o-o', '..-o..-o..-o..-o', '-.-o-.-o-.-o-.-o'])
    : undefined;
  // the fill: the last beat or two of a phrase, in one lane
  const fills = {
    snare16: { snare: put(put(put(put(snare, 12, 'x'), 13, 'o'), 14, 'o'), 15, 'x') },
    snare8: { snare: put(put(put(snare, 10, 'o'), 12, 'x'), 14, 'x') },
    kickPush: { kick: put(put(kick, 14, 'x'), 15, family === 'four' ? '.' : 'o') },
    openLift: { open: put(put(open, 14, 'x'), 15, '.') },
  };
  return {
    light: { kick: lightKick, snare: backbeat, hat: hatLight },
    full: { kick, snare, hat, open: openAt.length ? open : undefined, shaker },
    fill: fills[rng.fork('fill').pick(['snare16', 'snare8', 'kickPush', 'openLift'] as const)],
    // a part that returns plays the full beat's hats under the light kick and snare: the same part, grown
    layer: { hat, shaker },
    bassLight: bassFor(family, lightKick, rng.fork('bass'), true),
    bassFull: bassFor(family, kick, rng.fork('bass'), false),
  };
}

/** Rolling bass cells for four on the floor: the kick owns each beat's first 16th, the bass the other three. */
const CELLS: readonly (readonly number[])[] = [[0, 0, 0], [12, 0, 0], [0, 0, 12], [0, 12, 0], [0, 0, 7], [7, 0, 0]];

function bassFor(family: Family, kick: string, rng: Rng, light: boolean): BassHit[] {
  if (family === 'four') {
    const kind = rng.weighted([['rolling', 3], ['offbeat', 2], ['gallop', 2]] as const);
    if (light || kind === 'offbeat') return [2, 6, 10, 14].map((s) => [s, 2, 0, 1] as const);
    if (kind === 'gallop') return [0, 1, 2, 3].flatMap((b) => [[4 * b + 2, 1, 0, 1], [4 * b + 3, 1, 0, 0.8]] as const);
    // two cells, alternating, the last beat turning toward the next chord; the middle 16th of each beat leans
    const a = rng.pick(CELLS);
    const b = rng.pick(CELLS);
    return [a, b, a, rng.pick(CELLS)].flatMap((cell, beat) =>
      cell.map((iv, k) => [4 * beat + 1 + k, 1, iv, [0.8, 1, 0.6][k]] as const)
    );
  }
  const kind = rng.weighted([['kick', 3], ['eighths', 2], ['octaves', 2], ['pulse', 1], ['dotted', 1]] as const);
  switch (light && kind === 'pulse' ? 'eighths' : kind) {
    case 'eighths':
      return [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 2, 0, s % 4 ? 0.8 : 1] as const);
    case 'octaves':
      return [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 2, s % 4 === 2 ? 12 : 0, s % 4 ? 0.8 : 1] as const);
    case 'pulse':
      return Array.from({ length: 16 }, (_, s) => [s, 1, 0, s % 4 ? 0.7 : 1] as const);
    case 'dotted':
      return [[0, 3, 0, 1], [3, 3, 0, 0.85], [6, 2, 0, 0.8], [8, 3, 0, 1], [11, 3, 7, 0.85], [14, 2, 'A', 0.8]];
    default: {
      // on the kick, held to the next, and a walk into the next chord
      const on = steps(kick);
      const hits: BassHit[] = on.map((s, k) => [s, Math.min(on[k + 1] ?? 16, 14) - s, k % 2 ? 7 : 0, k ? 0.85 : 1]);
      if (!on.includes(14)) hits.push([14, 2, 'A', 0.75]);
      return hits.filter(([, len]) => len > 0);
    }
  }
}
