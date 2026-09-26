// DSP building blocks. Adapted from EX NIHILO's synth (github.com/ErwannRobin/ex-nihilo), made reentrant:
// every piece of state lives in an object, so several sections can render side by side in workers.

export const TAU = 2 * Math.PI;
export const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Equal-power pan, p in [-1, 1] -> [left, right] gains. */
export const pan = (
  p: number,
): [number, number] => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];

/** xorshift32 white noise in [-1, 1). Seeded per section so the audio is as reproducible as the notes. */
export class Noise {
  private s: number;
  constructor(seed: number) {
    this.s = seed | 0 || 0x2545f491;
  }
  next(): number {
    let s = this.s;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.s = s;
    return s / 2147483648;
  }
  /** [0, 1) */
  unit(): number {
    return (this.next() + 1) / 2;
  }
}

/** Zavalishin's topology-preserving state-variable filter: low/band/high-pass at once, stable under fast sweeps. */
export class SVF {
  private s1 = 0;
  private s2 = 0;
  bp = 0;
  hp = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private q: number;
  private readonly sr: number;

  constructor(sr: number, fc: number, q = 0.707) {
    this.sr = sr;
    this.q = q;
    this.set(fc, q);
  }

  set(fc: number, q = this.q): void {
    const g = Math.tan((Math.PI * Math.min(fc, this.sr * 0.45)) / this.sr);
    this.q = q;
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  /** Returns the low-pass output; `bp` and `hp` hold the other two. */
  run(x: number): number {
    const v3 = x - this.s2;
    const v1 = this.a1 * this.s1 + this.a2 * v3;
    const v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1;
    this.s2 = 2 * v2 - this.s2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
    return v2;
  }
}

/** PolyBLEP sawtooth: a ramp with a polynomial correction at each reset, so it doesn't alias. */
export function saw(p: number, dt: number): number {
  if (p < dt) {
    const x = p / dt;
    return 2 * p - 2 * x + x * x;
  }
  if (p > 1 - dt) {
    const x = (p - 1) / dt;
    return 2 * p - 2 - x * x - 2 * x;
  }
  return 2 * p - 1;
}

/**
 * Freeverb (Jezar): 8 damped feedback combs + 4 allpass diffusers per channel; the right side's delays are
 * 23 samples longer, which decorrelates the two sides into width.
 */
export function freeverb(
  sr: number,
  inp: Float32Array,
  oL: Float32Array,
  oR: Float32Array,
  room: number,
  wet: number,
  pre = 0,
  damp = 0.3,
): void {
  const mk = (n: number) => new Float32Array(Math.round((n * sr) / 44100));
  const C = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const A = [556, 441, 341, 225];
  const cb = [...C.map(mk), ...C.map((n) => mk(n + 23))];
  const ab = [...A.map(mk), ...A.map((n) => mk(n + 23))];
  const cp = new Int32Array(16);
  const ap = new Int32Array(8);
  const st = new Float64Array(16);
  const fb = room * 0.28 + 0.7;
  const n = Math.min(inp.length, oL.length);
  for (let i = 0; i < n; i++) {
    const x = i >= pre ? inp[i - pre] * 0.015 : 0;
    let yl = 0;
    let yr = 0;
    for (let c = 0; c < 16; c++) {
      const b = cb[c];
      const p = cp[c];
      const o = b[p];
      st[c] = o * (1 - damp) + st[c] * damp;
      b[p] = x + st[c] * fb;
      cp[c] = p + 1 < b.length ? p + 1 : 0;
      if (c < 8) yl += o;
      else yr += o;
    }
    for (let a = 0; a < 8; a++) {
      const b = ab[a];
      const p = ap[a];
      const o = b[p];
      const y = a < 4 ? yl : yr;
      b[p] = y + o * 0.5;
      ap[a] = p + 1 < b.length ? p + 1 : 0;
      if (a < 4) yl = o - y;
      else yr = o - y;
    }
    oL[i] += yl * wet;
    oR[i] += yr * wet;
  }
}

/** The hall's delay lines at size 1, ms: spread over more than an octave, so their modes interleave. */
const HALL_MS = [31.7, 37.3, 41.9, 47.9, 53.3, 61.1, 67.7, 79.3];
/** How slowly each line's length wanders, Hz: all different, none a multiple of another. */
const HALL_RATES = [0.11, 0.17, 0.23, 0.29, 0.37, 0.43, 0.53, 0.61];
/** An allpass inside each line, ms: every pass round the loop smears each echo into several. */
const HALL_AP_MS = [5.3, 7.1, 8.9, 6.1, 9.7, 4.7, 7.9, 5.9];
/** Input diffusers from Dattorro's plate ("Effect Design, Part 1", JAES 1997): length ms, allpass coefficient. */
const DIFFUSERS: readonly (readonly [number, number])[] = [[4.771, 0.75], [3.595, 0.75], [12.735, 0.625], [
  9.307,
  0.625,
]];
/** Sends the tail as loud as freeverb's at the same wet level (their energies measured on the same input). */
const HALL_GAIN = 0.111;
const HADAMARD_NORM = 1 / Math.sqrt(8);

export interface HallOptions {
  /** T60 of the lows and mids, s, and at 4 kHz: a hall's air and surfaces take the highs first. */
  t60: number;
  t60hi: number;
  /** Return gain, as freeverb's `wet`. */
  wet: number;
  /** Samples before the tail starts. */
  pre: number;
  /** Share of the tail fed back an octave up (0 = none): the shimmer of an ambient guitar rig. */
  shimmer: number;
}

const isPrime = (n: number) => {
  for (let k = 2; k * k <= n; k++) if (n % k === 0) return false;
  return n > 1;
};

/**
 * A hall: a feedback delay network of eight lines (Jot's design: an orthogonal mix between them, here a Hadamard, and
 * a loss filter in each in proportion to its length, so every mode at a frequency decays at the rate set for it),
 * fed through four diffusers so the echoes thicken at once, with an allpass in each line to keep thickening them.
 * Each line's length wanders by 0.5 ms at its own slow rate: the modes never ring still, and the tail doesn't repeat
 * itself every few tens of milliseconds as a comb reverb's does (which is what makes one sound metallic).
 */
export function hall(sr: number, inp: Float32Array, oL: Float32Array, oR: Float32Array, o: HallOptions): void {
  const N = 8;
  const len = HALL_MS.map((ms) => {
    let L = Math.round((ms * sr) / 1000);
    while (!isPrime(L)) L++;
    return L;
  });
  const depth = 0.0005 * sr;
  const size = len.map((L) => L + Math.ceil(depth) + 2);
  const buf = size.map((s) => new Float64Array(s));
  const wp = new Int32Array(N);
  // per line: its gain at DC and a one-pole low-pass that takes the gain down to 4 kHz's (as Loop in strings.ts)
  const ap = HALL_AP_MS.map((ms) => {
    let L = Math.round((ms * sr) / 1000);
    while (!isPrime(L)) L++;
    return { b: new Float64Array(L), i: 0 };
  });
  const g = new Float64Array(N);
  const c = new Float64Array(N);
  const wh = (TAU * 4000) / sr;
  len.forEach((L0, i) => {
    // the allpass lengthens the loop by its own delay, on average
    const L = L0 + ap[i].b.length;
    g[i] = 10 ** ((-3 * L) / (sr * o.t60));
    const r = 10 ** ((-3 * L) / (sr * o.t60hi)) / g[i];
    const A = 1 - r * r;
    const B = 1 - r * r * Math.cos(wh);
    c[i] = A > 1e-9 ? (B - Math.sqrt(Math.max(0, B * B - A * A))) / A : 0;
  });
  // each line's wander, a rotating phasor
  const cs = HALL_RATES.map((_, i) => Math.cos(0.8 * i));
  const sn = HALL_RATES.map((_, i) => Math.sin(0.8 * i));
  const rc = HALL_RATES.map((r) => Math.cos((TAU * r) / sr));
  const rs = HALL_RATES.map((r) => Math.sin((TAU * r) / sr));
  const dif = DIFFUSERS.map(([ms, k]) => ({ b: new Float64Array(Math.round((ms * sr) / 1000)), k, i: 0 }));
  const lp = new Float64Array(N);
  const v = new Float64Array(N);
  // the input enters the lines with alternating signs; the ears hear two other orthogonal sign patterns
  const IN = [1, -1, 1, -1, 1, -1, 1, -1];
  const PL = [1, 1, -1, -1, 1, 1, -1, -1];
  const PR = [1, -1, -1, 1, 1, -1, -1, 1];
  const shift = o.shimmer > 0 ? new OctaveUp(Math.round(0.06 * sr)) : null;
  const shp = new SVF(sr, 400, 0.7);
  let fb = 0;
  const k = HALL_GAIN * o.wet;
  const n = Math.min(inp.length, oL.length);
  for (let t = 0; t < n; t++) {
    let x = (t >= o.pre ? inp[t - o.pre] : 0) + fb;
    for (let j = 0; j < dif.length; j++) {
      const d = dif[j];
      const y = d.b[d.i] - d.k * x;
      d.b[d.i] = x + d.k * y;
      d.i = d.i + 1 < d.b.length ? d.i + 1 : 0;
      x = y;
    }
    let yl = 0;
    let yr = 0;
    for (let i = 0; i < N; i++) {
      const s = sn[i] * rc[i] + cs[i] * rs[i];
      cs[i] = cs[i] * rc[i] - sn[i] * rs[i];
      sn[i] = s;
      const b = buf[i];
      let r = wp[i] - len[i] - depth * s;
      if (r < 0) r += size[i];
      const r0 = r | 0;
      const r1 = r0 + 1 < size[i] ? r0 + 1 : 0;
      const d = b[r0] + (r - r0) * (b[r1] - b[r0]);
      const a = ap[i];
      const y = a.b[a.i] - 0.5 * d;
      a.b[a.i] = d + 0.5 * y;
      a.i = a.i + 1 < a.b.length ? a.i + 1 : 0;
      yl += PL[i] * y;
      yr += PR[i] * y;
      lp[i] += (1 - c[i]) * (y - lp[i]);
      v[i] = g[i] * lp[i];
    }
    // Hadamard mix (a fast Walsh-Hadamard transform), normalized: lossless, so only the loss filters decay the tail
    const a0 = v[0] + v[1], a1 = v[0] - v[1], a2 = v[2] + v[3], a3 = v[2] - v[3];
    const a4 = v[4] + v[5], a5 = v[4] - v[5], a6 = v[6] + v[7], a7 = v[6] - v[7];
    const b0 = a0 + a2, b2 = a0 - a2, b1 = a1 + a3, b3 = a1 - a3;
    const b4 = a4 + a6, b6 = a4 - a6, b5 = a5 + a7, b7 = a5 - a7;
    v[0] = b0 + b4;
    v[4] = b0 - b4;
    v[1] = b1 + b5;
    v[5] = b1 - b5;
    v[2] = b2 + b6;
    v[6] = b2 - b6;
    v[3] = b3 + b7;
    v[7] = b3 - b7;
    for (let i = 0; i < N; i++) {
      buf[i][wp[i]] = v[i] * HADAMARD_NORM + IN[i] * x;
      wp[i] = wp[i] + 1 < size[i] ? wp[i] + 1 : 0;
    }
    if (shift) {
      shp.run(yl + yr);
      fb = (o.shimmer * shift.run(shp.hp)) / 16;
    }
    oL[t] += yl * k;
    oR[t] += yr * k;
  }
}

/**
 * An octave up: two taps sweep through a short delay line at twice the speed it is written, each fading in and out
 * (sin^2 windows half a sweep apart sum to 1) so the jumps back never click.
 */
class OctaveUp {
  private readonly buf: Float64Array;
  private w = 0;
  private ph = 0;
  constructor(private readonly W: number) {
    this.buf = new Float64Array(W + 4);
  }
  run(x: number): number {
    const b = this.buf;
    const L = b.length;
    b[this.w] = x;
    let y = 0;
    for (let k = 0; k < 2; k++) {
      const p = k ? (this.ph + 0.5) % 1 : this.ph;
      // the tap's delay falls from W to 0 over its sweep: read at twice the write speed
      let r = this.w - 1 - (1 - p) * this.W;
      if (r < 0) r += L;
      const r0 = r | 0;
      const r1 = r0 + 1 < L ? r0 + 1 : 0;
      const s = Math.sin(Math.PI * p);
      y += s * s * (b[r0] + (r - r0) * (b[r1] - b[r0]));
    }
    this.ph += 1 / this.W;
    if (this.ph >= 1) this.ph -= 1;
    this.w = this.w + 1 < L ? this.w + 1 : 0;
    return y;
  }
}

/**
 * A light stereo chorus as side signal: two taps, at `ms` and 1.57 times it, swaying in opposite phase by `depth` ms
 * at `rate` Hz; their difference goes to the sides (left mid + side, right mid - side) and nothing to the mid, so the
 * mono sum is the dry signal untouched. `at` is the time (s) the first sample is played: the sway runs on the
 * section's clock, so voices chorused one by one sum to the whole part chorused at once.
 */
export class Chorus {
  private readonly buf: Float64Array;
  private w = 0;
  private readonly cs: number;
  private readonly sn: number;
  private c: number;
  private s: number;
  private readonly d: number;
  private readonly depth: number;
  side = 0;
  constructor(sr: number, at: number, ms: number, depth: number, rate: number, private readonly mix: number) {
    this.d = (ms / 1000) * sr;
    this.depth = (depth / 1000) * sr;
    this.buf = new Float64Array(Math.ceil(1.57 * this.d + this.depth) + 3);
    this.c = Math.cos(TAU * rate * at);
    this.s = Math.sin(TAU * rate * at);
    this.cs = Math.cos((TAU * rate) / sr);
    this.sn = Math.sin((TAU * rate) / sr);
  }
  /** Takes a sample, returns it (the mid) and leaves the side in `side`. */
  run(x: number): number {
    const b = this.buf;
    const L = b.length;
    b[this.w] = x;
    const tap = (d: number) => {
      let r = this.w - d;
      if (r < 0) r += L;
      const r0 = r | 0;
      const r1 = r0 + 1 < L ? r0 + 1 : 0;
      return b[r0] + (r - r0) * (b[r1] - b[r0]);
    };
    this.side = (this.mix * (tap(this.d + this.depth * this.s) - tap(1.57 * this.d - this.depth * this.s))) / 2;
    const s = this.s * this.cs + this.c * this.sn;
    this.c = this.c * this.cs - this.s * this.sn;
    this.s = s;
    this.w = this.w + 1 < L ? this.w + 1 : 0;
    return x;
  }
}

/** A biquad in transposed direct form II. */
export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** A filter section: 2nd-order low-pass, high-pass or peak; corner or centre in Hz, Q, and a peak's gain in dB. */
export type Section = readonly [kind: 'lp' | 'hp' | 'peak', hz: number, q: number, db?: number];

/**
 * A section's biquad coefficients [b0, b1, b2, a1, a2] (R. Bristow-Johnson's Audio EQ Cookbook): the same shape at
 * any rate well above its corner.
 */
export function coefs(sr: number, [kind, hz, q, db = 0]: Section): [number, number, number, number, number] {
  const w = (TAU * Math.min(hz, 0.45 * sr)) / sr;
  const cw = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const A = 10 ** (db / 40);
  const [b0, b1, b2, a0] = kind === 'peak'
    ? [1 + al * A, -2 * cw, 1 - al * A, 1 + al / A]
    : kind === 'lp'
    ? [(1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al]
    : [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al];
  const a2 = kind === 'peak' ? 1 - al / A : 1 - al;
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * cw) / a0, a2 / a0];
}

