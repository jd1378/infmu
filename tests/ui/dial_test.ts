import { assertAlmostEquals } from '@std/assert';
import { barFraction } from '../../src/ui/dial.ts';

Deno.test('the bar hand follows bar lines that move with the tempo', () => {
  const score = { bpm: 120, bars: [0, 2, 4.5, 7] };
  assertAlmostEquals(barFraction(score, 1), 0.5);
  assertAlmostEquals(barFraction(score, 3.25), 0.5);
  assertAlmostEquals(barFraction(score, 6.9), 0.96);
  // without bar lines, bars are 240 / bpm apart
  assertAlmostEquals(barFraction({ bpm: 120 }, 3), 0.5);
});
