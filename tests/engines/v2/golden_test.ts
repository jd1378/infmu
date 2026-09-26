// v2 is frozen: these fingerprints were taken when v2 was released. If one changes, a seed someone shared now
// plays something else. Don't update them; put the change in a new engine version instead.

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
  'score:amber-quiet-harbor:0': 'e382a876',
  'score:amber-quiet-harbor:3': 'ffeb02f5',
  'score:amber-quiet-harbor:11': '76811b63',
  'score:amber-quiet-harbor:26': 'b6f4cfb5',
  'audio:amber-quiet-harbor:1': '4ce23a335fb9a411',
  'audio:amber-quiet-harbor:7': 'a93bf31a8f2fb1c7',
  'plan:hello': '33aabdb8',
  'score:hello:0': '28b7d62d',
  'score:hello:3': '17d9e5ad',
  'score:hello:11': '3691288c',
  'score:hello:26': '15c57156',
  'audio:hello:1': 'b0faa985489d756c',
  'audio:hello:7': '2cf868a8eb96fccf',
  'plan:golden': '60b36f9d',
  'score:golden:0': '5f4704ef',
  'score:golden:3': 'f00ea070',
  'score:golden:11': '78435331',
  'score:golden:26': '98391846',
  'audio:golden:1': 'd12093e6b3535729',
  'audio:golden:7': '3842860f8a722cce',
  'plan:golden-short': 'e319281b',
  'score:golden-short:0': 'd2429a1e',
  'score:golden-short:3': '5f174110',
  'score:golden-short:11': 'b7cf2af4',
  'score:golden-short:26': 'a311bdb0',
  'audio:golden-short:1': '24b37bbea2d7b73f',
  'audio:golden-short:7': 'bb8f4e1b1edfdd1',
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
