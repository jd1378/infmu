// Two voices built on filters: a choir (detuned saws through the formants of a sung vowel) and an acid
// line (one saw or square through a resonant low-pass whose envelope snaps on every note, as on a TB-303).

import type { Ev, Vowel } from '../types.ts';
import type { Bus } from './bus.ts';
import { pan, saw, smooth, SVF, TAU } from './dsp.ts';

type E<K extends Ev['i']> = Extract<Ev, { i: K }>;
const { exp, sin, min, max, sqrt, round, tanh } = Math;

// formant frequency, gain, resonance of a soprano/alto section singing each vowel
const FORMANTS: Record<Vowel, readonly (readonly [number, number, number])[]> = {
  a: [[800, 1, 5], [1150, 0.5, 7], [2900, 0.22, 10], [3900, 0.08, 12]],
  o: [[450, 1, 5], [800, 0.45, 7], [2830, 0.1, 10]],
  u: [[325, 1, 5], [700, 0.3, 7], [2530, 0.07, 10]],
  // a hum: lips closed, the sound comes out of the nose, a strong low murmur and little above it
  m: [[270, 1, 4], [1050, 0.06, 6], [2200, 0.03, 8]],
};

export function choir(b: Bus, e: E<'choir'>): void {
  const sr = b.sr;
  const voices: { ph: number; inc: number; l: number; r: number; lfo: number }[] = [];
  e.n.forEach((m, k) => {
    for (const cents of [-7, 0, 7]) {
      const [l, r] = pan(((k % 2 ? 1 : -1) * 0.4 + cents / 20) * 0.9);
      voices.push({ ph: b.noise.unit(), inc: (b.hz(m) * 2 ** (cents / 1200)) / sr, l, r, lfo: TAU * b.noise.unit() });
    }
  });
  const bank = FORMANTS[e.vowel].map(([f, g, q]) => [new SVF(sr, f, q), new SVF(sr, f, q), g] as const);
  const g = ((e.g ?? 1) * 0.1) / sqrt(voices.length);
  const att = 0.7 * sr;
  const on = e.d * sr;
  const rel = 1.4 * sr;
  const i0 = round(e.t * sr);
  const len = min(b.n - i0, round(on + rel));
  const cur = voices.map((v) => v.inc);
  for (let j = 0; j < len; j++) {
    if ((j & 63) === 0) {
      // a section doesn't sing a straight tone: each voice drifts with its own slow vibrato
      const t = j / sr;
      const depth = 9 * smooth((t - 0.4) / 1.5);
      for (let k = 0; k < voices.length; k++) {
        cur[k] = voices[k].inc * 2 ** ((depth * sin(TAU * 5 * t + voices[k].lfo)) / 1200);
      }
    }
    let sl = 0;
    let sr_ = 0;
    for (let k = 0; k < voices.length; k++) {
      const v = voices[k];
      v.ph += cur[k];
      if (v.ph >= 1) v.ph -= 1;
      const x = saw(v.ph, cur[k]);
      sl += x * v.l;
      sr_ += x * v.r;
    }
    const breath = b.noise.next() * 0.04;
    let yl = 0;
    let yr = 0;
    for (const [fl, fr, fg] of bank) {
      fl.run(sl + breath);
      fr.run(sr_ + breath);
      yl += fl.bp * fg;
      yr += fr.bp * fg;
    }
    const i = i0 + j;
    const env = smooth(j / att) * (j > on ? exp((-6.9 * (j - on)) / rel) : 1) * g;
    const d = env * (1 - 0.2 * (1 - b.duck[i]));
    b.ML[i] += yl * d;
    b.MR[i] += yr * d;
    b.REV[i] += (yl + yr) * env * 0.55;
  }
}

/**
 * Acid: a single oscillator into a resonant low-pass (two state-variable stages, the first one ringing)
 * whose cutoff jumps on each note and decays; accents hit harder with a sharper, brighter envelope; a slide
 * glides into the next note without retriggering. The base cutoff moves across the phrase (cut[0] -> cut[1]).
 */
