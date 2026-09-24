// DSP building blocks. Adapted from EX NIHILO's synth (github.com/ErwannRobin/ex-nihilo), made reentrant:
// every piece of state lives in an object, so several sections can render side by side in workers.

export const TAU = 2 * Math.PI;
export const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
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

/** A biquad in transposed direct form II. */
class Biquad {
  private z1 = 0;
  private z2 = 0;
  private readonly c: readonly number[];
  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.c = [b0, b1, b2, a1, a2];
  }
  run(x: number): number {
    const [b0, b1, b2, a1, a2] = this.c;
    const y = b0 * x + this.z1;
    this.z1 = b1 * x - a1 * y + this.z2;
    this.z2 = b2 * x - a2 * y;
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
