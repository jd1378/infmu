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
  'plan:amber-quiet-harbor': '444a7eca',
  'score:amber-quiet-harbor:0': '3c68c633',
  'score:amber-quiet-harbor:3': 'd64889b',
  'score:amber-quiet-harbor:11': '6a06b044',
  'score:amber-quiet-harbor:26': '6ed890ab',
  'audio:amber-quiet-harbor:1': '1eb11779ba265fbf',
  'audio:amber-quiet-harbor:7': '13ac2de34cb639b0',
  'plan:hello': 'a2bb8a9d',
  'score:hello:0': '563f6da7',
  'score:hello:3': 'dc9949b7',
  'score:hello:11': '1a4ad3c2',
  'score:hello:26': 'c905e183',
  'audio:hello:1': '5f9f6ba6f4fbc563',
  'audio:hello:7': 'fff84be46e7f5840',
  'plan:golden': '40971175',
  'score:golden:0': '603fb050',
  'score:golden:3': 'e5c92fee',
  'score:golden:11': 'a095ebc2',
  'score:golden:26': 'af2e1263',
  'audio:golden:1': '2e2b190262f43938',
  'audio:golden:7': '72b997d876d256a9',
  'plan:golden-short': '9f2c54c9',
  'score:golden-short:0': '3f7a6e1e',
  'score:golden-short:3': 'd43426e4',
  'score:golden-short:11': 'cc44b2f3',
  'score:golden-short:26': '882a67b8',
  'audio:golden-short:1': 'b45a9e0ee699e5b0',
  'audio:golden-short:7': 'c02e8b539e812ffb',
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