/** Sections in series (a fitted response, such as a speaker cabinet's), as biquads in transposed direct form II. */
export class Chain {
  private readonly c: Float64Array;
  private readonly z: Float64Array;
  constructor(sr: number, sections: readonly Section[]) {
    this.c = Float64Array.from(sections.flatMap((x) => coefs(sr, x)));
    this.z = new Float64Array(2 * sections.length);
  }
  run(x: number): number {
    const c = this.c;
    const z = this.z;
    for (let j = 0, q = 0; j < c.length; j += 5, q += 2) {
      const y = c[j] * x + z[q];
      z[q] = c[j + 1] * x - c[j + 3] * y + z[q + 1];
      z[q + 1] = c[j + 2] * x - c[j + 4] * y;
      x = y;
    }
    return x;
  }
}

/**
 * An analog filter (b[0] s^2 + b[1] s + b[2]) / (a[0] s^2 + a[1] s + a[2]) as a biquad, by the bilinear transform
 * warped to be exact at `at` Hz: a circuit's response from its component values.
 */
export function analog(sr: number, b: readonly number[], a: readonly number[], at: number): Biquad {
  const c = (TAU * at) / Math.tan((Math.PI * at) / sr);
  const c2 = c * c;
  const d = a[0] * c2 + a[1] * c + a[2];
  return new Biquad(
    (b[0] * c2 + b[1] * c + b[2]) / d,
    (2 * b[2] - 2 * b[0] * c2) / d,
    (b[0] * c2 - b[1] * c + b[2]) / d,
    (2 * a[2] - 2 * a[0] * c2) / d,
    (a[0] * c2 - a[1] * c + a[2]) / d,
  );
}

