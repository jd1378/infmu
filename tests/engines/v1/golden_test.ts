// v1 is frozen: these fingerprints were taken from the deployed build before versions existed
// (commit 791e586). If one changes, a seed someone shared now plays something else. Don't update them;
// put the change in a new engine version instead.
// One deliberate exception: the hit or bell on each movement's first beat was removed (it jumped out of every
// quiet intro). That changed only the scores of movement openings (three entries below); every other note,
// every plan and every rendered fingerprint here is still what was deployed.

import { assertEquals } from '@std/assert';
import { composeSection } from '../../../src/engines/v1/compose/index.ts';
import { Song } from '../../../src/engines/v1/plan.ts';
import { renderScore } from '../../../src/engines/v1/synth/render.ts';
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
  'plan:amber-quiet-harbor': '2e72aea',
  'score:amber-quiet-harbor:0': '89c30a28',
  'score:amber-quiet-harbor:3': 'f35faa78',
  'score:amber-quiet-harbor:11': 'a7a885c9',
  'score:amber-quiet-harbor:26': '70982069',
  'audio:amber-quiet-harbor:1': '5452f53118caad5a',
  'audio:amber-quiet-harbor:7': '2feecfa518951791',
  'plan:hello': '3a277edf',
  'score:hello:0': '795b7631',
  'score:hello:3': '2ec9ca8c',
  'score:hello:11': '204628fc',
  'score:hello:26': 'cfe1c96a',
  'audio:hello:1': '46b4878766ef389e',
  'audio:hello:7': '9b512aaec6ab34b6',
  'plan:golden': 'ac3fad1e',
  'score:golden:0': 'a55b8cd6',
  'score:golden:3': '4b1c1603',
  'score:golden:11': 'b44cdfc4',
  'score:golden:26': '62c4b052',
  'audio:golden:1': '949c113d9208ea89',
  'audio:golden:7': '6c2cc4db6b0a29f',
};

const SEEDS: [string, ('haze' | 'drift')[] | undefined][] = [
  ['amber-quiet-harbor', undefined],
  ['hello', undefined],
  ['golden', ['haze', 'drift']],
];

Deno.test('v1 plans, scores and audio are exactly what was deployed', () => {
  const got: Record<string, string> = {};
  for (const [seed, styles] of SEEDS) {
    const song = new Song(seed, styles);
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

Deno.test('the v1 engine port plays the frozen internals, untouched', () => {
  const e = engine(1);
  for (const [seed, styles] of SEEDS) {
    const r = e.render(e.song(seed, styles), 7, 16000);
    assertEquals(pcm(r.left) + pcm(r.right), GOLDEN[`audio:${seed}:7`]);
  }
});
