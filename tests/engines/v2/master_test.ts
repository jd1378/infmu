// Post-rock's mix buses and master (a rock record's): measurable properties of the chain fitted to the references
// (out/research/proposals/sound-master.md).

import { assert, assertEquals } from '@std/assert';
import { composeSection } from '../../../src/engines/v2/compose/index.ts';
import { Song } from '../../../src/engines/v2/plan.ts';
import { STYLE_IDS, STYLES } from '../../../src/engines/v2/styles.ts';
import { Bus } from '../../../src/engines/v2/synth/bus.ts';
import { clipper, type Comp, compress, lufs, Noise, oversampled } from '../../../src/engines/v2/synth/dsp.ts';
import { kick, snare } from '../../../src/engines/v2/synth/instruments.ts';
import { perc } from '../../../src/engines/v2/synth/modal.ts';
import { drumBus, GLUE, renderScore, targetLufs } from '../../../src/engines/v2/synth/render.ts';
import type { Score, Tone } from '../../../src/engines/v2/types.ts';

const SR = 48000;
const TONE: Tone = { bright: 1, detune: 1, fmRatio: 2, vibrato: 1, crackle: 0, wow: 0 };
const db = (x: number) => 20 * Math.log10(x);
const median = (a: ArrayLike<number>) => Array.from(a).sort((x, y) => x - y)[Math.floor(a.length / 2)];
/** Median gain (dB) of a gain curve over [a, b) seconds. */
const gainAt = (g: Float32Array, a: number, b: number, sr = SR) =>
  db(median(g.subarray(Math.round(a * sr), Math.round(b * sr))));
const sine = (seconds: number, rmsDb: number, hz = 1000, sr = SR) =>
  Float32Array.from(
    { length: Math.round(seconds * sr) },
    (_, i) => Math.SQRT2 * 10 ** (rmsDb / 20) * Math.sin((2 * Math.PI * hz * i) / sr),
  );
const peakDb = (l: Float32Array, r: Float32Array, a = 0, b = l.length) => {
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(l[i]), Math.abs(r[i]));
  return db(m);
};

const COMP: Comp = { threshold: -20, rms: 0.005, ratio: 3, knee: 6, attack: 0.01, release: 0.12, slow: 1.2, hp: 0 };

Deno.test('the compressor follows its soft-knee curve and leaves what stays under it untouched', () => {
  const at = (level: number) => {
    const x = sine(2, level);
    return gainAt(compress(SR, x, x, COMP), 1.5, 2);
  };
  // 12 dB over at 3:1: 8 dB down; at the threshold, half the knee in: slope * knee / 8
  assert(Math.abs(at(-8) + 8) < 0.3, `12 dB over: ${at(-8).toFixed(2)} dB`);
  assert(Math.abs(at(-20) + 0.5) < 0.2, `at the threshold: ${at(-20).toFixed(2)} dB`);
  const quiet = sine(2, -30);
  assert(compress(SR, quiet, quiet, COMP).every((g) => g === 1), 'under the knee the gain is exactly 1');
});

Deno.test('its release is program-dependent: quick after a hit, slow after a long loud passage', () => {
  /**
   * Seconds for the gain to come back within 0.5 dB after a burst of `burst` s, 12 dB over, on a quiet floor (3 s in:
   * past what the compressor looks at to wind itself up before a section starts).
   */
  const recovery = (burst: number) => {
    const n = Math.round((burst + 8) * SR);
    const x = sine(burst + 8, -40);
    const loud = sine(burst, -8);
    for (let i = 0; i < loud.length; i++) x[3 * SR + i] = loud[i];
    const g = compress(SR, x, x, COMP);
    const end = Math.round((3 + burst) * SR);
    for (let i = end; i < n; i++) if (db(g[i]) > -0.5) return (i - end) / SR;
    return Infinity;
  };
  const short = recovery(0.03);
  const long = recovery(3);
  assert(short < 0.45, `after a 30 ms hit: ${short.toFixed(2)} s`);
  assert(long > 1.5, `after 3 s: ${long.toFixed(2)} s`);
});

Deno.test('a section that starts loud starts compressed: its first hit meets it as a later one does', () => {
  // a wall with a hit on every beat, loud from the first sample
  const noise = new Noise(9);
  const n = 4 * SR;
  const beat = 0.5 * SR;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * noise.next() * (1 + 2 * Math.exp(-(i % beat) / SR / 0.03));
  const g = compress(SR, x, x, COMP);
  // from rest (2 s of silence before it): what an unwound compressor does at the same start
  const pad = new Float32Array(2 * SR + n);
  pad.set(x, 2 * SR);
  const rest = compress(SR, pad, pad, COMP).subarray(2 * SR);
  /** The largest difference (dB) between a gain curve's first beat and the fifth. */
  const off = (c: Float32Array) => {
    let m = 0;
    for (let i = 0; i < beat; i++) m = Math.max(m, Math.abs(db(c[i]) - db(g[i + 4 * beat])));
    return m;
  };
  assert(gainAt(g, 2, 4) < -5, `the wall is compressed: ${gainAt(g, 2, 4).toFixed(1)} dB`);
  assert(off(g) < 1, `first beat off by ${off(g).toFixed(1)} dB`);
  assert(off(rest) > 3, `unwound, it would let the start through and duck in (${off(rest).toFixed(1)} dB)`);
});

