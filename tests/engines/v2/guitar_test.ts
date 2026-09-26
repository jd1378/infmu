import { assert, assertEquals } from '@std/assert';
import { composeSection } from '../../../src/engines/v2/compose/index.ts';
import { Song } from '../../../src/engines/v2/plan.ts';
import { STYLE_IDS, STYLES } from '../../../src/engines/v2/styles.ts';
import { Bus } from '../../../src/engines/v2/synth/bus.ts';
import { Chain, Chorus, freeverb, hall, SVF } from '../../../src/engines/v2/synth/dsp.ts';
import {
  GREENBACK_4X12,
  hallFor,
  renderScore,
  tapeEcho,
  V30_4X12,
  wall,
} from '../../../src/engines/v2/synth/render.ts';
import { string } from '../../../src/engines/v2/synth/strings.ts';

const TONE = { bright: 1, detune: 1, fmRatio: 2, vibrato: 1, crackle: 0, wow: 0 };
const db = (x: number) => 10 * Math.log10(x + 1e-30);
const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
};
/** Power of x[a..b) at frequency f: a Hann-windowed DFT bin, or unwindowed for an impulse response. */
const power = (x: ArrayLike<number>, sr: number, f: number, a = 0, b = x.length, hann = true) => {
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i++) {
    const w = hann ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a)) : 1;
    re += x[i] * w * Math.cos((2 * Math.PI * f * i) / sr);
    im += x[i] * w * Math.sin((2 * Math.PI * f * i) / sr);
  }
  return re * re + im * im;
};
/** Mean power over log-spaced frequencies in [lo, hi]. */
const band = (x: ArrayLike<number>, sr: number, lo: number, hi: number, a = 0, b = x.length, hann = true) => {
  let s = 0;
  const k = 12;
  for (let j = 0; j < k; j++) s += power(x, sr, lo * (hi / lo) ** (j / (k - 1)), a, b, hann);
  return s / k;
};
const finite = (x: Float32Array) => x.every(Number.isFinite);

/** The amp bus of a power chord (root, fifth, octave) played by `string` and held for `d` seconds. */
function chord(sr: number, root: number, v: number, d: number, seconds: number): Float32Array {
  const b = new Bus(sr, seconds, 0x9e3779b9, TONE);
  [root, root + 7, root + 12].forEach((n, k) =>
    string(b, { i: 'string', t: 0.05 + 0.012 * k, n, v, k: 'overdrive', d, p: -0.9 })
  );
  return b.AMP;
}

Deno.test('both 4x12s fall away above 5 kHz, as the measured cabinets do', () => {
  const sr = 48000;
  for (const cab of [GREENBACK_4X12, V30_4X12]) {
    const c = new Chain(sr, cab);
    const ir = new Float64Array(4096);
    for (let i = 0; i < ir.length; i++) ir[i] = c.run(i === 0 ? 1 : 0);
    const mid = band(ir, sr, 200, 2000, 0, ir.length, false);
    const at = (f: number) => db(power(ir, sr, f, 0, ir.length, false) / mid);
    assert(Math.abs(at(1000)) < 4, `1 kHz ${at(1000).toFixed(1)} dB`);
    assert(at(2300) > 0, `the presence near 2.3 kHz: ${at(2300).toFixed(1)} dB`);
    assert(at(8000) < -12, `8 kHz ${at(8000).toFixed(1)} dB`);
    assert(at(10000) < -18, `10 kHz ${at(10000).toFixed(1)} dB`);
    assert(at(60) < -8, `60 Hz ${at(60).toFixed(1)} dB`);
  }
});

Deno.test('the wall holds a chord at full level while the strings ring, bounded and dark on top', () => {
  const sr = 24000;
  const x = chord(sr, 40, 0.85, 4, 4.5);
  const y = wall(sr, x.length, x);
  assert(finite(y));
  assert(y.every((v) => Math.abs(v) < 1));
  const early = rms(y, Math.round(0.2 * sr), Math.round(0.7 * sr));
  const late = rms(y, Math.round(3 * sr), Math.round(3.5 * sr));
  assert(Math.abs(20 * Math.log10(late / early)) < 2, `sustain ${(20 * Math.log10(late / early)).toFixed(1)} dB`);
  // the fizz is gone: little above 6 kHz against the body of the sound
  const a = Math.round(0.5 * sr);
  const b = Math.round(1.5 * sr);
  const top = db(band(y, sr, 6000, 10000, a, b) / band(y, sr, 200, 4000, a, b));
  assert(top < -15, `6-10 kHz ${top.toFixed(1)} dB under 200 Hz-4 kHz`);
  // a softer chord is as loud: the fuzz is saturated either way
  const soft = wall(sr, x.length, chord(sr, 40, 0.55, 4, 4.5));
  assert(Math.abs(20 * Math.log10(rms(soft) / rms(y))) < 2);
});

