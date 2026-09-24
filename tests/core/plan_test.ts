import { assert, assertAlmostEquals, assertEquals, assertThrows } from '@std/assert';
import { sectionDuration, Song } from '../../src/core/plan.ts';
import { STYLE_IDS } from '../../src/core/styles.ts';

Deno.test('a seed plans the same journey however it is explored', () => {
  const a = new Song('journey');
  const b = new Song('journey');
  b.section(300); // plan far ahead first
  for (let m = 0; m < 12; m++) assertEquals(a.movement(m), b.movement(m));
});

Deno.test('movements chain: sections and times follow on without gaps', () => {
  const song = new Song('chain');
  for (let m = 1; m < 20; m++) {
    const prev = song.movement(m - 1);
    const mv = song.movement(m);
    assertEquals(mv.firstSection, prev.firstSection + prev.sections.length);
    assertAlmostEquals(mv.startTime, prev.startTime + prev.duration, 1e-9);
    const sum = mv.sections.reduce((s, _, i) => s + sectionDuration(mv, i), 0);
    assertAlmostEquals(sum, mv.duration, 1e-9);
  }
});

Deno.test('section lookup and locate agree', () => {
  const song = new Song('locate');
  for (let i = 0; i < 80; i += 3) {
    const ref = song.section(i);
    const back = song.locate(ref.movement.index, ref.offset + 0.5);
    assertEquals(back.index, i);
    assertAlmostEquals(back.offset, 0.5, 1e-9);
  }
  const mv = song.movement(2);
  assertEquals(song.locate(2, -10), { index: mv.firstSection, offset: 0 });
  assertEquals(song.locate(2, 1e9).index, mv.firstSection + mv.sections.length - 1);
  assertThrows(() => song.section(-1));
  assertThrows(() => song.movement(1.5));
});

Deno.test('the style filter holds for the whole journey', () => {
  for (const s of STYLE_IDS) {
    const song = new Song('filtered', [s]);
    for (let m = 0; m < 10; m++) assertEquals(song.movement(m).style, s);
  }
  const two = new Song('filtered', ['drift', 'haze']);
  for (let m = 0; m < 20; m++) assert(['drift', 'haze'].includes(two.movement(m).style));
  assertEquals(new Song('x', []).styles, STYLE_IDS);
});

Deno.test('tempo and swing stay inside the style', () => {
  const song = new Song('ranges');
  for (let m = 0; m < 40; m++) {
    const mv = song.movement(m);
    assert(mv.bpm >= 60 && mv.bpm <= 128, `${mv.bpm}`);
    assert(Number.isInteger(mv.bpm));
    assert(mv.swing >= 0 && mv.swing < 0.3);
  }
});
