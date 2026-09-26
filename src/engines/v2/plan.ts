// The song plan: an endless chain of movements, each a small piece in one style and key. Movement m depends
// only on the seed and the few movements before it (for its key, and for what it should not repeat), so any
// point in the song can be reached by planning the movements before it, which costs microseconds each. No
// audio is involved here.

import { hash32, Rng } from './rng.ts';
import { movementTitle, normalizeSeed, seedNumber } from './seed.ts';
import { type ProgChord, PROGRESSIONS, ROLE_ENERGY, STYLE_IDS, type StyleDef, STYLES } from './styles.ts';
import { barSeconds, Clock } from './tempo.ts';
import { type ChordSpec, type Key, mod } from './theory.ts';
import type { Movement, Role, SectionDef, StyleId, Transition } from './types.ts';

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
  readonly length: Length;
  private readonly movements: Movement[] = [];

  constructor(phrase: string, styles: readonly StyleId[] = STYLE_IDS, length: Length = 'standard') {
    this.length = length;
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

  /**
   * Where the journey can go after movement m - 1: the styles its style leads to naturally, and less often any
   * other the listener allowed, each weighed down by how recently it played. A listener who allowed one style
   * hears it every time.
   */
  private nextStyles(m: number): [StyleId, number][] {
    const prev = this.movements[m - 1];
    const near = new Map(STYLES[prev.style].next);
    const ago = (s: StyleId) => {
      for (let d = 1; d <= RECENT && m - d >= 0; d++) if (this.movements[m - d].style === s) return d;
      return Infinity;
    };
    const options = this.styles
      .map((s): [StyleId, number] => [s, (near.get(s) ?? ELSEWHERE) * (FRESH[ago(s) - 1] ?? 1)])
      .filter(([, w]) => w > 0);
    return options.length ? options : [[prev.style, 1]];
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

    const styleId: StyleId = prev ? pick.weighted(this.nextStyles(m)) : pick.pick(this.styles);
    const style = STYLES[styleId];
    const recent = this.movements.slice(Math.max(0, m - RECENT), m);
    const sameStyle = recent.filter((x) => x.style === styleId);

    const keyRng = rng.fork('key');
    // modulate from where the last movement ended, which is above its key if its last chorus lifted
    const heard = prev ? mod(prev.key.tonic + prev.sections[prev.sections.length - 1].shift, 12) : 0;
    const tonic = prev ? mod(heard + keyRng.weighted(MODULATIONS), 12) : keyRng.int(12);
    let mode = keyRng.weighted(style.modes);
    if (prev && heard === tonic && prev.key.mode === mode) mode = keyRng.weighted(style.modes);
    const key: Key = { tonic, mode };

    const meter = rng.fork('meter').weighted(style.meters);
    // bpm counts quarters; a 6/8 piece sways on its dotted quarters, at three quarters of the style's tempo
    const pulse = meter === '6/8' ? 1.5 * 0.75 : 1;
    // not the tempo of a piece of the same style (and time) heard lately
    const tempo = (k: number) => Math.round(pulse * (rng.fork('bpm', k).range(style.bpm[0], style.bpm[1] + 1) - 0.5));
    let bpm = tempo(0);
    for (let k = 1; k < 8 && sameStyle.some((x) => x.meter === meter && Math.abs(x.bpm - bpm) < 4); k++) {
      bpm = tempo(k);
    }
    const swing = rng.fork('swing').range(style.swing[0], style.swing[1]);
    const bar = barSeconds({ bpm, meter });
    // a piece rarely ends the way the one before it did
    let transition = rng.fork('transition').weighted(style.transitions);
    if (prev && transition === prev.transition) transition = rng.fork('transition', 1).weighted(style.transitions);
    const seed = hash32(this.seed, m);
    const form = planForm(style, rng.fork('form'), bar, transition, this.length);
    const paced = { style: styleId, bpm, meter, seed, transition, sections: form };
    const sections = form.map((s, k) => ({ ...s, seconds: new Clock(paced, k).duration }));
    const duration = sections.reduce((s, x) => s + x.seconds, 0);

    const h = rng.fork('harmony');
    // now and then a piece changes chords twice as often as its style does, or half as often
    const barsPerChord = rng.fork('harmonic rhythm').chance(0.25)
      ? (3 - style.barsPerChord) as 1 | 2
      : style.barsPerChord;
    // at two bars a chord an eight-chord phrase would outlast a section
    const pool = PROGRESSIONS[mode].filter((p) => barsPerChord === 1 || p.length === 4);
    const size = h.weighted(style.chordSize);
    const toChords = (p: readonly ProgChord[]): ChordSpec[] =>
      p.map((c) => ({
        deg: c.deg,
        size,
        alt: c.alt,
        shift: c.shift,
        sus: !c.alt && !c.shift && h.chance(style.sus2) ? 2 : undefined,
      }));
    // not the progression of a piece heard lately
    const heardProg = (p: readonly ProgChord[]) =>
      recent.some((x) =>
        x.key.mode === mode && x.progressions.main.map((c) => c.deg).join() === p.map((c) => c.deg).join()
      );
    let main = h.pick(pool);
    for (let k = 0; k < 6 && heardProg(main); k++) main = h.pick(pool);
    const lift = h.chance(0.45) ? main : h.pick(pool);
    const alt = h.pick(pool);
    // the bridge goes somewhere the other parts don't: a different progression, started from its middle
    const others = pool.filter((p) => p !== main && p !== lift);
    const bridgeSrc = others.length ? h.pick(others) : alt;
    const bridge = [...bridgeSrc.slice(2), ...bridgeSrc.slice(0, 2)];

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
      peak: style.dynamics[0],
      range: style.dynamics[1],
      drums: style.balance[0],
      bass: style.balance[1],
      ...style.record,
    };

    return {
      index: m,
      seed,
      title: movementTitle(rng.fork('title')),
      style: styleId,
      key,
      bpm,
      meter,
      swing,
      sections,
      firstSection: prev ? prev.firstSection + prev.sections.length : 0,
      startTime: prev ? prev.startTime + prev.duration : 0,
      duration,
      progressions: { main: toChords(main), lift: toChords(lift), alt: toChords(alt), bridge: toChords(bridge) },
      barsPerChord,
      tone,
      mix,
      transition,
    };
  }
}

