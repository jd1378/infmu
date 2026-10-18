// v2 is frozen: these fingerprints were taken when v2 was released. If one changes, a seed someone shared now
// plays something else. Don't update them; put the change in a new engine version instead.
// One deliberate exception, the day after the release, while it had barely been heard: about half the 4/4 pieces of
// the styles with drums now invent a groove of their own (compose/invent.ts), and every part plays in time (no
// drift around the beat, no late backbeat, no flams, no rolled chords, the same fill each time: it was heard as
// mess). These fingerprints were re-taken then; the plans are still what was released.

import { assertEquals } from '@std/assert';
import { composeSection } from '../../../src/engines/v2/compose/index.ts';
import { type Length, Song } from '../../../src/engines/v2/plan.ts';
import { renderScore } from '../../../src/engines/v2/synth/render.ts';
import type { StyleId } from '../../../src/engines/v2/types.ts';
import { engine } from '../../../src/engines/index.ts';

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
};
const pcm = (a: Float32Array) => {
  let h = 0x811c9dc5;
  const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193);
  return (h >>> 0).toString(16);
};

const GOLDEN: Record<string, string> = {
  'plan:amber-quiet-harbor': 'c3c81592',
  'score:amber-quiet-harbor:0': '8a7e1e63',
  'score:amber-quiet-harbor:3': '8433c917',
  'score:amber-quiet-harbor:11': 'ec26fe52',
  'score:amber-quiet-harbor:26': 'e1e3273a',
  'audio:amber-quiet-harbor:1': '6163c52b54dded9a',
  'audio:amber-quiet-harbor:7': '95abc85a78d5f519',
  'plan:hello': 'b885ffdf',
  'score:hello:0': '7f13b5bd',
  'score:hello:3': '17d9e5ad',
  'score:hello:11': '3e4be180',
  'score:hello:26': '9bd08a0c',
  'audio:hello:1': '8a36d0204154dadd',
  'audio:hello:7': '10f08a07d4999fb4',
  'plan:golden': '3a1aca84',
  'score:golden:0': '54344489',
  'score:golden:3': '962cb7a4',
  'score:golden:11': '1faec44a',
  'score:golden:26': 'f5db14e9',
  'audio:golden:1': 'e013621915aefa4f',
  'audio:golden:7': 'a6e1d93776b7dcf8',
  'plan:golden-short': '8879a71',
  'score:golden-short:0': '883429db',
  'score:golden-short:3': '5cf17947',
  'score:golden-short:11': '51498f7e',
  'score:golden-short:26': 'bb0606e6',
  'audio:golden-short:1': '1e489f184a3bdc12',
  'audio:golden-short:7': '2234a0367c46dc',
};

// every style and every length, between them
const SEEDS: [string, StyleId[] | undefined, Length][] = [
  ['amber-quiet-harbor', undefined, 'standard'],
  ['hello', undefined, 'standard'],
  ['golden', ['nocturne', 'cathedral', 'drift'], 'long'],
  ['golden-short', ['rise', 'acid', 'pulse', 'haze', 'garden', 'ember'], 'short'],
];

Deno.test('v2 plans, scores and audio are exactly what was released', () => {
  const got: Record<string, string> = {};
  for (const [seed, styles, length] of SEEDS) {
    const song = new Song(seed, styles, length);
    got[`plan:${seed}`] = fnv(JSON.stringify([0, 1, 2, 5, 9].map((m) => song.movement(m))));
    for (const i of [0, 3, 11, 26]) {
      const s = composeSection(song, i);
      got[`score:${seed}:${i}`] = fnv(JSON.stringify({ e: s.events, c: s.chords, d: s.duration, n: s.noiseSeed }));
    }
    for (const i of [1, 7]) {
      const r = renderScore(composeSection(song, i), 16000);
      got[`audio:${seed}:${i}`] = pcm(r.left) + pcm(r.right);
    }
  }
  assertEquals(got, GOLDEN);
});

Deno.test('the v2 engine port plays the frozen internals', () => {
  const e = engine(2);
  for (const [seed, styles, length] of SEEDS) {
    const r = e.render(e.song(seed, styles, length), 7, 16000);
    assertEquals(pcm(r.left) + pcm(r.right), GOLDEN[`audio:${seed}:7`]);
  }
});
