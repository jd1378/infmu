import { assert, assertEquals, assertThrows } from '@std/assert';
import { engine } from '../../../src/engines/index.ts';

Deno.test('every instrument can be played alone: each note or sound renders, and nothing else does', () => {
  const e = engine(2);
  const all = e.instruments!;
  assertEquals(new Set(all.map((x) => x.id)).size, all.length);
  for (const x of all) {
    assert(!!x.range !== !!x.hits, `${x.id} is pitched or struck, not both`);
    const plays = x.range ? [x.range[0], x.range[1]] : x.hits!.map((h) => h.id);
    for (const n of plays) {
      const r = e.renderNote!(x.id, n, 12000);
      let peak = 0;
      for (let i = 0; i < r.left.length; i++) peak = Math.max(peak, Math.abs(r.left[i]), Math.abs(r.right[i]));
      assert(Number.isFinite(peak) && peak > 0.02 && peak <= 1, `${x.id} ${n}: peak ${peak}`);
    }
  }
  assertThrows(() => e.renderNote!('no-such', 60, 12000));
  assertThrows(() => e.renderNote!('piano', 'kick', 12000));
  assertThrows(() => e.renderNote!('kit:acoustic', 'cowbell', 12000));
  assertEquals(engine(1).renderNote, undefined);
});
