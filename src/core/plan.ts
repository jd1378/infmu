// The song plan: an endless chain of movements, each a small piece in one style and key. Movement m depends
// only on the seed and movement m-1 (for its key and style), so any point in the song can be reached by
// planning the movements before it, which costs microseconds each. No audio is involved here.

import { hash32, Rng } from './rng.ts';
import { movementTitle, normalizeSeed, seedNumber } from './seed.ts';
import { type ProgChord, PROGRESSIONS, sectionsFor, STYLE_IDS, STYLES } from './styles.ts';
import { type ChordSpec, type Key, mod } from './theory.ts';
import type { Movement, StyleId } from './types.ts';

const MODULATIONS: readonly (readonly [number, number])[] = [
  [7, 4],
  [5, 4],
  [2, 3],
  [-2, 2],
  [3, 2],
  [-3, 2],
  [4, 1],
  [0, 2],
];

export interface SectionRef {
  index: number;
  movement: Movement;
  local: number;
  /** Seconds from the start of the movement. */
  offset: number;
  duration: number;
}

export class Song {
  readonly phrase: string;
  readonly seed: number;
  readonly styles: readonly StyleId[];
  private readonly movements: Movement[] = [];

  constructor(phrase: string, styles: readonly StyleId[] = STYLE_IDS) {
    this.phrase = normalizeSeed(phrase);
    this.seed = seedNumber(this.phrase);
    const allowed = STYLE_IDS.filter((s) => styles.includes(s));
    this.styles = allowed.length ? allowed : STYLE_IDS;
  }

  movement(m: number): Movement {
    if (m < 0 || !Number.isInteger(m)) throw new RangeError(`bad movement index ${m}`);
    while (this.movements.length <= m) this.movements.push(this.plan(this.movements.length));
    return this.movements[m];
  }

  /** The section with global index `i`. */
  section(i: number): SectionRef {
    if (i < 0 || !Number.isInteger(i)) throw new RangeError(`bad section index ${i}`);
    let m = 0;
    // movements have 5-8 sections; jump close before walking
    if (this.movements.length) {
      const last = this.movements[this.movements.length - 1];
      m = i >= last.firstSection ? this.movements.length - 1 : this.findMovement(i);
    }
    let mv = this.movement(m);
    while (i >= mv.firstSection + mv.sections.length) mv = this.movement(++m);
    const local = i - mv.firstSection;
    return { index: i, movement: mv, local, offset: sectionOffset(mv, local), duration: sectionDuration(mv, local) };
  }

  /** Global section index and offset into it for time `t` inside movement `m` (clamped to the movement). */
  locate(m: number, t: number): { index: number; offset: number } {
    const mv = this.movement(m);
    let rest = Math.min(Math.max(0, t), mv.duration - 1e-3);
    for (let s = 0; s < mv.sections.length; s++) {
      const d = sectionDuration(mv, s);
      if (rest < d || s === mv.sections.length - 1) return { index: mv.firstSection + s, offset: Math.min(rest, d) };
      rest -= d;
    }
    return { index: mv.firstSection, offset: 0 };
  }

  private findMovement(i: number): number {
    let lo = 0;
    let hi = this.movements.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.movements[mid].firstSection <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private plan(m: number): Movement {
    const prev = m > 0 ? this.movements[m - 1] : null;
    const rng = new Rng(hash32(this.seed, m, 0x6d6f76));
    const pick = rng.fork('style');

    let styleId: StyleId;
    if (!prev) styleId = pick.pick(this.styles);
    else {
      const options = STYLES[prev.style].next.filter(([s]) => this.styles.includes(s));
      styleId = options.length ? pick.weighted(options) : prev.style;
    }
    const style = STYLES[styleId];

    const keyRng = rng.fork('key');
    const tonic = prev ? mod(prev.key.tonic + keyRng.weighted(MODULATIONS), 12) : keyRng.int(12);
    let mode = keyRng.weighted(style.modes);
    if (prev && prev.key.tonic === tonic && prev.key.mode === mode) mode = keyRng.weighted(style.modes);
    const key: Key = { tonic, mode };

    const bpm = Math.round(rng.fork('bpm').range(style.bpm[0], style.bpm[1] + 1) - 0.5);
    const swing = rng.fork('swing').range(style.swing[0], style.swing[1]);
    const sections = sectionsFor(style, rng.fork('form').pick(style.forms));
    const bar = (4 * 60) / bpm;
    const duration = sections.reduce((s, x) => s + x.bars * bar, 0);

    const h = rng.fork('harmony');
    const pool = PROGRESSIONS[mode];
    const size = h.weighted(style.chordSize);
    const toChords = (p: readonly ProgChord[]): ChordSpec[] =>
      p.map((c) => ({ deg: c.deg, size, alt: c.alt, sus: !c.alt && h.chance(style.sus2) ? 2 : undefined }));
    const main = h.pick(pool);
    const lift = h.chance(0.45) ? main : h.pick(pool);
    const alt = h.pick(pool);

    const t = rng.fork('tone');
    const tone = {
      bright: t.range(0.8, 1.25),
      detune: t.range(0.75, 1.35),
      fmRatio: t.pick([3.4, 3.5, 2, 1.4, 4, 5.19]),
      vibrato: t.range(0.6, 1.3),
      crackle: t.range(style.crackle[0], style.crackle[1]),
      wow: t.range(style.wow[0], style.wow[1]),
    };
    const x = rng.fork('mix');
    const mix = {
      room: x.range(style.room[0], style.room[1]),
      reverb: x.range(style.reverb[0], style.reverb[1]),
      delayBeats: x.pick(style.delayBeats),
      delayFeedback: x.range(style.delayFeedback[0], style.delayFeedback[1]),
      delayWet: x.range(style.delayWet[0], style.delayWet[1]),
    };

    return {
      index: m,
      seed: hash32(this.seed, m),
      title: movementTitle(rng.fork('title')),
      style: styleId,
      key,
      bpm,
      swing,
      sections,
      firstSection: prev ? prev.firstSection + prev.sections.length : 0,
      startTime: prev ? prev.startTime + prev.duration : 0,
      duration,
      progressions: { main: toChords(main), lift: toChords(lift), alt: toChords(alt) },
      tone,
      mix,
      transition: rng.fork('transition').weighted(style.transitions),
    };
  }
}

export const barSeconds = (mv: Movement) => (4 * 60) / mv.bpm;
export const sectionDuration = (mv: Movement, local: number) => mv.sections[local].bars * barSeconds(mv);
export function sectionOffset(mv: Movement, local: number): number {
  let bars = 0;
  for (let s = 0; s < local; s++) bars += mv.sections[s].bars;
  return bars * barSeconds(mv);
}
