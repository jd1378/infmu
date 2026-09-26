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
  'plan:amber-quiet-harbor': 'b3bfb418',
  'score:amber-quiet-harbor:0': 'fe717552',
  'score:amber-quiet-harbor:3': 'e3c54a76',
  'score:amber-quiet-harbor:11': '91e7684a',
  'score:amber-quiet-harbor:26': '38ff8ab2',
  'audio:amber-quiet-harbor:1': 'e970758865110d64',
  'audio:amber-quiet-harbor:7': '1af382e9aed4f7cf',
  'plan:hello': 'd48a61c8',
  'score:hello:0': '68dc3a65',
  'score:hello:3': '424dd4a2',
  'score:hello:11': '615e4e94',
  'score:hello:26': '4520e16d',
  'audio:hello:1': '48acdf45391899aa',
  'audio:hello:7': 'bf71c39d65a925ce',
  'plan:golden': '8f0a0a8a',
  'score:golden:0': 'd6ce3026',
  'score:golden:3': '4c69dcb8',
  'score:golden:11': '6f6fe6e',
  'score:golden:26': '76c604ee',
  'audio:golden:1': '5f79de1f73a07a1',
  'audio:golden:7': 'aef361a7e782a',
  'plan:golden-short': '35a814c2',
  'score:golden-short:0': 'fac8295',
  'score:golden-short:3': '749ef70a',
  'score:golden-short:11': 'bf8a8245',
  'score:golden-short:26': 'd2a0d16a',
  'audio:golden-short:1': '8318decaa5b5cc48',
  'audio:golden-short:7': '8f6f3a7adae99cf7',
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
