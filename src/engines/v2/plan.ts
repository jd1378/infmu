// The song plan: an endless chain of movements, each a small piece in one style and key. Movement m depends
// only on the seed and movement m-1 (for its key and style), so any point in the song can be reached by
// planning the movements before it, which costs microseconds each. No audio is involved here.

import { hash32, Rng } from './rng.ts';
import { movementTitle, normalizeSeed, seedNumber } from './seed.ts';
import { type ProgChord, PROGRESSIONS, ROLE_ENERGY, STYLE_IDS, type StyleDef, STYLES } from './styles.ts';
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
    // modulate from where the last movement ended, which is above its key if its last chorus lifted
    const heard = prev ? mod(prev.key.tonic + prev.sections[prev.sections.length - 1].shift, 12) : 0;
    const tonic = prev ? mod(heard + keyRng.weighted(MODULATIONS), 12) : keyRng.int(12);
    let mode = keyRng.weighted(style.modes);
    if (prev && heard === tonic && prev.key.mode === mode) mode = keyRng.weighted(style.modes);
    const key: Key = { tonic, mode };

    const bpm = Math.round(rng.fork('bpm').range(style.bpm[0], style.bpm[1] + 1) - 0.5);
    const swing = rng.fork('swing').range(style.swing[0], style.swing[1]);
    const bar = (4 * 60) / bpm;
    const transition = rng.fork('transition').weighted(style.transitions);
    const sections = planForm(style, rng.fork('form'), bar, transition, this.length);
    const duration = sections.reduce((s, x) => s + x.bars * bar, 0);

    const h = rng.fork('harmony');
    const pool = PROGRESSIONS[mode];
    const size = h.weighted(style.chordSize);
    const toChords = (p: readonly ProgChord[]): ChordSpec[] =>
      p.map((c) => ({ deg: c.deg, size, alt: c.alt, sus: !c.alt && h.chance(style.sus2) ? 2 : undefined }));
    const main = h.pick(pool);
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
      progressions: { main: toChords(main), lift: toChords(lift), alt: toChords(alt), bridge: toChords(bridge) },
      tone,
      mix,
      transition,
    };
  }
}

export const barSeconds = (mv: Movement) => (4 * 60) / mv.bpm;

/**
 * A movement's form, fitted to a target length of three to four minutes: optional steps are dropped from
 * the end backwards while it runs long, and the last big section is doubled while it runs short. Energy
 * grows a little each time a chorus or drop returns; the final chorus group may lift a key; a movement that
 * fades or pauses at its end gets a rest, so the end of a piece is heard as an end.
 */
/** How long a movement runs, in seconds. The listener picks one; it is part of the song, like the seed. */
export const LENGTHS = { short: [110, 150], standard: [185, 235], long: [290, 360] } as const;
export type Length = keyof typeof LENGTHS;

function planForm(style: StyleDef, rng: Rng, bar: number, transition: Transition, length: Length): SectionDef[] {
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

  // too short (a long piece): the song goes round again before its outro, a different way each time
  const drops = steps.some((x) => x.role === 'drop');
  const rounds = drops
    ? [['break:8', 'build:4', 'drop:8'], ['bridge:8', 'build:8', 'drop:8', 'drop:8'], ['solo:8', 'drop:8']]
    : [['verse:8', 'chorus:8'], ['solo:8', 'chorus:8'], ['bridge:8', 'chorus:8', 'chorus:8'], [
      'break:4',
      'verse:8',
      'chorus:8',
    ]];
  const blockBars = (block: string[]) => block.reduce((n, b) => n + Number(b.split(':')[1]), 0);
  for (let round = 0; round < 12 && seconds() < target - 20; round++) {
    // the next way round that fits without running long; if none fits, the piece is long enough
    // at slow tempos a whole way round can overshoot: then one more chorus (or drop), or a short break
    const small = drops ? [['drop:8'], ['break:4']] : [['chorus:8'], ['break:4']];
    const block = [...[0, 1, 2, 3].map((k) => rounds[(round + k) % rounds.length]), ...small]
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

  const energy = arc(steps);
  const out: SectionDef[] = steps.map((s, i) => ({
    role: s.role,
    bars: s.bars,
    energy: energy[i],
    shift: i >= liftFrom ? shift : 0,
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
 * The movement's arc as each section's energy (0..1, the peak 1): it starts low, every return of a part is
 * bigger than the one before, breaks and bridges fall back, and the last chorus or drop is the peak. Loudness
 * follows it (see the style's dynamics): a piece builds instead of sitting at one level.
 */
function arc(steps: readonly { role: Role; bars: number }[]): number[] {
  const total = steps.reduce((n, s) => n + s.bars, 0);
  let at = 0;
  const raw = steps.map((s) => {
    const pos = at / total;
    at += s.bars;
    const calm = ['intro', 'outro', 'rest', 'break', 'bridge'].includes(s.role);
    return ROLE_ENERGY[s.role] + (calm ? 0.1 : 0.35) * pos;
  });
  const top = Math.max(...raw);
  return raw.map((e) => e / top);
}

export const sectionDuration = (mv: Movement, local: number) => mv.sections[local].bars * barSeconds(mv);
export function sectionOffset(mv: Movement, local: number): number {
  let bars = 0;
  for (let s = 0; s < local; s++) bars += mv.sections[s].bars;
  return bars * barSeconds(mv);
}
