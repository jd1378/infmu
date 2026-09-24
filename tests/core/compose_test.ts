import { assert, assertEquals } from '@std/assert';
import { composeSection } from '../../src/core/compose/index.ts';
import { Song } from '../../src/core/plan.ts';
import { STYLE_IDS } from '../../src/core/styles.ts';
import { MODES, pc } from '../../src/core/theory.ts';
import type { Ev, Note } from '../../src/core/types.ts';

const numbers = (e: Ev): number[] =>
  Object.values(e).flatMap((v) =>
    Array.isArray(v) ? v.flatMap((x) => (typeof x === 'object' ? Object.values(x as Note) : [x])) : [v]
  ).filter((v): v is number => typeof v === 'number');

Deno.test('a section is the same score every time', () => {
  const a = composeSection(new Song('score'), 17);
  const b = composeSection(new Song('score'), 17);
  assertEquals(a.events, b.events);
  assertEquals(a.chords, b.chords);
});

Deno.test('every style composes valid, sorted events inside the section', () => {
  for (const style of STYLE_IDS) {
    const song = new Song(`valid-${style}`, [style]);
    for (let i = 0; i < 30; i++) {
      const s = composeSection(song, i);
      assert(s.duration > 0 && s.chords.length > 0, `${style} #${i}`);
      assert(s.events.length > 0, `${style} #${i} is empty`);
      let prev = 0;
      for (const e of s.events) {
        assert(e.t >= prev, 'events are sorted');
        prev = e.t;
        assert(e.t < s.duration + s.tail, `event after the tail: ${JSON.stringify(e)}`);
        assert(numbers(e).every(Number.isFinite), `non-finite value: ${JSON.stringify(e)}`);
      }
    }
  }
});

Deno.test('melodies stay in key and land on chord tones on strong beats', () => {
  let notes = 0;
  let outOfKey = 0;
  let strong = 0;
  let onChord = 0;
  for (let seed = 0; seed < 12; seed++) {
    const song = new Song(`melody-${seed}`);
    for (let i = 0; i < 25; i++) {
      const s = composeSection(song, i);
      const scale = MODES[s.movement.key.mode].map((x) => (x + s.movement.key.tonic) % 12);
      const s16 = 15 / s.bpm;
      for (const e of s.events) {
        if (e.i !== 'lead') continue;
        for (const n of e.ns) {
          notes++;
          const chord = s.chords.find((c) => n.t >= c.t - 1e-6 && n.t < c.t + c.d - 1e-6) ?? s.chords[0];
          if (!scale.includes(pc(n.n)) && !chord.pcs.includes(pc(n.n))) outOfKey++;
          if (Math.round(n.t / s16) % 8 === 0) {
            strong++;
            if (chord.pcs.includes(pc(n.n))) onChord++;
          }
          assert(n.n >= 45 && n.n <= 93, `note ${n.n} out of range`);
        }
      }
    }
  }
  assert(notes > 500, `only ${notes} melody notes`);
  assertEquals(outOfKey, 0);
  assert(onChord / strong > 0.95, `strong beats on chord tones: ${onChord}/${strong}`);
});

Deno.test('the last chord of a movement is the tonic', () => {
  const song = new Song('cadence');
  for (let m = 0; m < 8; m++) {
    const mv = song.movement(m);
    const last = composeSection(song, mv.firstSection + mv.sections.length - 1);
    assertEquals(last.chords[last.chords.length - 1].pcs[0], mv.key.tonic);
  }
});
