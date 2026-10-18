// Invented grooves (compose/invent.ts): each keeps what defines its genre's beat, and about half the 4/4 pieces of
// a style that invents play one.

import { assert, assertEquals } from '@std/assert';
import { Ctx } from '../../../src/engines/v2/compose/context.ts';
import { GARDEN_TIMES, grooveFor, HAZE, inTime, RISE } from '../../../src/engines/v2/compose/grooves.ts';
import { type Family, inventGroove } from '../../../src/engines/v2/compose/invent.ts';
import { Song } from '../../../src/engines/v2/plan.ts';
import { Rng } from '../../../src/engines/v2/rng.ts';
import type { StyleId } from '../../../src/engines/v2/types.ts';

Deno.test('an invented groove keeps its genre: four on the floor, the backbeat, the half-time snare', () => {
  for (const family of ['four', 'backbeat', 'halftime'] as Family[]) {
    for (let seed = 1; seed <= 200; seed++) {
      const g = inventGroove(new Rng(seed), family);
      const lanes = [g.light, g.full, g.fill, g.layer ?? {}].flatMap((bar) => Object.values(bar).filter(Boolean));
      assert(lanes.every((p) => p.length === 16), `${family}: a bar is 16 steps`);
      assert(g.full.kick?.[0] === 'x' && g.light.kick?.[0] === 'x', `${family}: the kick on the downbeat`);
      if (family === 'four') assertEquals(g.full.kick, 'x...x...x...x...');
      const snare = g.light.snare ?? '';
      if (family === 'halftime') assert(snare[8] === 'x' && snare[4] === '.' && snare[12] === '.', snare);
      else assert(snare[4] === 'x' && snare[12] === 'x', snare);
      for (const [s, len] of [...g.bassLight, ...g.bassFull]) assert(s >= 0 && len > 0 && s + len <= 16, `${s}+${len}`);
    }
  }
});

/** Whether the first movement of `seed` in `style` plays an invented groove. */
function invents(style: StyleId, seed: string): { meter: string; own: boolean } {
  const song = new Song(seed, [style]);
  const mv = song.movement(0);
  const ctx = new Ctx(song, mv.firstSection);
  const bank = style === 'rise' ? RISE : style === 'haze' ? HAZE : inTime(ctx, GARDEN_TIMES);
  return { meter: mv.meter, own: grooveFor(ctx, bank).name.startsWith('invented') };
}

Deno.test('about half the 4/4 pieces of a style that invents play their own groove; other times and styles never', () => {
  let own = 0;
  for (let seed = 0; seed < 60; seed++) if (invents('rise', `invent-${seed}`).own) own++;
  assert(own > 18 && own < 42, `${own} of 60 trance pieces invented their groove`);
  let other = 0;
  for (let seed = 0; seed < 300 && other < 8; seed++) {
    const x = invents('garden', `invent-time-${seed}`);
    if (x.meter === '4/4') continue;
    other++;
    assert(!x.own, `a garden piece in ${x.meter} invented its groove`);
  }
  assert(other > 0, 'no garden piece in another time to check');
  for (let seed = 0; seed < 30; seed++) assert(!invents('haze', `invent-haze-${seed}`).own, 'lo-fi invented');
});
