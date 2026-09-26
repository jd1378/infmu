// The acoustic kit: measurable properties of real drums it was fitted to (out/research/proposals/sound-drums.md).

import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { Bus } from '../../../src/engines/v2/synth/bus.ts';
import { SVF } from '../../../src/engines/v2/synth/dsp.ts';
import { kick, snare, tom } from '../../../src/engines/v2/synth/instruments.ts';
import { perc } from '../../../src/engines/v2/synth/modal.ts';
import type { Ev, Tone } from '../../../src/engines/v2/types.ts';

const SR = 44100;
const TONE: Tone = { bright: 1, detune: 1, fmRatio: 2, vibrato: 1, crackle: 0, wow: 0 };
type Hit = Extract<Ev, { i: 'kick' | 'snare' | 'tom' | 'perc' }>;

/** One stroke, dry, as the mono sum of the bus. */
function render(e: Hit, sec = 2, sr = SR): Float32Array {
  const b = new Bus(sr, sec, 7, TONE);
  if (e.i === 'kick') kick(b, e);
  else if (e.i === 'snare') snare(b, e);
  else if (e.i === 'tom') tom(b, e);
  else perc(b, e);
  return b.L.map((l, i) => l + b.R[i]);
}

const KINDS: Hit[] = [
  { i: 'kick', t: 0, v: 1, k: 'acoustic', sc: 0.4, n: 33 },
  { i: 'snare', t: 0, v: 1, k: 'acoustic' },
  { i: 'tom', t: 0, v: 1, n: 40, k: 'acoustic' },
  { i: 'tom', t: 0, v: 1, n: 52, k: 'acoustic' },
  { i: 'perc', t: 0, v: 1, k: 'acousticRide' },
  { i: 'perc', t: 0, v: 1, k: 'acousticCrash' },
];

/** The share of the signal's power in its sample-to-sample differences (as v2_test measures brightness). */
function bright(x: Float32Array): number {
  let d = 0;
  let p = 0;
  for (let i = 1; i < x.length; i++) {
    d += (x[i] - x[i - 1]) ** 2;
    p += x[i] ** 2;
  }
  return d / p;
}

/** Level in dB of the 10 ms around `t` seconds. */
function level(x: Float32Array, t: number, sr = SR): number {
  const i0 = Math.round((t - 0.005) * sr);
  let p = 0;
  for (let i = Math.max(0, i0); i < i0 + 0.01 * sr; i++) p += x[i] ** 2;
  return 10 * Math.log10(p / (0.01 * sr) + 1e-30);
}

/** T60 from the level's slope between two times (s). */
const t60 = (x: Float32Array, a: number, b: number) => (-60 * (b - a)) / (level(x, b) - level(x, a));

/** The signal through a band-pass (two in series) around `fc` Hz. */
function band(x: Float32Array, fc: number, q = 1.5): Float32Array {
  const f1 = new SVF(SR, fc, q);
  const f2 = new SVF(SR, fc, q);
  return x.map((v) => (f1.run(v), f2.run(f1.bp), f2.bp));
}

/** Pitch (Hz) of a band-limited signal over [a, b] s, from its zero crossings (half periods). */
function pitch(x: Float32Array, a: number, b: number): number {
  const z: number[] = [];
  for (let i = Math.round(a * SR); i < b * SR; i++) {
    if (x[i - 1] < 0 !== x[i] < 0) z.push(i - 1 + x[i - 1] / (x[i - 1] - x[i]));
  }
  return ((z.length - 1) * SR) / (2 * (z[z.length - 1] - z[0]));
}

Deno.test('the acoustic kit renders finite, bounded audio at every velocity layer and sample rate', () => {
  for (const e of KINDS) {
    for (const sr of [16000, 44100, 48000]) {
      for (const [v, take] of [[1, undefined], [1, 0], [0.6, 1], [0.3, 2], [0.1, 3]] as const) {
        const x = render({ ...e, v, take }, 2, sr);
        let peak = 0;
        for (const s of x) {
          assert(Number.isFinite(s), `${JSON.stringify(e)} at ${sr} Hz`);
          peak = Math.max(peak, Math.abs(s));
        }
        assert(peak > 0.002 * v && peak < 4, `${JSON.stringify(e)} v ${v}: peak ${peak.toFixed(3)}`);
      }
    }
  }
});

Deno.test('takes of an acoustic stroke differ, a take is the same every time', () => {
  for (const e of KINDS) {
    assertEquals(render({ ...e, take: 2 }, 0.5), render({ ...e, take: 2 }, 0.5));
    assertNotEquals(render({ ...e, take: 1 }, 0.5), render({ ...e, take: 2 }, 0.5));
  }
});

Deno.test('a softer stroke on a kick, a tom or a cymbal is darker', () => {
  for (const e of KINDS.filter((e) => e.i !== 'snare')) {
    const soft = bright(render({ ...e, v: 0.3, take: 0 }));
    const hard = bright(render({ ...e, v: 1, take: 0 }));
    assert(soft < hard * 0.8, `${JSON.stringify(e)}: soft ${soft.toExponential(2)}, hard ${hard.toExponential(2)}`);
  }
});

