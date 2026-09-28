// A wind player's phrasing and breathing (synth/voice.ts): where breaths go, and what a line sounds like at its joins,
// its phrase ends and its rests.

import { assert, assertEquals } from '@std/assert';
import { Bus } from '../../../src/engines/v2/synth/bus.ts';
import { lungs, type Phrasing, wind } from '../../../src/engines/v2/synth/voice.ts';
import type { Note, Tone } from '../../../src/engines/v2/types.ts';

const SR = 48000;
const TONE: Tone = { bright: 1, detune: 1, fmRatio: 2, vibrato: 1, crackle: 0, wow: 0 };
const F: Phrasing = { join: [5, 12, 0.07, 8, 0.09], slide: 0.03, tail: [0.15, 20], lungs: [12, -40] };
/** Joined notes from `t`, each `d` long, climbing a scale. */
const run = (t: number, count: number, d: number, v = 0.7): Note[] =>
  Array.from({ length: count }, (_, j) => ({ t: t + j * d, d, n: 62 + (j % 5), v }));

Deno.test('a player breathes before a line and in its phrase breaks, just before the next note', () => {
  const line = [...run(0.5, 4, 0.25), ...run(1.7, 2, 0.25), ...run(2.8, 3, 0.25), ...run(3.6, 2, 0.25)];
  const { breaths, line: played } = lungs(line, F);
  // before the first note (0.5 s of room) and in the 0.6 s break; not in the 0.2 s rest after a second of playing,
  // nor in the 0.05 s one
  assertEquals(breaths.length, 2);
  assert(Math.abs(breaths[0].t - 0.46) < 1e-9 && breaths[0].d > 0.1);
  assert(breaths[1].t < 2.8 && breaths[1].t - breaths[1].d >= 2.2);
  assertEquals(played, line);
});

Deno.test('once a fifth of the breath is spent, a short rest is enough to breathe in', () => {
  // 3 s of playing (a quarter of the lungs), a 0.2 s rest, more
  const line = [...run(0, 12, 0.25), ...run(3.2, 4, 0.25)];
  const { breaths } = lungs(line, F);
  assertEquals(breaths.length, 1);
  assert(breaths[0].t < 3.2 && breaths[0].t - breaths[0].d >= 3 && breaths[0].need > 0.2);
});

Deno.test('a line that outlasts a breath gets one snatched: a long enough note is cut short for it', () => {
  // 16 s of joined half-second notes at mf, no rest: the lungs hold 12
  const line = run(0, 32, 0.5);
  const { breaths, line: played } = lungs(line, F);
  const snatched = breaths.filter((x) => x.need === 1);
  assert(snatched.length >= 1);
  const cut = played.findIndex((n, j) => n.d !== line[j].d);
  assert(cut > 0 && played[cut].d < line[cut].d && played[cut].d >= 0.3);
  // the breath fills the gap the cut made, and every note still starts on time
  assert(snatched[0].t <= played[cut + 1].t);
  assert(snatched[0].t - snatched[0].d >= played[cut].t + played[cut].d - 1e-9);
  assert(played.every((n, j) => n.t === line[j].t));
});

const render = (ns: Note[], seconds: number) => {
  const b = new Bus(SR, seconds, 7, TONE);
  wind(b, { i: 'wind', t: ns[0].t, k: 'sax', ns });
  const x = b.ML.map((v, i) => v + b.MR[i]);
  return (a: number, z: number) => {
    let s = 0;
    for (let i = Math.round(a * SR); i < Math.round(z * SR); i++) s += x[i] * x[i];
    return 10 * Math.log10(s / ((z - a) * SR) + 1e-20);
  };
};

Deno.test("a sax phrase's last note holds to its end, then its breath falls away rather than stopping", () => {
  const rms = render(run(0.5, 4, 0.3, 0.8), 3);
  const held = rms(1.5, 1.55);
  assert(rms(1.65, 1.7) > held - 3, 'held to its end');
  const after = rms(1.8, 1.85);
  assert(after < held - 4 && after > held - 25, `falling away: ${after - held} dB`);
});

Deno.test('a sax player breathes in before a phrase: a faint hiss, far under the playing', () => {
  const rms = render([{ t: 0.7, d: 0.6, n: 62, v: 0.7 }], 2);
  const inhale = rms(0.35, 0.6);
  const note = rms(0.9, 1.2);
  assert(inhale > note - 55 && inhale < note - 30, `inhale ${inhale - note} dB`);
  assert(rms(0, 0.1) < note - 90, 'silence before it');
});

Deno.test('a sax changes notes under a breath that keeps going: the tone dims at each join, never stops', () => {
  // short slurred steps, and a repeated note (which the tongue marks)
  const line: Note[] = [62, 64, 65, 65, 67].map((n, j) => ({ t: 0.5 + 0.2 * j, d: 0.2, n, v: 0.8 }));
  const rms = render(line, 2.5);
  for (const [t, marked] of [[0.7, false], [0.9, false], [1.1, true], [1.3, false]] as const) {
    const around = Math.min(rms(t - 0.1, t - 0.05), rms(t + 0.06, t + 0.11));
    const dip = around - rms(t - 0.01, t + 0.01);
    assert(dip > 1.5 && dip < (marked ? 20 : 12), `join at ${t}: ${dip.toFixed(1)} dB`);
  }
});