export function acid(b: Bus, e: E<'acid'>): void {
  const ns = e.ns;
  if (!ns.length) return;
  const sr = b.sr;
  const f1 = new SVF(sr, 500, 1 + 11 * e.res);
  const f2 = new SVF(sr, 500, 0.7);
  const first = ns[0].t;
  const last = ns[ns.length - 1];
  const i0 = round(first * sr);
  const i1 = min(b.n, round((last.t + last.d + 0.25) * sr));
  const span = max(1e-3, last.t + last.d - first);
  const glide = 1 - exp(-1 / (0.045 * sr));
  const attack = 1 - exp(-1 / (0.001 * sr));
  const release = 1 - exp(-1 / (0.005 * sr));
  let k = 0;
  let pitch = ns[0].n;
  let ph = 0;
  let amp = 0;
  let env = 0;
  let lastNote = -1;
  for (let i = i0; i < i1; i++) {
    const t = i / sr;
    while (k + 1 < ns.length && t >= ns[k + 1].t) k++;
    const nt = ns[k];
    const u = t - nt.t;
    const tied = k > 0 && ns[k - 1].slide;
    if (k !== lastNote) {
      lastNote = k;
      if (!tied) env = 1; // a slide doesn't re-strike the filter
    }
    pitch = tied ? pitch + (nt.n - pitch) * glide : nt.n;
    const inc = b.hz(pitch) / sr;
    ph += inc;
    if (ph >= 1) ph -= 1;
    const osc = e.square ? saw(ph, inc) - saw(ph >= 0.5 ? ph - 0.5 : ph + 0.5, inc) : saw(ph, inc);
    env *= exp(-1 / ((nt.accent ? 0.12 : 0.2) * sr));
    if ((i & 15) === 0) {
      const base = e.cut[0] * (e.cut[1] / e.cut[0]) ** min(1, (t - first) / span);
      const c = min(sr * 0.42, base * (1 + e.env * env * (nt.accent ? 5 : 3)));
      f1.set(c);
      f2.set(c);
    }
    // a slide holds the gate open into the next note; the last note has none to slide into
    const held = nt.slide && k + 1 < ns.length;
    const gate = u < nt.d * 0.92 || held ? (nt.accent ? 1.35 : 1) : 0;
    amp += (gate - amp) * (gate > amp ? attack : release);
    const y = tanh(1.8 * f2.run(f1.run(osc))) * amp * 0.24;
    const d = 1 - 0.5 * (1 - b.duck[i]);
    b.ML[i] += y * d * 0.92;
    b.MR[i] += y * d;
    b.REV[i] += y * 0.12;
    b.DLY[i] += y * 0.15;
  }
}

// ------------------------------------------------------------------ winds

/**
 * Flute, saxophone and a hummed voice, played legato over a phrase like a player on one breath.
 * Hum: a soft glottal source (a saw rounded off by a low-pass), the nasal murmur resonance near 270 Hz and
 * hardly anything above 1 kHz, the way a closed mouth sounds; a singer's vibrato and a little breath.
 * Flute: nearly a sine (a few weak harmonics), a breathy noise band around the note, and a chiff of air at
 * each attack. Sax: a reedy saw whose brightness follows the breath (a low-pass that opens with loudness),
 * shaped by the horn's formants, with a slight scoop up into each new note and a growl of noise.
 * Both glide between notes and bloom into vibrato on long ones.
 */
