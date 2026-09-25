import { assert, assertEquals, assertMatch } from '@std/assert';
import { displaySeed, MAX_SEED_LENGTH, normalizeSeed, randomSeedPhrase, roman } from '../../src/core/seed.ts';
import { normalizeSeed as v1Normalize, seedNumber } from '../../src/engines/v1/seed.ts';

Deno.test('seeds that read the same are the same seed', () => {
  assertEquals(normalizeSeed('  Amber  Quiet_Harbor! '), 'amber-quiet-harbor');
  assertEquals(seedNumber('Amber Quiet Harbor'), seedNumber('amber-quiet-harbor'));
  assertEquals(normalizeSeed('--a---b--'), 'a-b');
  assertEquals(normalizeSeed('Ünïcode 音楽'), 'ünïcode-音楽');
  assertEquals(normalizeSeed('<script>alert(1)</script>'), 'scriptalert1script');
  assertEquals(normalizeSeed('x'.repeat(200)).length, MAX_SEED_LENGTH);
});

Deno.test('the interface and the v1 engine normalize seeds identically', () => {
  for (const s of ['  Amber  Quiet_Harbor! ', 'Ünïcode 音楽', '<b>x</b>', 'x'.repeat(200), '--a---b--']) {
    assertEquals(normalizeSeed(s), v1Normalize(s));
  }
});

Deno.test('display swaps hyphens for spaces without losing the seed', () => {
  const phrase = 'amber-quiet-harbor';
  assertEquals(displaySeed(phrase), 'amber quiet harbor');
  assertEquals(normalizeSeed(displaySeed(phrase)), phrase);
});

Deno.test('random phrases are three distinct-ish words', () => {
  let n = 0;
  const phrase = randomSeedPhrase((k) => (n++ * 7) % k);
  assertMatch(phrase, /^[a-z]+-[a-z]+-[a-z]+$/);
  const [a, b] = phrase.split('-');
  assert(a !== b);
});

Deno.test('roman numerals', () => {
  assertEquals([1, 4, 9, 14, 40, 90, 400, 1994, 3999].map(roman), [
    'I',
    'IV',
    'IX',
    'XIV',
    'XL',
    'XC',
    'CD',
    'MCMXCIV',
    'MMMCMXCIX',
  ]);
  assertEquals(roman(0), '0');
  assertEquals(roman(4000), '4000');
});
