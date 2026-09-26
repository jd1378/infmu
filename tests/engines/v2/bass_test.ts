import { assert, assertEquals } from '@std/assert';
import { Bus } from '../../../src/engines/v2/synth/bus.ts';
import { SVF } from '../../../src/engines/v2/synth/dsp.ts';
import { bass } from '../../../src/engines/v2/synth/instruments.ts';
import { wall } from '../../../src/engines/v2/synth/render.ts';
import { BASSES, string } from '../../../src/engines/v2/synth/strings.ts';
import type { BassKind, Ev } from '../../../src/engines/v2/types.ts';

type Str = Extract<Ev, { i: 'string' }>;
const TONE = { bright: 1, detune: 1, fmRatio: 2, vibrato: 1, crackle: 0, wow: 0 };
const db = (x: number) => 10 * Math.log10(x + 1e-30);
const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
};
/** Power of x[a..b) at frequency f: a Hann-windowed DFT bin. */
const power = (x: ArrayLike<number>, sr: number, f: number, a = 0, b = x.length) => {
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a));
    re += x[i] * w * Math.cos((2 * Math.PI * f * i) / sr);
    im += x[i] * w * Math.sin((2 * Math.PI * f * i) / sr);
  }
  return re * re + im * im;
};
/** Mean power over log-spaced frequencies in [lo, hi]. */
const band = (x: ArrayLike<number>, sr: number, lo: number, hi: number, a = 0, b = x.length) => {
  let s = 0;
  const k = 16;
  for (let j = 0; j < k; j++) s += power(x, sr, lo * (hi / lo) ** (j / (k - 1)), a, b);
  return s / k;
};
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** One bass note, the dry mid of the buses it plays on. */
function note(k: BassKind, n: number, v: number, d = 3, sr = 24000, seconds = d + 0.5): Float32Array {
  const b = new Bus(sr, seconds, 0x9e3779b9, TONE);
  bass(b, { i: 'bass', t: 0.05, d, n, v, k });
  return b.L.map((l, i) => (l + b.ML[i] + b.R[i] + b.MR[i]) / 2);
}

/** One guitar note (the mid; an overdrive note's amp bus). */
function guitar(e: Omit<Str, 'i' | 't'>, sr = 24000, seconds = 3): Float32Array {
  const b = new Bus(sr, seconds, 0x9e3779b9, TONE);
  string(b, { i: 'string', t: 0.05, ...e });
  if (e.k === 'overdrive') return b.AMP;
  return b.L.map((l, i) => (l + b.ML[i] + b.R[i] + b.MR[i]) / 2);
}

/**
 * The fundamental's pitch over time, cents from `f`: the times its band-passed signal crosses zero upwards, one
 * reading a period, as [t, cents] pairs.
 */
function pitch(x: Float32Array, sr: number, f: number): [number, number][] {
  const bp = new SVF(sr, f, 4);
  const out: [number, number][] = [];
  let prev = 0;
  let last = -1;
  for (let i = 0; i < x.length; i++) {
    bp.run(x[i]);
    const y = bp.bp;
    if (prev < 0 && y >= 0) {
      const at = i - 1 + prev / (prev - y);
      if (last >= 0) out.push([at / sr, 1200 * Math.log2(sr / (at - last) / f)]);
      last = at;
    }
    prev = y;
  }
  return out;
}

/** A pitch track's vibrato over [t0, t1]: depth (cents, sqrt 2 x rms about a 0.3 s moving mean) and rate (Hz). */
function vibrato(track: [number, number][], t0: number, t1: number): { depth: number; rate: number } {
  const seg = track.filter(([t]) => t >= t0 - 0.2 && t <= t1 + 0.2);
  const dev: [number, number][] = [];
  for (const [t, c] of seg) {
    if (t < t0 || t > t1) continue;
    const near = seg.filter(([u]) => Math.abs(u - t) <= 0.15);
    dev.push([t, c - near.reduce((s, [, x]) => s + x, 0) / near.length]);
  }
  const depth = Math.SQRT2 * Math.sqrt(dev.reduce((s, [, x]) => s + x * x, 0) / dev.length);
  let crossings = 0;
  for (let i = 1; i < dev.length; i++) if (dev[i - 1][1] < 0 && dev[i][1] >= 0) crossings++;
  return { depth, rate: crossings / (t1 - t0) };
}

