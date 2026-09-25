import { assert, assertEquals } from '@std/assert';
import {
  chordName,
  chordPitchClasses,
  degreeToMidi,
  type Key,
  keyName,
  midiToDegree,
  pc,
  voiceLead,
} from '../../../src/engines/v1/theory.ts';

const dMinor: Key = { tonic: 2, mode: 'aeolian' };
const cMajor: Key = { tonic: 0, mode: 'ionian' };

Deno.test('degrees map through the mode, across octaves', () => {
  assertEquals([0, 1, 2, 7, -1].map((d) => degreeToMidi(cMajor, d, 60)), [60, 62, 64, 72, 59]);
  assertEquals([0, 2, 4, 6].map((d) => degreeToMidi(dMinor, d, 62)), [62, 65, 69, 72]);
  for (let m = 55; m < 80; m++) {
    const d = midiToDegree(cMajor, m, 60);
    assert(Math.abs(degreeToMidi(cMajor, d, 60) - m) <= 1);
  }
});

Deno.test('chords stack thirds in the mode, with alterations', () => {
  assertEquals(chordPitchClasses(dMinor, { deg: 0, size: 3 }), [2, 5, 9]);
  assertEquals(chordName(dMinor, { deg: 0, size: 3 }), 'Dm');
  assertEquals(chordName(dMinor, { deg: 5, size: 3 }), 'B♭');
  assertEquals(chordName(dMinor, { deg: 4, size: 3, alt: [0, 1] }), 'A'); // the major V of a minor key
  assertEquals(chordName(cMajor, { deg: 1, size: 4 }), 'Dm7');
  assertEquals(chordName(cMajor, { deg: 4, size: 4 }), 'G7');
  assertEquals(chordName(cMajor, { deg: 0, size: 5 }), 'Cmaj9');
  assertEquals(chordName(cMajor, { deg: 0, size: 3, sus: 2 }), 'Csus2');
  assertEquals(chordName(cMajor, { deg: 3, size: 3, alt: [0, -1] }), 'Fm'); // borrowed iv
});

Deno.test('key names spell with the key signature', () => {
  assertEquals(keyName({ tonic: 3, mode: 'aeolian' }), 'E♭ minor');
  assertEquals(keyName({ tonic: 6, mode: 'ionian' }), 'F♯ major');
  assertEquals(keyName({ tonic: 10, mode: 'dorian' }), 'B♭ dorian');
  assertEquals(keyName({ tonic: 4, mode: 'ionian' }), 'E major');
  assertEquals(keyName({ tonic: 1, mode: 'aeolian' }), 'C♯ minor');
});

Deno.test('voice leading keeps voices ordered, in range, close, and complete', () => {
  const chords = [[2, 5, 9], [10, 2, 5], [5, 9, 0], [0, 4, 7], [2, 5, 9, 0]];
  let prev: number[] | null = null;
  for (const pcs of chords) {
    const v = voiceLead(prev, pcs, 4, 50, 74);
    assertEquals(v.length, 4);
    for (let i = 1; i < v.length; i++) assert(v[i] > v[i - 1], `crossing in ${v}`);
    assert(v.every((n) => n >= 50 && n <= 74 && pcs.includes(pc(n))), `${v} for ${pcs}`);
    assert(v.some((n) => pc(n) === pcs[1]), 'the third is always there');
    if (prev) {
      const moved = v.reduce((s, n, i) => s + Math.abs(n - prev![i]), 0);
      assert(moved <= 12, `voices jumped ${moved} semitones`);
    }
    prev = v;
  }
});
