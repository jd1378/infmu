import { assertEquals } from '@std/assert';
import { sectionSeconds } from '../../src/ui/format.ts';
import { engine } from '../../src/engines/index.ts';

Deno.test('the section bar shows each section for as long as it plays', () => {
  // an engine that knows: a 6/8 piece's bars, a moving tempo
  const e = engine(2);
  for (let k = 0; k < 40; k++) {
    const mv = e.song(`bar-${k}`, ['nocturne', 'garden']).movement(0);
    const secs = sectionSeconds(mv);
    const sum = secs.reduce((a, b) => a + b, 0);
    assertEquals(Math.round(sum * 1000), Math.round(mv.duration * 1000), `seed bar-${k} (${mv.meter})`);
  }
  // one that doesn't: bars at a steady 4/4
  assertEquals(sectionSeconds({ bpm: 120, sections: [{ role: 'verse', bars: 8, energy: 0.5 }] }), [16]);
});