Deno.test('tape echo: each repeat a delay later, quieter and darker than the one before, swaying a little', () => {
  const sr = 24000;
  const time = 0.4;
  const make = (input: (i: number) => number, seconds: number) => {
    const n = seconds * sr;
    const b = {
      sr,
      n,
      L: new Float32Array(n),
      R: new Float32Array(n),
      REV: new Float32Array(n),
      DLY: new Float32Array(n),
    };
    for (let i = 0; i < n; i++) b.DLY[i] = input(i);
    tapeEcho(b, time, 0.6, 1);
    return b;
  };
  const click = make((i) => (i === 100 ? 1 : 0), 3);
  assert(finite(click.L) && finite(click.R));
  let level = Infinity;
  let tilt = Infinity;
  for (let k = 1; k <= 4; k++) {
    // repeats ping-pong: odd ones on the left
    const ch = k % 2 ? click.L : click.R;
    const c = 100 + Math.round(k * time * sr);
    const a = c - Math.round(0.01 * sr);
    const b = c + Math.round(0.04 * sr);
    let peak = 0;
    let at = 0;
    for (let i = a; i < b; i++) {
      if (Math.abs(ch[i]) > peak) [peak, at] = [Math.abs(ch[i]), i];
    }
    assert(Math.abs(at - c) < 0.003 * sr, `repeat ${k} at ${((at - 100) / sr).toFixed(4)} s`);
    const e = db(band(ch, sr, 300, 1200, a, b));
    const t = db(band(ch, sr, 2000, 5000, a, b)) - e;
    assert(e < level, `repeat ${k} is quieter`);
    assert(t < tilt - 0.5, `repeat ${k} is darker: ${t.toFixed(1)} dB after ${tilt.toFixed(1)}`);
    level = e;
    tilt = t;
  }
  // a held tone comes back with its pitch swaying a few cents (tape wow and flutter)
  const tone = make((i) => 0.2 * Math.sin((2 * Math.PI * 1000 * i) / sr), 8);
  const zc: number[] = [];
  for (let i = 2 * sr; i < 8 * sr - 1; i++) {
    if (tone.L[i] <= 0 && tone.L[i + 1] > 0) zc.push(i + tone.L[i] / (tone.L[i] - tone.L[i + 1]));
  }
  // periods averaged over 20 cycles, in cents
  const cents: number[] = [];
  for (let j = 20; j < zc.length; j += 20) cents.push(1200 * Math.log2(sr / ((zc[j] - zc[j - 20]) / 20) / 1000));
  const mean = cents.reduce((s, v) => s + v, 0) / cents.length;
  const sway = Math.sqrt(cents.reduce((s, v) => s + (v - mean) ** 2, 0) / cents.length);
  assert(sway > 0.5 && sway < 10, `sway ${sway.toFixed(2)} cents rms`);
});

/** T30 of x in the octave around fc, from its Schroeder backward integral. */
function t30(x: Float32Array, sr: number, fc: number): number {
  const f1 = new SVF(sr, fc, 1.4);
  const f2 = new SVF(sr, fc, 1.4);
  const e = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    f1.run(x[i]);
    f2.run(f1.bp);
    e[i] = f2.bp * f2.bp;
  }
  for (let i = x.length - 2; i >= 0; i--) e[i] += e[i + 1];
  const at = (level: number) => e.findIndex((v) => db(v / e[0]) <= level) / sr;
  return (at(-35) - at(-5)) * 2;
}

/** The strongest self-similarity of a tail at lags of 5 to 100 ms (1-4 kHz, level-flattened). */
function periodicity(x: Float32Array, sr: number): number {
  const hp = new SVF(sr, 1000, 0.7);
  const lp = new SVF(sr, 4000, 0.7);
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    hp.run(x[i]);
    y[i] = lp.run(hp.hp);
  }
  const w = Math.round(0.01 * sr);
  const z = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) {
    let s = 0;
    for (let j = Math.max(0, i - w); j < Math.min(y.length, i + w); j++) s += y[j] * y[j];
    z[i] = y[i] / Math.sqrt(s / (2 * w) + 1e-30);
  }
  let zero = 0;
  for (const v of z) zero += v * v;
  let best = 0;
  for (let lag = Math.round(0.005 * sr); lag < Math.round(0.1 * sr); lag++) {
    let s = 0;
    for (let i = 0; i + lag < z.length; i++) s += z[i] * z[i + lag];
    best = Math.max(best, Math.abs(s / zero));
  }
  return best;
}