export function wind(b: Bus, e: E<'wind'>): void {
  const ns = e.ns;
  if (!ns.length) return;
  const sr = b.sr;
  const sax = e.k === 'sax';
  const hum = e.k === 'hum';
  const last = ns[ns.length - 1];
  const i0 = round(ns[0].t * sr);
  const i1 = min(b.n, round((last.t + last.d + 0.3) * sr));
  const glide = 1 - exp(-1 / ((sax ? 0.03 : 0.05) * sr));
  const ka = 1 - exp(-1 / ((sax ? 0.035 : 0.06) * sr));
  const kr = 1 - exp(-1 / (0.07 * sr));
  // flute: the breath sits in bands around the first two harmonics
  const air = [new SVF(sr, 440, 8), new SVF(sr, 880, 8)];
  const hiss = new SVF(sr, 3000, 0.7);
  // sax: brightness follows the breath, then the horn's formants
  const tone = new SVF(sr, 1500, 0.8);
  const horn = ([[550, 3, 1], [1400, 4, 0.6], [2700, 6, 0.25]] as const).map(([f, q, g]) =>
    [new SVF(sr, f, q), g] as const
  );
  const growl = new SVF(sr, 30, 0.7);
  const glottis = new SVF(sr, 900, 0.6);
  const nose = new SVF(sr, 270, 4);
  const lips = new SVF(sr, 1400, 0.7);
  let k = 0;
  let pitch = ns[0].n;
  let ph = 0;
  let amp = 0;
  let lastNote = -1;
  let scoop = 0;
  for (let i = i0; i < i1; i++) {
    const t = i / sr;
    while (k + 1 < ns.length && t >= ns[k + 1].t) k++;
    const nt = ns[k];
    const u = t - nt.t;
    if (k !== lastNote) {
      // a fresh breath (after a rest) scoops up from below; a legato note just glides
      const legato = k > 0 && ns[k - 1].t + ns[k - 1].d >= nt.t - 0.01;
      if (!legato) scoop = sax ? -1 : hum ? -0.5 : 0;
      lastNote = k;
    }
    const on = u < nt.d * 0.94;
    amp += ((on ? nt.v : 0) - amp) * (on ? ka : kr);
    pitch += (nt.n - pitch) * glide;
    scoop *= 1 - 1 / (0.05 * sr);
    const vib = (sax ? 0.22 : hum ? 0.25 : 0.16) * smooth((u - 0.25) / 0.4) * sin(TAU * (sax ? 5.4 : 5.1) * t);
    const f = b.hz(pitch + vib + scoop);
    const inc = f / sr;
    ph += inc;
    if (ph >= 1) ph -= 1;
    let y: number;
    if (hum) {
      if ((i & 63) === 0) {
        glottis.set(min(2400, f * 4));
        nose.set(max(270, f * 1.05), 3);
        lips.set(max(1400, f * 2.5));
      }
      const src = glottis.run(saw(ph, inc));
      nose.run(src);
      const breathy = b.noise.next() * 0.015;
      y = lips.run(src * 0.35 + nose.bp * 1.4 + breathy) * amp * 0.07;
    } else if (sax) {
      if ((i & 15) === 0) tone.set(min(7000, f * (1.5 + 9 * amp)));
      const src = tone.run(saw(ph, inc));
      let s = 0.3 * src;
      for (const [fl, g] of horn) {
        fl.run(src);
        s += fl.bp * g;
      }
      // growl: a slow, rough wobble of the reed (low-passed noise)
      const rough = growl.run(b.noise.next());
      y = tanh(1.4 * s * (1 + 4 * rough)) * amp * 0.15;
    } else {
      const p = TAU * ph;
      if ((i & 63) === 0) {
        air[0].set(f);
        air[1].set(2 * f);
      }
      const noise = b.noise.next();
      air[0].run(noise);
      air[1].run(noise);
      hiss.run(noise);
      const body = sin(p) + 0.22 * sin(2 * p) + 0.09 * sin(3 * p) + 0.04 * sin(4 * p);
      const breath = (air[0].bp + 0.6 * air[1].bp) * 0.6 + hiss.hp * 0.05;
      const chiff = 0.5 * exp(-u / 0.03) * (u < nt.d ? 1 : 0);
      y = (body * 0.85 + breath * (0.35 + chiff)) * amp * 0.2;
    }
    const d = 1 - 0.3 * (1 - b.duck[i]);
    b.ML[i] += y * d * 0.96;
    b.MR[i] += y * d;
    b.REV[i] += y * (sax ? 0.3 : hum ? 0.45 : 0.4);
    b.DLY[i] += y * (sax ? 0.15 : 0.22);
  }
}