Deno.test('existing bass kinds are unchanged, sample for sample', () => {
  // FNV-1a of L, R, ML, MR, taken from the engine before the bass guitars (out/research/sound/bass/kinds_hash.ts)
  const WANT: Record<string, string> = {
    heart: '2f4f05252f4f05259c6a33c59c6a33c5',
    sub: '9c6a33c59c6a33c5fec2efc8fec2efc8',
    saw: '9c6a33c59c6a33c557d55bd857d55bd8',
    roll: '9c6a33c59c6a33c5919ae44f919ae44f',
    round: '9c6a33c59c6a33c503e756d403e756d4',
    pulse: '9c6a33c59c6a33c5e1ad4d47e1ad4d47',
    808: '9c6a33c59c6a33c5a304f1d8a304f1d8',
  };
  const fnv = (a: Float32Array) => {
    let h = 0x811c9dc5;
    const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  for (const k of Object.keys(WANT) as BassKind[]) {
    const b = new Bus(16000, 3, 0x1234567, { ...TONE, wow: 0.5 });
    b.duck = b.duck.map((_, i) => 0.6 + 0.4 * Math.cos(i / 900) ** 2);
    bass(b, { i: 'bass', t: 0.1, d: 0.6, n: 33, v: 0.8, k });
    bass(b, { i: 'bass', t: 0.8, d: 1.2, n: 40, v: 0.5, k, rel: 0.4 });
    bass(b, { i: 'bass', t: 2.1, d: 0.3, n: 28, v: 1, k });
    assertEquals(fnv(b.L) + fnv(b.R) + fnv(b.ML) + fnv(b.MR), WANT[k], k);
  }
});

Deno.test('bass guitars render finite and bounded over the range, at any rate, the same twice', () => {
  for (const sr of [16000, 48000]) {
    for (const k of ['pick', 'finger'] as const) {
      for (const [n, v] of [[28, 1], [36, 0.3], [43, 0.8], [55, 1]]) {
        const x = note(k, n, v, 1, sr, 1.5);
        assert(x.every(Number.isFinite), `${k} ${n} at ${sr}`);
        assert(x.every((s) => Math.abs(s) < 1), `${k} ${n} at ${sr} bounded`);
        assert(rms(x) > 1e-3, `${k} ${n} at ${sr} sounds`);
      }
    }
  }
  assertEquals(note('pick', 33, 0.8, 1), note('pick', 33, 0.8, 1));
});

Deno.test('a low E sustains as a bass string does, and stops when the hand mutes it', () => {
  const sr = 24000;
  const m = BASSES.pick as { di: number };
  const keep = m.di;
  m.di = 1;
  try {
    const x = note('pick', 28, 0.7, 3.5, sr, 4.2);
    const at = (t: number) => rms(x, Math.round((t + 0.05) * sr), Math.round((t + 0.25) * sr));
    const early = at(0.2);
    // the references (a Precision picked into a preamp, a Yamaha DI) are 7 to 11 dB down at 2 s, 8 to 14 at 3 s
    const two = 20 * Math.log10(at(2) / early);
    const three = 20 * Math.log10(at(3) / early);
    assert(two > -14 && two < -4, `2 s: ${two.toFixed(1)} dB`);
    assert(three > -18 && three < -6, `3 s: ${three.toFixed(1)} dB`);
    // the fundamental rings on for seconds
    const f = hz(28);
    const fund = (t: number) => power(x, sr, f, Math.round(t * sr), Math.round((t + 0.5) * sr));
    const t60 = (-60 * 2) / db(fund(2.3) / fund(0.3));
    assert(t60 > 8, `fundamental T60 ${t60.toFixed(1)} s`);
    // muted at 3.5 s: 40 dB down 0.2 s later
    const muted = 20 * Math.log10(rms(x, Math.round(3.75 * sr), Math.round(3.8 * sr)) / at(3.2));
    assert(muted < -30, `muted ${muted.toFixed(1)} dB`);
  } finally {
    m.di = keep;
  }
});

Deno.test('the bass is in tune and its partials stretch as a stiff string does', () => {
  const sr = 24000;
  for (const n of [28, 36, 43]) {
    const x = note('pick', n, 0.5, 2, sr, 2);
    const f = hz(n);
    const a = Math.round(0.4 * sr);
    const b = Math.round(1.9 * sr);
    // the strongest frequency in [lo, hi]: a coarse grid, then a finer one around its best
    const peak = (lo: number, hi: number) => {
      let best = lo;
      let bp = 0;
      for (let pass = 0; pass < 2; pass++) {
        const step = (hi - lo) / 24;
        for (let q = lo; q <= hi; q += step) {
          const p = power(x, sr, q, a, b);
          if (p > bp) [best, bp] = [q, p];
        }
        [lo, hi] = [best - step, best + step];
      }
      return best;
    };
    const f1 = peak(f * 0.99, f * 1.01);
    assert(Math.abs(1200 * Math.log2(f1 / f)) < 3, `fundamental of ${n}: ${(1200 * Math.log2(f1 / f)).toFixed(1)} c`);
    // partial 12 sits sharp of 12 f, as sqrt(1 + B k^2) with B ~ 1e-4 puts it (a few cents to tens of cents)
    const f12 = peak(12 * f * 0.995, 12 * f * 1.03);
    const sharp = 1200 * Math.log2(f12 / (12 * f1));
    assert(sharp > 2 && sharp < 40, `partial 12 of ${n}: ${sharp.toFixed(1)} c sharp`);
  }
});

Deno.test('a picked note dug in buzzes on the frets: its highs grow faster than its level', () => {
  const sr = 24000;
  const hi = (x: Float32Array) => band(x, sr, 1500, 4000, Math.round(0.07 * sr), Math.round(0.21 * sr));
  const all = (x: Float32Array) => rms(x, Math.round(0.05 * sr), Math.round(0.3 * sr)) ** 2;
  const soft = note('pick', 28, 0.4, 1, sr, 1);
  const hard = note('pick', 28, 1, 1, sr, 1);
  const grow = db(hi(hard) / hi(soft)) - db(all(hard) / all(soft));
  assert(grow > 8, `highs grow ${grow.toFixed(1)} dB more than the level`);
  // the finger is rounder: less 1.5-4 kHz against 100-400 Hz than the pick
  const tilt = (x: Float32Array) =>
    db(band(x, sr, 1500, 4000, Math.round(0.1 * sr), Math.round(0.6 * sr)) / band(x, sr, 100, 400));
  const pick = note('pick', 33, 0.8, 1, sr, 1);
  const finger = note('finger', 33, 0.8, 1, sr, 1);
  assert(tilt(pick) - tilt(finger) > 3, `pick ${tilt(pick).toFixed(1)} dB, finger ${tilt(finger).toFixed(1)} dB`);
});

Deno.test('the amp: the pick growls in the upper mids and falls away above its cabinet', () => {
  const sr = 24000;
  const x = note('pick', 36, 0.8, 1.2, sr, 1.2);
  const a = Math.round(0.1 * sr);
  const b = Math.round(1.1 * sr);
  const growl = db(band(x, sr, 1000, 2500, a, b));
  const top = db(band(x, sr, 6000, 9000, a, b));
  assert(growl - top > 20, `1-2.5 kHz ${growl.toFixed(1)} dB, 6-9 kHz ${top.toFixed(1)} dB`);
});

Deno.test('a held note of a line gets a finger vibrato after its attack; chords and vib 0 do not', () => {
  const sr = 24000;
  for (const [k, n] of [['clean', 64], ['electric', 57], ['guitar', 64]] as const) {
    const x = guitar({ n, v: 0.8, k, d: 2.4, lead: true }, sr, 2.6);
    const track = pitch(x, sr, hz(n));
    const early = vibrato(track, 0.1, 0.2);
    const held = vibrato(track, 0.9, 2.3);
    assert(held.rate >= 4.2 && held.rate <= 6.8, `${k}: rate ${held.rate.toFixed(2)} Hz`);
    const [lo, hi] = k === 'guitar' ? [4, 30] : [7, 45];
    assert(held.depth >= lo && held.depth <= hi, `${k}: depth ${held.depth.toFixed(1)} c`);
    assert(early.depth < held.depth / 2, `${k}: comes in after the attack (${early.depth.toFixed(1)} c early)`);
  }
  for (const e of [{ k: 'clean' as const, lead: true, vib: 0 }, { k: 'clean' as const }]) {
    const x = guitar({ n: 64, v: 0.8, d: 2.4, ...e }, sr, 2.6);
    const held = vibrato(pitch(x, sr, hz(64)), 0.9, 2.3);
    assert(held.depth < 2, `no vibrato: ${held.depth.toFixed(1)} c`);
  }
  // deterministic
  const e = { n: 64, v: 0.8, k: 'clean' as const, d: 2, lead: true };
  assertEquals(guitar(e, sr, 2.2), guitar(e, sr, 2.2));
});

Deno.test('a held overdriven chord blooms into feedback through the wall', () => {
  const sr = 24000;
  // the root feeds back, as the first held note on an amp does by default
  const chord = (feedback: number) => {
    const b = new Bus(sr, 4, 0x9e3779b9, TONE);
    [45, 52, 57].forEach((n, k) =>
      string(b, {
        i: 'string',
        t: 0.05 + 0.012 * k,
        n,
        v: 0.85,
        k: 'overdrive',
        d: 3.8,
        p: -0.9,
        feedback: k ? 0 : feedback,
      })
    );
    return wall(sr, b.n, b.AMP);
  };
  const dry = chord(0);
  const fed = chord(1);
  assert(fed.every(Number.isFinite) && fed.every((v) => Math.abs(v) < 1));
  // A2's third harmonic
  const at = (x: Float32Array, t: number) => power(x, sr, 3 * hz(45), Math.round(t * sr), Math.round((t + 0.4) * sr));
  assert(db(at(fed, 0.1) / at(dry, 0.1)) < 1, 'nothing yet at the attack');
  const bloom = db(at(fed, 3) / at(dry, 3));
  assert(bloom > 6, `the harmonic swells ${bloom.toFixed(1)} dB`);
});

Deno.test('fingers scuff the strings when a line jumps to another string, not on a step', () => {
  const sr = 24000;
  const line = (second: number) => {
    const b = new Bus(sr, 1.5, 0x9e3779b9, TONE);
    string(b, { i: 'string', t: 0.05, n: 60, v: 0.8, k: 'electric', d: 0.4, lead: true, vib: 0 });
    string(b, { i: 'string', t: 0.6, n: second, v: 0.8, k: 'electric', d: 0.4, lead: true, vib: 0 });
    return b.L.map((l, i) => l + b.ML[i]);
  };
  // the 40 ms before the second note, against the same window with only the first note playing
  const alone = new Bus(sr, 1.5, 0x9e3779b9, TONE);
  string(alone, { i: 'string', t: 0.05, n: 60, v: 0.8, k: 'electric', d: 0.4, lead: true, vib: 0 });
  const ref = alone.L.map((l, i) => l + alone.ML[i]);
  const extra = (x: Float32Array) => {
    let s = 0;
    for (let i = Math.round(0.555 * sr); i < Math.round(0.6 * sr); i++) s += (x[i] - ref[i]) ** 2;
    return s;
  };
  const jump = extra(line(67));
  const step = extra(line(62));
  assert(jump > 0 && step === 0, `a jump scuffs (${db(jump).toFixed(1)} dB), a step doesn't`);
});

Deno.test("a note slid or bent into rises over its glide; a player's vibrato keeps their rate", () => {
  const sr = 24000;
  const mean = (track: [number, number][], t0: number, t1: number) => {
    const seg = track.filter(([t]) => t >= t0 && t <= t1);
    return seg.reduce((s, [, c]) => s + c, 0) / seg.length;
  };
  const from = (glide?: number) =>
    pitch(guitar({ n: 64, v: 0.8, k: 'clean', d: 1, lead: true, vib: 0, slide: -2, glide }, sr, 1.2), sr, hz(64));
  // (the note starts at 0.05 s) a quick slide along the frets is there by a tenth of a second, a bend still rising
  const fret = mean(from(), 0.2, 0.25);
  const bend = mean(from(0.3), 0.2, 0.25);
  assert(Math.abs(fret) < 15, `the slide is at ${fret.toFixed(0)} c`);
  assert(bend < -40, `the bend is at ${bend.toFixed(0)} c`);
  assert(Math.abs(mean(from(0.3), 0.5, 0.9)) < 15, 'the bend arrives');
  const rate = (vibRate: number) =>
    vibrato(pitch(guitar({ n: 64, v: 0.8, k: 'clean', d: 2.4, lead: true, vibRate }, sr, 2.6), sr, hz(64)), 0.9, 2.3)
      .rate;
  const [slow, quick] = [rate(4.4), rate(6.3)];
  assert(Math.abs(slow - 4.4) < 0.8 && Math.abs(quick - 6.3) < 0.8, `${slow.toFixed(2)} and ${quick.toFixed(2)} Hz`);
});