Deno.test('the hall decays as the plain room did, without its periodic, metallic ring', () => {
  const sr = 32000;
  const n = 7 * sr;
  const imp = new Float32Array(n);
  imp[0] = 1;
  const room = 0.92;
  const hl = new Float32Array(n);
  const hr = new Float32Array(n);
  hall(sr, imp, hl, hr, { ...hallFor(room), wet: 1, pre: 0, shimmer: 0 });
  const fl = new Float32Array(n);
  const fr = new Float32Array(n);
  freeverb(sr, imp, fl, fr, room, 1, 0, 0.35);
  assert(finite(hl) && finite(hr));
  const mids = t30(hl, sr, 500);
  const { t60 } = hallFor(room);
  assert(Math.abs(mids / t60 - 1) < 0.15, `T30 at 500 Hz ${mids.toFixed(2)} s, set to ${t60.toFixed(2)}`);
  assert(Math.abs(mids / t30(fl, sr, 500) - 1) < 0.15, 'as long as the room it replaces');
  assert(t30(hl, sr, 4000) < 0.6 * mids, 'the highs die sooner');
  const energy = (a: Float32Array, b: Float32Array) => a.reduce((s, v, i) => s + v * v + b[i] * b[i], 0);
  assert(Math.abs(db(energy(hl, hr) / energy(fl, fr))) < 1.5, 'as loud as the room it replaces');
  const tail = (x: Float32Array) => x.slice(Math.round(0.3 * sr), Math.round(1.5 * sr));
  const ph = periodicity(tail(hl), sr);
  const pf = periodicity(tail(fl), sr);
  assert(ph < 0.6 * pf, `hall ${ph.toFixed(3)} against freeverb ${pf.toFixed(3)}`);
});

Deno.test('the shimmer brings the tail back an octave up and stays stable', () => {
  const sr = 16000;
  const n = 8 * sr;
  const tone = new Float32Array(n);
  for (let i = 0; i < sr / 2; i++) {
    tone[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * Math.min(1, i / 160, (sr / 2 - i) / 160);
  }
  const octave = (shimmer: number) => {
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    hall(sr, tone, L, R, { ...hallFor(0.92), wet: 1, pre: 0, shimmer });
    assert(finite(L) && L.every((v) => Math.abs(v) < 10));
    const a = sr;
    const b = 3 * sr;
    return db(power(L, sr, 880, a, b) / power(L, sr, 440, a, b));
  };
  const none = octave(0);
  const some = octave(0.35);
  const full = octave(1);
  assert(some > none + 15, `octave ${some.toFixed(1)} dB against ${none.toFixed(1)}`);
  assert(full > some && full < 0, `a full shimmer ${full.toFixed(1)} dB under the note`);
});

Deno.test('the clean guitar sounds through its amp and speaker, with a chorus that leaves the mono sum dry', () => {
  const sr = 48000;
  const b = new Bus(sr, 2, 7, TONE);
  string(b, { i: 'string', t: 0.01, n: 64, v: 0.7, k: 'clean', d: 1.5, p: 0 });
  const L = b.ML.map((v, i) => v + b.L[i]);
  const R = b.MR.map((v, i) => v + b.R[i]);
  const mono = L.map((v, i) => v + R[i]);
  assert(finite(mono));
  const a = Math.round(0.05 * sr);
  const e = Math.round(0.55 * sr);
  const top = db(band(mono, sr, 6000, 10000, a, e) / band(mono, sr, 1000, 3000, a, e));
  assert(top < -25, `6-10 kHz ${top.toFixed(1)} dB under 1-3 kHz: the speaker's fall`);
  // the chorus is only in the sides
  const side = L.map((v, i) => v - R[i]);
  const ratio = rms(side) / rms(mono);
  assert(ratio > 0.03 && ratio < 0.5, `side over mid ${ratio.toFixed(3)}`);
  const ch = new Chorus(sr, 1.3, 7, 0.5, 0.7, 0.35);
  let s = 1;
  for (let i = 0; i < sr; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const x = s / 4294967296 - 0.5;
    assertEquals(ch.run(x), x);
    assert(Math.abs(ch.side) < 0.35);
  }
});

Deno.test('post-rock plays through the rig; every other style keeps the plain echo and room', () => {
  for (const id of STYLE_IDS) {
    const { echo, hall, shimmer, amp } = STYLES[id].record;
    if (id === 'ember') {
      assertEquals([echo, hall, amp], ['tape', true, 'fuzz']);
    } else {
      assertEquals([echo, hall, shimmer, amp], [undefined, undefined, undefined, 'crunch']);
    }
  }
  const mix = new Song('rig', ['ember']).movement(0).mix;
  assertEquals([mix.echo, mix.hall, mix.amp], ['tape', true, 'fuzz']);
});

Deno.test('a post-rock climax renders finite, bounded and the same every time', () => {
  const song = new Song('rig-climax', ['ember'], 'short');
  const mv = song.movement(0);
  const k = mv.sections.findIndex((s) => s.role === 'drop' || s.role === 'chorus');
  const s = composeSection(song, mv.firstSection + k);
  const short = { ...s, duration: Math.min(s.duration, 12) };
  const a = renderScore(short, 16000);
  const b = renderScore(short, 16000);
  assert(finite(a.left) && finite(a.right));
  assert(a.left.every((v) => Math.abs(v) <= 1) && a.right.every((v) => Math.abs(v) <= 1));
  assertEquals(a.left, b.left);
  assertEquals(a.right, b.right);
});
