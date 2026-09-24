import { assertEquals } from '@std/assert';
import { hashFor, MAX_MOVEMENT, readHash } from '../../src/ui/url.ts';

Deno.test('a place survives the round trip through the URL', () => {
  const place = { seed: 'amber-quiet-harbor', movement: 2, time: 42.9, styles: ['drift' as const, 'haze' as const] };
  const hash = hashFor(place);
  assertEquals(hash, '#seed=amber-quiet-harbor&m=3&t=42&styles=drift%2Chaze');
  assertEquals(readHash(hash), { seed: 'amber-quiet-harbor', movement: 2, time: 42, styles: ['drift', 'haze'] });
  assertEquals(hashFor({ seed: 'x', movement: 0, time: 0.5 }), '#seed=x');
  assertEquals(hashFor({ seed: 'x', styles: ['drift', 'haze', 'pulse', 'rise', 'cathedral'] }), '#seed=x');
});

Deno.test('malformed or hostile hashes are ignored, not trusted', () => {
  assertEquals(readHash(''), {});
  assertEquals(readHash('#seed=%3Cimg%20src%3Dx%3E'), { seed: 'img-srcx' });
  assertEquals(readHash('#seed=a&m=0&t=-5'), { seed: 'a' });
  assertEquals(readHash('#seed=a&m=1.5&t=NaN'), { seed: 'a' });
  assertEquals(readHash(`#seed=a&m=${MAX_MOVEMENT + 1}`), { seed: 'a' });
  assertEquals(readHash(`#seed=a&m=${MAX_MOVEMENT}`).movement, MAX_MOVEMENT - 1);
  assertEquals(readHash('#seed=a&styles=drift,evil,haze'), { seed: 'a', styles: ['drift', 'haze'] });
  assertEquals(readHash('#seed=---&t=Infinity'), {});
});