/** How many movements back the journey remembers, so it doesn't repeat itself. */
const RECENT = 4;
/** A style heard d movements ago is this much less likely next (index d - 1); never the one just played. */
const FRESH = [0, 0.2, 0.45, 0.7];
/** Weight of a style its predecessor doesn't lead to naturally: the journey can still wander there. */
const ELSEWHERE = 0.3;

export { barSeconds };

/**
 * A movement's form, fitted to a target length of three to four minutes: optional steps are dropped from
 * the end backwards while it runs long, and the last big section is doubled while it runs short. Energy
 * grows a little each time a chorus or drop returns; the final chorus group may lift a key; a movement that
 * fades or pauses at its end gets a rest, so the end of a piece is heard as an end.
 */
/** How long a movement runs, in seconds. The listener picks one; it is part of the song, like the seed. */
export const LENGTHS = { short: [110, 150], standard: [185, 235], long: [290, 360] } as const;
export type Length = keyof typeof LENGTHS;

function planForm(
  style: StyleDef,
  rng: Rng,
  bar: number,
  transition: Transition,
  length: Length,
): Omit<SectionDef, 'seconds'>[] {
  const steps = rng.pick(style.forms).split(' ').map((s) => {
    const [role, bars] = s.replace('?', '').split(':');
    return { role: role as Role, bars: Number(bars), optional: s.endsWith('?') };
  });
  const [lo, hi] = LENGTHS[length];
  const target = rng.range(lo, hi);
  const seconds = () => steps.reduce((s, x) => s + x.bars * bar, 0);
  for (let i = steps.length - 1; i >= 0 && seconds() > target + 8; i--) if (steps[i].optional) steps.splice(i, 1);
  // still too long (a short piece): detours go first, then repeats; the intro, the first verse, the first
  // chorus or drop and the outro always stay
  const essential = (k: number) => {
    const r = steps[k].role;
    return r === 'intro' || r === 'outro' ||
      (['verse', 'chorus', 'drop'].includes(r) && steps.findIndex((x) => x.role === r) === k);
  };
  for (const role of ['solo', 'bridge', 'break', 'prechorus', 'verse', 'chorus', 'drop', 'build'] as const) {
    for (let k = steps.length - 1; k >= 0 && seconds() > target + 15; k--) {
      if (steps[k].role !== role || essential(k)) continue;
      // a drop takes its build with it; a build is only dropped with nothing to lead into
      if (role === 'build' && steps[k + 1]?.role === 'drop') continue;
      const withBuild = role === 'drop' && steps[k - 1]?.role === 'build' ? 1 : 0;
      steps.splice(k - withBuild, 1 + withBuild);
      k -= withBuild;
    }
  }
  // and as a last resort, eight-bar parts become four
  for (let k = steps.length - 2; k > 0 && seconds() > target + 15; k--) if (steps[k].bars === 8) steps[k].bars = 4;

  // too short (a long piece): the song goes round again before its outro, a different way each time, with only
  // the parts the style has
  const drops = steps.some((x) => x.role === 'drop');
  const known = new Set(style.forms.flatMap((f) => f.split(' ').map((x) => x.split(':')[0])));
  const has = (block: string[]) => block.every((x) => known.has(x.split(':')[0]));
  const rounds =
    (drops
      ? [['break:8', 'build:4', 'drop:8'], ['bridge:8', 'build:8', 'drop:8', 'drop:8'], ['solo:8', 'drop:8']]
      : [['verse:8', 'chorus:8'], ['solo:8', 'chorus:8'], ['bridge:8', 'chorus:8', 'chorus:8'], [
        'break:4',
        'verse:8',
        'chorus:8',
      ]]).filter(has);
  const blockBars = (block: string[]) => block.reduce((n, b) => n + Number(b.split(':')[1]), 0);
  for (let round = 0; round < 12 && seconds() < target - 20; round++) {
    // the next way round that fits without running long; if none fits, the piece is long enough
    // at slow tempos a whole way round can overshoot: then one more chorus (or drop), or a short break
    const small = (drops ? [['drop:8'], ['break:4']] : [['chorus:8'], ['break:4']]).filter(has);
    const block = [...[0, 1, 2, 3].map((k) => rounds[(round + k) % rounds.length]).filter(Boolean), ...small]
      .find((bl) => seconds() + blockBars(bl) * bar <= target + 25);
    if (!block) break;
    let at = steps.findIndex((x) => x.role === 'outro');
    if (at < 0) at = steps.length;
    steps.splice(
      at,
      0,
      ...block.map((b) => ({ role: b.split(':')[0] as Role, bars: Number(b.split(':')[1]), optional: false })),
    );
  }

  const shift = rng.chance(style.lift) ? rng.pick([1, 2]) : 0;
  let liftFrom = steps.length;
  if (shift) {
    const peak: Role = steps.some((s) => s.role === 'chorus') ? 'chorus' : 'drop';
    let k = steps.length - 1;
    while (k >= 0 && steps[k].role !== peak) k--;
    while (k > 0 && steps[k - 1].role === peak) k--;
    // a drop lifts together with the build that leads into it
    if (peak === 'drop' && steps[k - 1]?.role === 'build') k--;
    // only a movement with an earlier chorus (or drop) to lift from
    if (k > 0 && steps.slice(0, k).some((s) => s.role === peak)) liftFrom = k;
  }

  // a bridge sometimes goes away to the key a fourth up (the subdominant), and the piece comes home after it
  const away = rng.fork('away').chance(style.away) ? 5 : 0;

  const energy = arc(steps, rng.fork('arc').pick(BURNS));
  const out: Omit<SectionDef, 'seconds'>[] = steps.map((s, i) => ({
    role: s.role,
    bars: s.bars,
    energy: energy[i],
    shift: (i >= liftFrom ? shift : 0) + (s.role === 'bridge' ? away : 0),
  }));
  // an ending that fades or pauses is followed by a rest, so it's heard as an ending: about a bar after a
  // fade, a little longer after a pause (the outro's last chord rings out into it first)
  if (transition === 'pause' || transition === 'fade') {
    // not whole bars: a rest is as long as it wants to be, sometimes barely a breath
    const seconds = transition === 'pause' ? rng.range(1.2, 3.6) : rng.range(0.8, 3);
    const bars = seconds / bar;
    out.push({ role: 'rest', bars, energy: ROLE_ENERGY.rest, shift: out[out.length - 1].shift });
  }
  return out;
}
/**
 * How a movement's arc grows (the power of its position): most climb steadily, some reach near their height
 * early and hold it, some smoulder and burn late.
 */
const BURNS = [0.6, 1, 1, 1.8];

/**
 * The movement's arc as each section's energy (0..1, the peak 1): it starts low, every return of a part is
 * bigger than the one before, breaks and bridges fall back, and the last chorus or drop is the peak. Loudness
 * follows it (see the style's dynamics): a piece builds instead of sitting at one level.
 */
function arc(steps: readonly { role: Role; bars: number }[], burn = 1): number[] {
  const total = steps.reduce((n, s) => n + s.bars, 0);
  let at = 0;
  const raw = steps.map((s) => {
    const pos = (at / total) ** burn;
    at += s.bars;
    const calm = ['intro', 'outro', 'rest', 'break', 'bridge'].includes(s.role);
    return ROLE_ENERGY[s.role] + (calm ? 0.1 : 0.35) * pos;
  });
  const top = Math.max(...raw);
  return raw.map((e) => e / top);
}

export const sectionDuration = (mv: Movement, local: number) => mv.sections[local].seconds;
export function sectionOffset(mv: Movement, local: number): number {
  let seconds = 0;
  for (let s = 0; s < local; s++) seconds += mv.sections[s].seconds;
  return seconds;
}