Deno.test('a ghost note on the snare is a quieter backbeat with more wire and stick in it: thinner, no longer', () => {
  // the share of the power over 2 kHz: the wires and the stick
  const wires = (x: Float32Array) => {
    const hp = new SVF(SR, 2000, 0.7);
    let h = 0;
    let p = 0;
    for (const s of x) {
      hp.run(s);
      h += hp.hp ** 2;
      p += s ** 2;
    }
    return h / p;
  };
  // how long until the stroke is 40 dB under its loudest 10 ms
  const length = (x: Float32Array) => {
    let top = -Infinity;
    for (let t = 0.005; t < 0.1; t += 0.001) top = Math.max(top, level(x, t));
    let t = 0.01;
    while (level(x, t) > top - 40 && t < 1.5) t += 0.005;
    return t;
  };
  const ghost = render({ i: 'snare', t: 0, v: 0.3, k: 'acoustic', take: 0 }, 0.5);
  const back = render({ i: 'snare', t: 0, v: 1, k: 'acoustic', take: 0 }, 0.5);
  // measured (Big Rusty Drums, VCSL): a ghost note has 1.4-2.3 times a backbeat's share over 2 kHz, and in its
  // own terms it lasts as long (it sounds short because it is 20-25 dB quieter)
  const r = wires(ghost) / wires(back);
  assert(r > 1.25 && r < 3, `wire share: ghost ${wires(ghost).toFixed(3)}, backbeat ${wires(back).toFixed(3)}`);
  assert(
    length(ghost) <= length(back) + 0.01,
    `ghost ${length(ghost).toFixed(3)} s, backbeat ${length(back).toFixed(3)} s`,
  );
});

Deno.test("the snare's wires swell in after the crack", () => {
  const x = render({ i: 'snare', t: 0, v: 1, k: 'acoustic', take: 0 });
  const wires = band(x, 5000, 0.7);
  let at = 0;
  for (let t = 0.002; t < 0.2; t += 0.001) if (level(wires, t) > level(wires, at)) at = t;
  // measured: 26-57 ms on three real snares; the head peaks within a few ms
  assert(at > 0.012 && at < 0.07, `wires peak at ${(at * 1000).toFixed(0)} ms`);
});

Deno.test('the acoustic kick sits on its note, sags onto it after a hard stroke, and rings like a damped kick', () => {
  const n = 33; // A1, 55 Hz
  const hard = band(render({ i: 'kick', t: 0, v: 1, k: 'acoustic', sc: 0, n, take: 0 }), 60, 0.7);
  const soft = band(render({ i: 'kick', t: 0, v: 0.3, k: 'acoustic', sc: 0, n, take: 0 }), 60, 0.7);
  const settled = pitch(hard, 0.15, 0.4);
  assert(Math.abs(settled / 55 - 1) < 0.03, `settles on ${settled.toFixed(1)} Hz`);
  // the records' kicks sound 18-82% above their pitch in the first 30 ms; a ghost stroke barely sags
  const glide = pitch(hard, 0.002, 0.04) / settled - 1;
  const ghost = pitch(soft, 0.002, 0.04) / pitch(soft, 0.15, 0.4) - 1;
  assert(glide > 0.12 && glide < 0.6, `glide ${(glide * 100).toFixed(0)}%`);
  assert(ghost < glide / 3, `ghost glide ${(ghost * 100).toFixed(0)}%`);
  // a kick drum with a pillow in it: T60 0.15-0.7 s close and overhead
  const t = t60(hard, 0.1, 0.35);
  assert(t > 0.15 && t < 0.7, `T60 ${t.toFixed(2)} s`);
});

Deno.test('a tom rings on its pitch for about a second, lower toms longer, and sags onto it', () => {
  const ring = (n: number) => {
    const f = 440 * 2 ** ((n - 69) / 12);
    const x = band(render({ i: 'tom', t: 0, v: 1, n, k: 'acoustic', take: 0 }, 2.5), f, 1);
    const settled = pitch(x, 0.3, 0.8);
    assert(Math.abs(settled / f - 1) < 0.02, `tom ${n} settles on ${settled.toFixed(1)} Hz, not ${f.toFixed(1)}`);
    const glide = pitch(x, 0.002, 0.03) / settled - 1;
    // measured 4-30% on hard strokes
    assert(glide > 0.03 && glide < 0.3, `tom ${n} glide ${(glide * 100).toFixed(0)}%`);
    return t60(x, 0.2, 0.9);
  };
  const floor = ring(40);
  const rack = ring(52);
  // measured 0.8-1.9 s on undamped toms
  assert(
    floor > 0.8 && floor < 2.2 && rack > 0.7 && rack < 2,
    `T60 floor ${floor.toFixed(2)}, rack ${rack.toFixed(2)}`,
  );
  assert(floor > rack, 'the floor tom rings longer');
});

Deno.test('a cymbal is loudest at the strike, rings for seconds, and loses its highs first', () => {
  for (const k of ['acousticCrash', 'acousticRide'] as const) {
    const x = render({ i: 'perc', t: 0, v: 1, k, take: 0 }, 5);
    let at = 0;
    for (let t = 0.005; t < 1; t += 0.005) if (level(x, t) > level(x, at)) at = t;
    assert(at < 0.01, `${k} peaks at ${(at * 1000).toFixed(0)} ms`);
    // real crash and ride overheads: 22-35 dB down after 2 s
    const down = level(x, 0.005) - level(x, 2);
    assert(down > 15 && down < 40, `${k} is ${down.toFixed(0)} dB down after 2 s`);
    const mid = band(x, 3500, 1.2);
    const top = band(x, 10000, 1.2);
    assert(t60(top, 0.3, 1.5) < t60(mid, 0.3, 1.5), `${k}: the top outlasts the middle`);
  }
});
