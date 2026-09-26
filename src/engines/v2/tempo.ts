// Tempo that breathes. A sequencer's clock never moves; a band's does, in three ways modelled here. A phrase
// presses on towards its middle and relaxes into its end (rubato: the phrase arch of the KTH performance
// rules, Friberg, Bresin and Sundberg, 2006). The band pushes into its biggest parts and settles back after
// them. And a piece that ends slows into its last beat the way a runner comes to a stop (the final ritardando
// of Friberg and Sundberg, "Does music performance allude to locomotion?", 1999). A section's curve is fixed
// by the plan, so its length is known before a note of it is written, and every part follows the same curve.

import { hash32, Rng } from './rng.ts';
import { STYLES } from './styles.ts';
import { type Movement, type Role, type SectionDef, stepsPerBar } from './types.ts';

/** Seconds of one bar at the movement's steady tempo. */
export const barSeconds = (mv: Pick<Movement, 'bpm' | 'meter'>) => (stepsPerBar(mv.meter) * 15) / mv.bpm;

/** What a movement's tempo curve depends on. */
export type Paced = Pick<Movement, 'style' | 'bpm' | 'meter' | 'seed' | 'transition'> & {
  sections: readonly Pick<SectionDef, 'role' | 'bars' | 'energy'>[];
};

const CALM: ReadonlySet<Role> = new Set(['intro', 'outro', 'break', 'bridge']);
/**
 * Rubato works on phrases inside phrases: each 4-bar phrase has its arch, and so does each 8-bar one (a little
 * shallower), so a player slows most where a long phrase ends. [bars, share of the style's depth].
 */
const PHRASES = [[4, 1], [8, 0.6]] as const;
/** Where a phrase's arch turns: past its middle, so a player presses on for longer than they relax. */
const TURN = 0.6;
/** A phrase's arch, 0 at its ends and 1 at its turn; its mean over the phrase is 2/3. */
const arch = (x: number) => 1 - ((x - TURN) / (x < TURN ? TURN : 1 - TURN)) ** 2;
/** Bars the band takes to push into a bigger part, or to settle after one; and to slow into the end. */
const RAMP = 2;

/** Tempo as a multiple of the movement's, `b` bars into section `local`. */
export function tempoAt(mv: Paced, local: number, b: number): number {
  const { rubato, push, rit } = STYLES[mv.style].tempo;
  const secs = mv.sections;
  const sec = secs[local];
  if (sec.role === 'rest' || !(rubato || push || rit)) return 1;
  const level = (k: number) => {
    const s = secs[k];
    return !s || s.role === 'rest' ? null : 1 + push * Math.max(0, (s.energy - 0.5) / 0.5);
  };
  let m = level(local)!;
  const ramp = Math.min(RAMP, sec.bars / 2);
  const prev = level(local - 1);
  const next = level(local + 1);
  if (prev !== null && prev > m && b < ramp) m = prev + (m - prev) * (b / ramp);
  if (next !== null && next > m && b > sec.bars - ramp) m += (next - m) * ((b - (sec.bars - ramp)) / ramp);

  if (rubato) {
    // a phrase starts and ends slower than it runs in its middle; no two phrases are shaped alike
    for (const [bars, share] of PHRASES) {
      const p = Math.min(Math.floor(b / bars), Math.ceil(sec.bars / bars) - 1);
      const x = Math.min(1, (b - p * bars) / Math.min(bars, sec.bars - p * bars));
      const depth = rubato * share * (CALM.has(sec.role) ? 1 : 0.5) *
        new Rng(hash32(mv.seed, local, p, bars, 0x72756261)).range(0.6, 1.4);
      m *= 1 + depth * (arch(x) - 2 / 3);
    }
  }

  let last = secs.length - 1;
  if (secs[last].role === 'rest') last--;
  if (rit && local === last && (mv.transition === 'pause' || mv.transition === 'fade')) {
    const span = Math.min(RAMP, sec.bars);
    const x = (b - (sec.bars - span)) / span;
    // constant braking: v = (1 + (w^2 - 1) x)^(1/2), down to w of the tempo
    if (x > 0) m *= Math.sqrt(1 + ((1 - rit) ** 2 - 1) * Math.min(1, x));
  }
  return m;
}

/**
 * A section's clock: maps written time (seconds at the movement's tempo, as the parts are written) to the time
 * the band plays it at. Tempo is sampled every 16th and integrated; past the end it runs on at the last tempo.
 */
export class Clock {
  /** Real seconds of the whole section. */
  readonly duration: number;
  private readonly cum: Float64Array | null;
  private readonly step: number;
  private readonly end: number;

  constructor(mv: Paced, local: number) {
    const bars = mv.sections[local].bars;
    const written = bars * barSeconds(mv);
    const n = Math.max(1, Math.ceil(bars * 16));
    const m = Array.from({ length: n + 1 }, (_, k) => tempoAt(mv, local, (k / n) * bars));
    this.step = written / n;
    this.end = m[n];
    if (m.every((x) => x === 1)) {
      this.cum = null;
      this.duration = written;
      return;
    }
    const cum = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) cum[k + 1] = cum[k] + (this.step * (1 / m[k] + 1 / m[k + 1])) / 2;
    this.cum = cum;
    this.duration = cum[n];
  }

  /** Whether the tempo stays exactly the movement's: written time is real time. */
  get steady(): boolean {
    return this.cum === null;
  }

  /** Real seconds from the section start of written time `t`. */
  at(t: number): number {
    const cum = this.cum;
    if (!cum || t <= 0) return t;
    const n = cum.length - 1;
    const x = t / this.step;
    if (x >= n) return cum[n] + (t - n * this.step) / this.end;
    const k = Math.floor(x);
    return cum[k] + (x - k) * (cum[k + 1] - cum[k]);
  }

  /** The inverse of at(): the written time played `t` real seconds into the section. */
  written(t: number): number {
    const cum = this.cum;
    if (!cum || t <= 0) return t;
    const n = cum.length - 1;
    if (t >= cum[n]) return n * this.step + (t - cum[n]) * this.end;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= t) lo = mid;
      else hi = mid;
    }
    return (lo + (t - cum[lo]) / (cum[lo + 1] - cum[lo])) * this.step;
  }
}
