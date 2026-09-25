import { assert, assertAlmostEquals, assertEquals } from '@std/assert';
import { composeSection } from '../../../src/engines/v1/compose/index.ts';
import { Song } from '../../../src/engines/v1/plan.ts';
import { lufs } from '../../../src/engines/v1/synth/dsp.ts';
import { renderScore } from '../../../src/engines/v1/synth/render.ts';
import { renderSpan } from '../../../src/engines/v1/synth/span.ts';

// low sample rate keeps these fast; the DSP is rate-independent
const SR = 16000;
const peakDb = (l: Float32Array, r: Float32Array) => {
  let p = 0;
  for (let i = 0; i < l.length; i++) p = Math.max(p, Math.abs(l[i]), Math.abs(r[i]));
  return 20 * Math.log10(p);
};

Deno.test('rendering is deterministic to the bit', () => {
  const s = composeSection(new Song('bits'), 3);
  const a = renderScore(s, SR);
  const b = renderScore(s, SR);
  assertEquals(a.left, b.left);
  assertEquals(a.right, b.right);
});

Deno.test('sections render finite audio under the ceiling, with room for the tail', () => {
  const song = new Song('ceiling');
  for (let i = 0; i < 12; i++) {
    const s = composeSection(song, i);
    const r = renderScore(s, SR);
    assertEquals(r.left.length, Math.round((s.duration + s.tail) * SR));
    assert(r.left.every(Number.isFinite) && r.right.every(Number.isFinite), `non-finite samples in #${i}`);
    assert(peakDb(r.left, r.right) <= -1.4, `#${i} peaks at ${peakDb(r.left, r.right).toFixed(2)} dBFS`);
    // the tail fades to silence so the cut at its end can't click
    assertEquals(r.left[r.left.length - 1], 0);
  }
});

Deno.test('a stitched span stays under -1 dBFS where tails overlap', () => {
  const song = new Song('span');
  const r = renderSpan(song, 2, 4, SR);
  assert(peakDb(r.left, r.right) <= -0.99, `peak ${peakDb(r.left, r.right)}`);
});

Deno.test('loudness meter reads a 1 kHz sine like BS.1770 says it should', () => {
  // a -20 dBFS 1 kHz sine in both channels measures about -20 LUFS
  const sr = 48000;
  const l = Float32Array.from({ length: sr * 3 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sr));
  assertAlmostEquals(lufs(sr, l, l), -20, 0.5);
  assertEquals(lufs(sr, new Float32Array(sr), new Float32Array(sr)), -Infinity);
});
