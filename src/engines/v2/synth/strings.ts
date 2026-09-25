// Plucked strings by Karplus-Strong: a burst of noise circulates in a delay line one period long, and a
// gentle low-pass in the loop lets the highs die first, the way a real string's do. An allpass in the
// loop supplies the fraction of a sample the period needs, so high notes stay in tune.
//
// Acoustic guitar and harp ring through a body filter. Electric guitars are brighter and longer, heard
// through a pickup (a comb from where it sits under the string); the overdriven one is summed on the amp
// bus, so a chord distorts as a whole the way it does through a real amp.

import type { Ev } from '../types.ts';
import type { Bus } from './bus.ts';
import { mtof, SVF } from './dsp.ts';

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;

export function string(b: Bus, e: E<'string'>): void {
  const sr = b.sr;
  const f = mtof(e.n);
  const harp = e.k === 'harp';
  const electric = e.k === 'electric' || e.k === 'overdrive';
  // loop filter y = (1 - s)·x + s·x[-1]: more s, darker and shorter; its delay is s samples
  const s = harp ? 0.3 : electric ? 0.22 : 0.5;
  const period = sr / f - s;
  if (period < 3) return;
  const N = Math.floor(period - 0.1);
  const frac = period - N;
  const C = (1 - frac) / (1 + frac);
  const t60 = (harp ? 4 : electric ? 5 : 2.6) * Math.pow(196 / f, 0.35);
  const loss = 10 ** (-3 / (t60 * f));
  const muted = 10 ** (-3 / (0.12 * f)); // a hand on the string after note-off

  const buf = new Float32Array(N);
  const bright = (harp ? 0.55 : electric ? 0.7 : 0.3) + 0.3 * e.v;
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < N; i++) {
    lp += bright * (b.noise.next() - lp);
    buf[i] = lp;
    mean += lp;
  }
  mean /= N;
  let peak = 1e-9;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i] -= mean));
  for (let i = 0; i < N; i++) buf[i] *= 0.8 / peak;

  const d = e.d ?? Infinity;
  const body = harp || electric ? null : new SVF(sr, 3200, 0.6);
  const pickup = Math.max(1, Math.round(N * 0.18));
  let idx = 0;
  let prev = 0;
  let apx = 0;
  let apy = 0;
  const tick = (u: number): number => {
    const x = buf[idx];
    const picked = electric ? x - 0.55 * buf[(idx - pickup + N) % N] : x;
    const avg = (1 - s) * x + s * prev;
    prev = x;
    const ap = C * avg + apx - C * apy;
    apx = avg;
    apy = ap;
    buf[idx] = ap * (u < d ? loss : muted);
    idx = idx + 1 < N ? idx + 1 : 0;
    return body ? body.run(picked) : picked;
  };
  const len = Math.min(t60 * 1.1, d + 0.4);
  if (e.k === 'overdrive') {
    // dry into the amp bus; the amp in the master adds drive, cabinet and room
    const i0 = Math.round(e.t * sr);
    const n = Math.min(b.n - i0, Math.round(len * sr));
    for (let j = 0; j < n; j++) b.AMP[i0 + j] += tick(j / sr) * e.v * Math.min(1, (n - j) / (0.01 * sr));
    b.ampUsed = true;
    return;
  }
  const g = e.v * (harp ? 0.95 : electric ? 0.8 : 1.1);
  b.voice(
    e.t,
    len,
    (_j, u) => tick(u) * g,
    e.p ?? Math.max(-0.5, Math.min(0.5, (e.n - 62) / 28)),
    harp ? 0.4 : 0.22,
    harp ? 0.15 : electric ? 0.3 : 0.12,
    0.3,
  );
}
