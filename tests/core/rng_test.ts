import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { hash32, hashString, Rng } from '../../src/core/rng.ts';

const draw = (r: Rng, n: number) => Array.from({ length: n }, () => r.u32());

Deno.test('the same seed gives the same stream', () => {
  assertEquals(draw(new Rng(42), 100), draw(new Rng(42), 100));
  assertNotEquals(draw(new Rng(42), 10), draw(new Rng(43), 10));
});

Deno.test('the stream is pinned: a change here changes every song ever shared', () => {
  assertEquals(draw(new Rng(1), 3), [1673614005, 137802226, 2895809346]);
  assertEquals(hashString('amber-quiet-harbor'), 142871215);
});

Deno.test('forks depend on the seed and labels, not on draws made before', () => {
  const a = new Rng(7);
  const b = new Rng(7);
  draw(b, 50);
  assertEquals(draw(a.fork('melody', 3), 5), draw(b.fork('melody', 3), 5));
  assertNotEquals(draw(a.fork('melody'), 5), draw(a.fork('drums'), 5));
});

Deno.test('ranges stay in bounds', () => {
  const r = new Rng(9);
  for (let i = 0; i < 10_000; i++) {
    const x = r.next();
    assert(x >= 0 && x < 1);
    const k = r.int(7);
    assert(Number.isInteger(k) && k >= 0 && k < 7);
    const j = r.jitter(2);
    assert(j >= -2 && j < 2);
  }
});

Deno.test('weighted picks follow their weights', () => {
  const r = new Rng(5);
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 20_000; i++) counts[r.weighted([['a', 3], ['b', 1]] as const)]++;
  const share = counts.a / 20_000;
  assert(share > 0.72 && share < 0.78, `share of a: ${share}`);
});

Deno.test('hash32 mixes every part', () => {
  assertNotEquals(hash32(1, 2), hash32(2, 1));
  assertNotEquals(hash32(0), hash32(0, 0));
  assert(hash32(123) >= 0 && hash32(123) <= 0xffffffff);
});