/** tanh by its [3/2] Pade approximant, clamped at +-1 from |x| = 3, where value and slope meet: a cheap soft clip. */
export const softClip = (x: number): number => (x >= 3 ? 1 : x <= -3 ? -1 : (x * (27 + x * x)) / (27 + 9 * x * x));

/**
 * Twice the sample rate for a nonlinearity (its harmonics above the Nyquist frequency fold back as inharmonic grit):
 * a 15-tap half-band interpolator in, the same half-band out. `run` takes one sample and `f`, the nonlinearity at the
 * doubled rate, and returns one sample, 7 samples late.
 */
export class Oversampled {
  // half-band taps at odd offsets 1, 3, 5, 7 from the centre: a Blackman-windowed sinc, normalized for unit DC gain
  private static readonly C = (() => {
    const c = [0, 1, 2, 3].map((k) => {
      const m = 2 * k + 1;
      const w = 0.42 + 0.5 * Math.cos((Math.PI * m) / 8) + 0.08 * Math.cos((2 * Math.PI * m) / 8);
      return (Math.sin((Math.PI * m) / 2) / (Math.PI * m)) * w;
    });
    const s = c.reduce((a, b) => a + b, 0);
    return c.map((v) => v / (2 * s));
  })();
  private readonly x = new Float64Array(8);
  private readonly odd = new Float64Array(8);
  private readonly even = new Float64Array(4);
  private i = 0;