Deno.test('the tape passes what is under its knee, bends above it and never passes its ceiling', () => {
  const f = clipper(0.5, 0.9);
  for (const x of [0, 0.1, -0.3, 0.5, -0.5]) assertEquals(f(x), x);
  let last = 0;
  for (let x = 0.5; x < 20; x += 0.01) {
    const y = f(x);
    assert(y >= last && y <= 0.9 && f(-x) === -y);
    last = y;
  }
  // slope 1 at the knee: no corner
  assert(Math.abs((f(0.5001) - f(0.5)) / 0.0001 - 1) < 0.01);
  // at twice the rate and on time: a band-limited burst through a straight line comes out as it went in
  const x = Float32Array.from(
    { length: 4800 },
    (_, i) => Math.sin((2 * Math.PI * 2000 * i) / SR) * Math.sin((Math.PI * i) / 4800) ** 2,
  );
  const y = oversampled(x, (v) => v, 1, new Float32Array(x.length));
  assert(x.every((v, i) => Math.abs(v - y[i]) < 0.01), 'the oversampler is transparent and its latency taken out');
  const z = oversampled(x, f, 3, new Float32Array(x.length));
  assert(z.every((v) => Math.abs(v) < 0.9 * 1.03));
});

/** Four bars of a post-rock climax's drums at 120 bpm: kick, snare backbeats and a crash ridden in eighths. */
function kit(sr: number): Bus {
  const b = new Bus(sr, 8.5, 11, TONE);
  for (let q = 0; q < 16; q++) {
    const t = q * 0.5;
    if (q % 2 === 0) kick(b, { i: 'kick', t, v: 0.9, k: 'acoustic', sc: 0, n: 33, take: q % 4 });
    if (q % 2 === 1) snare(b, { i: 'snare', t, v: 1, k: 'acoustic', take: q % 4 });
    for (const e of [0, 0.25]) perc(b, { i: 'perc', t: t + e, v: e ? 0.5 : 0.8, k: 'acousticCrash', take: q % 4 });
  }
  return b;
}

Deno.test('the drum bus and its crushed copy make the kit denser: hits lower, their tails fuller', () => {
  const sr = 32000;
  const b = kit(sr);
  const [l0, r0] = [b.L.slice(), b.R.slice()];
  drumBus(b);
  const crest = (l: Float32Array, r: Float32Array) => peakDb(l, r) - lufs(sr, l, r);
  const before = crest(l0, r0);
  const after = crest(b.L, b.R);
  assert(before - after > 1, `peak over loudness ${before.toFixed(1)} -> ${after.toFixed(1)} dB`);
  // each backbeat against the kit 200 ms later, before and after
  const lvl = (l: Float32Array, t: number) => {
    let s = 0;
    const a = Math.round(t * sr);
    for (let i = a; i < a + 0.01 * sr; i++) s += l[i] * l[i];
    return 10 * Math.log10(s + 1e-30);
  };
  const lift: number[] = [];
  for (let q = 1; q < 16; q += 2) {
    const t = q * 0.5;
    lift.push(lvl(b.L, t + 0.2) - lvl(b.L, t) - (lvl(l0, t + 0.2) - lvl(l0, t)));
  }
  assert(median(lift) > 2, `tails lifted ${median(lift).toFixed(1)} dB against their hits`);
  assert(b.L.every(Number.isFinite) && peakDb(b.L, b.R) < peakDb(l0, r0) + 6);
});

