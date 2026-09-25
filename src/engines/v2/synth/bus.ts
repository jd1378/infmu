import type { Tone } from '../types.ts';
import { Noise, pan, TAU } from './dsp.ts';

/**
 * The mix buses of one section render: main (L/R, not pumped), music (ML/MR, pumped by the kick's
 * sidechain), and the reverb and echo sends.
 */
export class Bus {
  readonly sr: number;
  readonly n: number;
  readonly L: Float32Array;
  readonly R: Float32Array;
  readonly ML: Float32Array;
  readonly MR: Float32Array;
  readonly REV: Float32Array;
  readonly DLY: Float32Array;
  /** Overdriven guitars, summed before the amp so chords distort together. */
  readonly AMP: Float32Array;
  ampUsed = false;
  /** Gain curve of the kick's pump, 1 = untouched. */
  duck: Float32Array;
  readonly noise: Noise;
  readonly tone: Tone;
  /** Concert pitch: the frequency of A4 every note is tuned from. */
  readonly a4: number;
  private readonly wowCurve: Float32Array | null;
  /** Rendered drum hits by kind: a drum machine plays the same sample every time, and so can we. */
  private readonly protos = new Map<string, Float32Array>();

  constructor(sr: number, seconds: number, noiseSeed: number, tone: Tone, a4 = 440) {
    this.sr = sr;
    this.a4 = a4;
    this.n = Math.round(seconds * sr);
    [this.L, this.R, this.ML, this.MR, this.REV, this.DLY, this.AMP] = [0, 0, 0, 0, 0, 0, 0].map(() =>
      new Float32Array(this.n)
    );
    this.duck = new Float32Array(this.n).fill(1);
    this.noise = new Noise(noiseSeed);
    this.tone = tone;
    const w = tone.wow;
    this.wowCurve = w
      ? Float32Array.from({ length: this.n }, (_, i) => {
        const t = i / sr;
        return 1 + w * (0.0022 * Math.sin(TAU * 0.5 * t + 1.3) + 0.0007 * Math.sin(TAU * 3.1 * t));
      })
      : null;
  }

  /** Frequency of MIDI note `m` (fractional for glides and vibrato) at this bus's concert pitch. */
  hz(m: number): number {
    return this.a4 * 2 ** ((m - 69) / 12);
  }

  /** Tape wow: a slow pitch wander, as a frequency multiplier at time t. */
  wow(t: number): number {
    const c = this.wowCurve;
    return c ? c[Math.min(this.n - 1, Math.max(0, Math.round(t * this.sr)))] : 1;
  }

  /**
   * A mono voice: fn(j, u) gives sample j (u in seconds); 1 ms in, 10 ms out, panned, with sends.
   * duck > 0 puts it on the music bus, pumped by the kick that much.
   */
  voice(t: number, sec: number, fn: (j: number, u: number) => number, p = 0, rv = 0, dl = 0, duck = 0): void {
    const len = Math.min(this.n - Math.round(t * this.sr), Math.round(sec * this.sr));
    if (len > 0) this.place(this.mono(len, fn), t, 1, p, rv, dl, duck);
  }

  /**
   * Like voice(), but renders the sound once per `key` and replays it scaled by `gain`. Only for sounds that
   * are linear in their velocity.
   */
  hit(
    key: string,
    t: number,
    sec: number,
    make: () => (j: number, u: number) => number,
    gain: number,
    p = 0,
    rv = 0,
    dl = 0,
    duck = 0,
  ): void {
    let proto = this.protos.get(key);
    if (!proto) {
      proto = this.mono(Math.round(sec * this.sr), make());
      this.protos.set(key, proto);
    }
    this.place(proto, t, gain, p, rv, dl, duck);
  }

  private mono(len: number, fn: (j: number, u: number) => number): Float32Array {
    const sr = this.sr;
    const out = new Float32Array(len);
    const fin = 0.001 * sr;
    const fout = 0.01 * sr;
    for (let j = 0; j < len; j++) out[j] = fn(j, j / sr) * Math.min(1, j / fin, (len - j) / fout);
    return out;
  }

  private place(x: Float32Array, t: number, gain: number, p: number, rv: number, dl: number, duck: number): void {
    const i0 = Math.round(t * this.sr);
    const len = Math.min(this.n - i0, x.length);
    const [a, b] = pan(p);
    const oL = duck ? this.ML : this.L;
    const oR = duck ? this.MR : this.R;
    for (let j = 0; j < len; j++) {
      const s = x[j] * gain;
      const i = i0 + j;
      const d = Math.SQRT2 * (1 - duck * (1 - this.duck[i]));
      oL[i] += s * a * d;
      oR[i] += s * b * d;
      this.REV[i] += s * rv;
      this.DLY[i] += s * dl;
    }
  }
}