  run(input: number, f: (x: number) => number): number {
    const C = Oversampled.C;
    const x = this.x;
    const o = this.odd;
    const i = this.i;
    // newest input at x[i]; the midpoint between x[i-4] and x[i-3] from 4 inputs either side
    x[i & 7] = input;
    let mid = 0;
    for (let k = 0; k < 4; k++) mid += C[k] * (x[(i - 4 - k) & 7] + x[(i - 3 + k) & 7]);
    this.even[i & 3] = f(x[(i - 4) & 7]);
    o[i & 7] = f(mid);
    // decimate: the centre tap (1/2) on the even sample 3 steps back, the odd taps on the odd samples around it
    let y = 0.5 * this.even[(i - 3) & 3];
    for (let k = 0; k < 4; k++) y += 0.5 * C[k] * (o[(i - 4 - k) & 7] + o[(i - 3 + k) & 7]);
    this.i = i + 1;
    return y;
  }
}

/**
 * The BS.1770 K-weighting pair (a +4 dB high shelf, then a 38 Hz high-pass), designed for any sample rate
 * from the spec's analog parameters, as libebur128 and pyloudnorm do.
 */
function kWeighting(sr: number): [Biquad, Biquad] {
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let Q = 0.7071752369554196;
  let a0 = 1 + K / Q + K * K;
  const shelf = new Biquad(
    (Vh + (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q + K * K) / a0,
  );
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const hp = new Biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  return [shelf, hp];
}

/**
 * ITU-R BS.1770 integrated loudness in LUFS: K-weighting, mean square over 400 ms blocks every 100 ms, gated
 * at -70 LUFS, then at -10 LU. `end` limits the measured span.
 */
export function lufs(sr: number, l: Float32Array, r: Float32Array, end = l.length): number {
  const [sl, hl] = kWeighting(sr);
  const [sr_, hr] = kWeighting(sr);
  const hop = Math.round(0.1 * sr);
  const z: number[] = [];
  for (let i = 0; i < end; i++) {
    const yl = hl.run(sl.run(l[i]));
    const yr = hr.run(sr_.run(r[i]));
    if (i % hop === 0) z.push(0);
    z[z.length - 1] += yl * yl + yr * yr;
  }
  const lk = (x: number) => -0.691 + 10 * Math.log10(x);
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const blocks = z.slice(3).map((_, k) => (z[k] + z[k + 1] + z[k + 2] + z[k + 3]) / (4 * hop)).filter((x) =>
    lk(x) > -70
  );
  if (!blocks.length) return -Infinity;
  const gate = lk(mean(blocks)) - 10;
  const loud = blocks.filter((x) => lk(x) > gate);
  return loud.length ? lk(mean(loud)) : -Infinity;
}
/** Slow random wander: uniform white noise through two one-poles with coefficient k, scaled to unit rms. */
export class Wander {
  private a = 0;
  private b = 0;
  private readonly norm: number;
  constructor(private readonly k: number) {
    // noise power gain of k^2 / (1 - (1 - k) z^-1)^2, for input variance 1/3
    const p = 1 - k;
    this.norm = 1 / Math.sqrt((k ** 4 * (1 + p * p)) / (3 * (1 - p * p) ** 3));
  }
  next(white: number): number {
    this.a += (white - this.a) * this.k;
    this.b += (this.a - this.b) * this.k;
    return this.b * this.norm;
  }
}

/**
 * A compressor: `threshold` (dB, of the sidechain's rms over `rms` seconds: a few ms hears the body of a hit, a
 * fraction of one its crack), `ratio`, a soft `knee` (dB wide), the `attack` and `release` of its fast stage (s), and
 * `slow`, the release of its slow stage (s); `hp`, the corner (Hz) of a high-pass on the sidechain, so the lowest notes
 * don't ride the gain (0: none).
 */
export interface Comp {
  threshold: number;
  rms: number;
  ratio: number;
  knee: number;
  attack: number;
  release: number;
  slow: number;
  hp: number;
}
/** The slow stage's attack: it only takes hold of compression that lasts. */
const SLOW_ATTACK = 0.4;
/** How many seconds of a section's start the slow stage is wound up on (see compress()). */
const PRIME = 2;

/**
 * A feed-forward compressor's gain curve for the stereo signal `L`, `R` (linked, as a bus compressor is): the static
 * soft-knee curve in dB (Giannoulis, Massberg and Reiss, "Digital dynamic range compressor design", JAES 2012) on the
 * rms of the sidechain, smoothed in dB by two stages: a fast one for the hits and a slow one for what lasts, the deeper
 * of the two winning. So the release is program-dependent, as a console's auto release is: quick after a hit, slow
 * after a long loud passage, with no pumping under a sustained wall. The slow stage starts where running backwards
 * over the first seconds leaves it: a section that starts loud starts compressed instead of ducking in once its attack
 * catches up.
 */
export function compress(sr: number, L: Float32Array, R: Float32Array, c: Comp): Float32Array {
  const n = Math.min(L.length, R.length);
  const target = new Float32Array(n);
  const f = c.hp > 0 ? [new SVF(sr, c.hp, 0.7), new SVF(sr, c.hp, 0.7)] : null;
  const k = 1 - Math.exp(-1 / (c.rms * sr));
  const { threshold: T, knee: W } = c;
  const slope = 1 / c.ratio - 1;
  let ms = 0;
  for (let i = 0; i < n; i++) {
    let l = L[i];
    let r = R[i];
    if (f) {
      f[0].run(l);
      f[1].run(r);
      l = f[0].hp;
      r = f[1].hp;
    }
    ms += k * ((l * l + r * r) / 2 - ms);
    const over = 10 * Math.log10(ms + 1e-20) - T;
    target[i] = 2 * over < -W ? 0 : 2 * over > W ? slope * over : (slope * (over + W / 2) ** 2) / (2 * W);
  }
  const co = (s: number) => Math.exp(-1 / (s * sr));
  const [fa, fr, sa, sl] = [co(c.attack), co(c.release), co(SLOW_ATTACK), co(c.slow)];
  let fast = 0;
  let slow = 0;
  const step = (g: number) => {
    fast = g < fast ? fa * fast + (1 - fa) * g : fr * fast + (1 - fr) * g;
    slow = g < slow ? sa * slow + (1 - sa) * g : sl * slow + (1 - sl) * g;
  };
  // the slow stage wound up on the first seconds, the fast one from it: the first hit meets the compressor as a later
  // one does (winding up the fast one too would take the first hit down before it came)
  for (let i = Math.min(n, Math.round(PRIME * sr)) - 1; i >= 0; i--) step(target[i]);
  fast = slow;
  for (let i = 0; i < n; i++) {
    step(target[i]);
    target[i] = 10 ** (Math.min(fast, slow) / 20);
  }
  return target;
}

/** `f` applied at twice the rate (see Oversampled) to `x` times `gain`, into `out`, on time (its latency taken out). */
export function oversampled(x: Float32Array, f: (x: number) => number, gain = 1, out = x): Float32Array {
  const os = new Oversampled();
  const n = Math.min(x.length, out.length);
  for (let i = 0; i < n + OVERSAMPLED_LAG; i++) {
    const y = os.run(i < n ? x[i] * gain : 0, f);
    if (i >= OVERSAMPLED_LAG) out[i - OVERSAMPLED_LAG] = y;
  }
  return out;
}
/** Samples an Oversampled's output lags its input. */
const OVERSAMPLED_LAG = 7;

/**
 * A soft clipper: the level passes untouched up to `knee`, and above it bends smoothly (a tanh from the knee, slope
 * continuous) up to `ceil`. Run at twice the rate (see Oversampled), it rounds the fastest peaks as tape and a console
 * driven hard do, so the limiter after it has less to do.
 */
export function clipper(knee: number, ceil: number): (x: number) => number {
  const room = ceil - knee;
  return (x) => {
    const a = x < 0 ? -x : x;
    if (a <= knee) return x;
    const y = knee + room * softClip((a - knee) / room);
    return x < 0 ? -y : y;
  };
}