Deno.test('the glue holds a climax a few dB down and breathes with the hits; a quiet part passes under it', () => {
  // pink-ish noise with a hit every beat, at a climax's loudness and at a quiet part's
  const noise = new Noise(3);
  const n = 6 * SR;
  const wall = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    p = 0.97 * p + 0.03 * noise.next();
    const u = (i % (0.5 * SR)) / SR;
    wall[i] = p * (1 + 1.5 * Math.exp(-u / 0.04));
  }
  const peak = STYLES.ember.dynamics[0];
  const own = lufs(SR, wall, wall);
  const at = (loudness: number) => {
    const x = wall.map((v) => v * 10 ** ((loudness - own) / 20));
    return compress(SR, x, x, { ...GLUE, threshold: peak + GLUE.threshold });
  };
  const g = at(peak);
  const mean = db(g.subarray(SR).reduce((s, v) => s + v, 0) / (n - SR));
  assert(mean < -2 && mean > -6, `climax: ${mean.toFixed(1)} dB`);
  // on the hits against between them
  const hits = [];
  const between = [];
  for (let q = 2; q < 12; q++) {
    hits.push(gainAt(g, q * 0.5 + 0.02, q * 0.5 + 0.06));
    between.push(gainAt(g, q * 0.5 + 0.35, q * 0.5 + 0.45));
  }
  const breath = median(between) - median(hits);
  assert(breath > 0.5 && breath < 4, `breathing ${breath.toFixed(1)} dB`);
  const quiet = at(targetLufs(new Song('m', ['ember']).movement(0).mix, 0.15));
  assert(quiet.every((v) => v > 0.99), 'a quiet part passes untouched');
});

/** A short post-rock piece's climax (its first 12 s) and quiet opening, and a way to hear one on the old master. */
function sections(): { climax: Score; intro: Score; old: (s: Score) => Score } {
  const song = new Song('master', ['ember'], 'short');
  const mv = song.movement(0);
  const at = (k: number) => {
    const s = composeSection(song, mv.firstSection + k);
    return { ...s, duration: Math.min(s.duration, 12) };
  };
  const top = mv.sections.reduce((b, s, k) => (s.energy > mv.sections[b].energy ? k : b), 0);
  const old = (s: Score) => ({
    ...s,
    movement: { ...s.movement, mix: { ...s.movement.mix, bus: undefined, peak: -10, range: 18 } },
  });
  return { climax: at(top), intro: at(0), old };
}

Deno.test('a climax is mastered as loud and dense as the references, under the ceiling', () => {
  const { climax, old } = sections();
  const sr = 16000;
  const end = Math.round(climax.duration * sr);
  /** Median over 3 s windows of the window's peak over its loudness (PSR). */
  const psr = (l: Float32Array, r: Float32Array) => {
    const out = [];
    for (let i = 0; i + 3 * sr <= end; i += sr) {
      const a = l.subarray(i, i + 3 * sr);
      const b = r.subarray(i, i + 3 * sr);
      out.push(peakDb(a, b) - lufs(sr, a, b));
    }
    return median(out);
  };
  const now = renderScore(climax, sr);
  const was = renderScore(old(climax), sr);
  const target = targetLufs(climax.movement.mix, climax.section.energy);
  const loud = lufs(sr, now.left, now.right, end);
  assert(Math.abs(loud - target) < 0.3, `${loud.toFixed(1)} LUFS for ${target.toFixed(1)}`);
  assert(loud - lufs(sr, was.left, was.right, end) > 3, 'louder than the old master');
  // the loud references: PSR 5.8-6.1 dB; the old master about 10
  const [p, q] = [psr(now.left, now.right), psr(was.left, was.right)];
  assert(p > 4.5 && p < 7.5 && q - p > 2.5, `PSR ${p.toFixed(1)} dB (old ${q.toFixed(1)})`);
  assert(peakDb(now.left, now.right) < -1.45, 'under the -1.5 dBFS ceiling (the noise floor goes on after it)');
});

Deno.test('the quiet parts keep their loudness: an opening renders as it did on the old master', () => {
  const { intro, old } = sections();
  const sr = 16000;
  const end = Math.round(intro.duration * sr);
  const now = renderScore(intro, sr);
  const was = renderScore(old(intro), sr);
  const [a, b] = [lufs(sr, now.left, now.right, end), lufs(sr, was.left, was.right, end)];
  assert(Math.abs(a - b) < 0.3, `${a.toFixed(2)} against ${b.toFixed(2)} LUFS`);
  // nothing pumps or bends it: the same waveform, to within a small gain
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < end; i++) {
    xy += now.left[i] * was.left[i];
    xx += now.left[i] ** 2;
    yy += was.left[i] ** 2;
  }
  assert(xy / Math.sqrt(xx * yy) > 0.999);
});

Deno.test('only post-rock is mixed as a rock record; every other style keeps its master and its loudness', () => {
  const released: Record<string, readonly [number, number]> = {
    drift: [-16, 12],
    haze: [-13, 8],
    pulse: [-11, 10],
    rise: [-10, 12],
    cathedral: [-10, 18],
    acid: [-10, 10],
    garden: [-13, 9],
    nocturne: [-16, 14],
  };
  for (const id of STYLE_IDS) {
    if (id === 'ember') {
      assertEquals(STYLES[id].record.bus, 'rock');
      continue;
    }
    assertEquals(STYLES[id].record.bus, undefined);
    assertEquals(STYLES[id].dynamics, released[id]);
  }
  assertEquals(new Song('rock', ['ember']).movement(0).mix.bus, 'rock');
});
