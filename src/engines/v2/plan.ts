// The song plan: an endless chain of movements, each a small piece in one style and key. Movement m depends
// only on the seed and the few movements before it (for its key, and for what it should not repeat), so any
// point in the song can be reached by planning the movements before it, which costs microseconds each. No
// audio is involved here.

import { arcPlan, LIFTS, LOUD_OPENINGS, settle, shapeForm, tells } from './arcs.ts';
import { placeSurprise } from './surprises.ts';
import { type Mood, moodModes, MOODS, type Motion } from './moods.ts';
import { hash32, Rng } from './rng.ts';
import { movementTitle, normalizeSeed, seedNumber } from './seed.ts';
import {
  COLOURS,
  LAMENTS,
  type ProgChord,
  PROGRESSIONS,
  ROLE_ENERGY,
  SPACES,
  STYLE_IDS,
  type StyleDef,
  STYLES,
  VAMPS,
} from './styles.ts';
import { barSeconds, Clock } from './tempo.ts';
import { type ChordSpec, type Key, MAJOR_MODES, mod } from './theory.ts';
import type {
  Arc,
  Conceit,
  Harmony,
  Movement,
  Role,
  SectionDef,
  Space,
  StyleId,
  Surprise,
  Transition,
  Tune,
} from './types.ts';

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

    // the feeling first: key, tempo, chords, sound and room follow from it (see moods.ts). Not the last piece's, and
    // only one the style's modes can carry
    const moods = style.moods.filter((x) => x !== prev?.mood && moodModes(style.modes, x).length);
    const mood: Mood = rng.fork('mood').pick(moods.length ? moods : style.moods);
    const feel = MOODS[mood];
    const motion: Motion = rng.fork('motion').weighted(style.motions.map((x) => [x, feel.motion[x] ?? 0.25] as const));
    const modes = moodModes(style.modes, mood);

    const keyRng = rng.fork('key');
    // modulate from where the last movement ended, which is above its key if its last chorus lifted
    const heard = prev ? mod(prev.key.tonic + prev.sections[prev.sections.length - 1].shift, 12) : 0;
    const tonic = prev ? mod(heard + keyRng.weighted(MODULATIONS), 12) : keyRng.int(12);
    const leaning = modes.length ? modes : style.modes;
    let mode = keyRng.weighted(leaning);
    if (prev && heard === tonic && prev.key.mode === mode) mode = keyRng.weighted(leaning);
    const key: Key = { tonic, mode };

    const meter = rng.fork('meter').weighted(style.meters);
    // bpm counts quarters; a 6/8 piece sways on its dotted quarters, at three quarters of the style's tempo
    const pulse = meter === '6/8' ? 1.5 * 0.75 : 1;
    // where in the style's range the mood puts it; not the tempo of a piece of the same style (and time) heard lately
    const [slow, fast] = [style.bpm[0], style.bpm[1] + 1];
    const tempo = (k: number) =>
      Math.round(pulse * (slow + (fast - slow) * rng.fork('bpm', k).range(feel.tempo[0], feel.tempo[1]) - 0.5));
    let bpm = tempo(0);
    for (let k = 1; k < 8 && sameStyle.some((x) => x.meter === meter && Math.abs(x.bpm - bpm) < 4); k++) {
      bpm = tempo(k);
    }
    const swing = rng.fork('swing').range(style.swing[0], style.swing[1]);
    const bar = barSeconds({ bpm, meter });
    // a piece rarely ends the way the one before it did
    let transition = rng.fork('transition').weighted(style.transitions);
    if (prev && transition === prev.transition) transition = rng.fork('transition', 1).weighted(style.transitions);
    // the story the piece tells: not the one the piece before told, and a loud opening only after a piece that
    // didn't fade away (never the very first)
    const arcs = style.arcs.filter((a) =>
      a !== prev?.arc && (!LOUD_OPENINGS.has(a) || (prev !== null && prev.transition !== 'fade'))
    );
    // the moment it is remembered by, or none: one its style and mood allow, not the kind either piece before had
    const lately = this.movements.slice(Math.max(0, m - 2), m).map((x) => x.surprise);
    const fits = (k: Surprise) =>
      style.surprises.includes(k) && !lately.includes(k) && (k !== 'halfTime' || meter === '4/4');
    const kinds = (Object.entries(feel.surprises) as [Surprise, number][]).filter(([k]) => fits(k));
    // (drawn, then the others it allows in turn, for a form with no room for it)
    const first = rng.fork('surprise').weighted<Surprise | null>([[null, 0.5], ...kinds]);
    const surprises = first ? [first, ...kinds.map(([k]) => k).filter((k) => k !== first)] : [];
    // one drawn, then the others in turn, for a form that can't tell it (see tells())
    const drawn: Arc = rng.fork('arc family').pick(arcs.length ? arcs : ['climb']);
    let planned!: ReturnType<typeof planForm>;
    for (const arc of [drawn, ...arcs.filter((a) => a !== drawn), 'climb'] as const) {
      // a piece that ends on its peak stops on it, and the room rings
      const ending = arc === 'lastWord' ? 'pause' : transition;
      planned = planForm(style, rng.fork('form'), bar, ending, this.length, arc, surprises);
      if (planned.arc !== arc) continue;
      transition = ending;
      break;
    }
    const { steps: form, arc: told, surprise: placed } = planned;
    const seed = hash32(this.seed, m);
    const paced = { style: styleId, bpm, meter, seed, transition, sections: form };
    const sections = form.map((s, k) => ({ ...s, seconds: new Clock(paced, k).duration }));
    const duration = sections.reduce((s, x) => s + x.seconds, 0);

    const h = rng.fork('harmony');
    // a mood may lean to slower or quicker chords; otherwise now and then a piece changes chords twice as often as
    // its style does, or half as often
    const hr = rng.fork('harmonic rhythm');
    const barsPerChord: 1 | 2 = feel.pace && hr.fork('mood').chance(0.6)
      ? (feel.pace === 'slow' ? 2 : 1)
      : hr.chance(0.25)
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
        bass: c.bass,
        sus: !c.alt && !c.shift && c.bass === undefined && h.chance(style.sus2) ? 2 : undefined,
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

    // the harmonic language, as the mood leans (see Harmony): one the style speaks and the mode has. A lament or a
    // vamp is what the verses play, and often the choruses; a colour chord takes a place in both their loops; a pedal
    // is the bass's (see sectionChords). The bridge still goes elsewhere.
    const speaks = (l: Harmony) =>
      style.languages.includes(l) && (l !== 'lament' || !!LAMENTS[mode]) && (l !== 'colour' || !!COLOURS[mode]);
    const langs = (Object.entries(feel.languages) as [Harmony, number][]).filter(([l]) => speaks(l));
    const harmony: Harmony = langs.length ? rng.fork('language').weighted(langs) : 'loop';
    const lang = h.fork(harmony);
    const fitted = (ps: readonly ProgChord[][]) => {
      const f = ps.filter((p) => barsPerChord === 1 || p.length === 4);
      return f.length ? f : ps;
    };
    let [verse, chorus] = [main, lift];
    if (harmony === 'lament' || harmony === 'vamp') {
      const own = fitted(harmony === 'lament' ? LAMENTS[mode]! : VAMPS[mode]);
      verse = lang.pick(own);
      if (harmony === 'vamp' || lang.chance(0.5)) chorus = lang.pick(own);
    } else if (harmony === 'colour') {
      const colour = lang.pick(COLOURS[mode]!);
      // in the third place of each four chords, or the second where the third is the tonic
      const tint = (p: readonly ProgChord[]) =>
        p.map((c, i) => {
          const place = p[i - (i % 4) + 2]?.deg === 0 ? 1 : 2;
          return i % 4 === place ? colour : c;
        });
      verse = tint(main);
      chorus = tint(lift);
    }
    // an ending that doesn't come home, as the mood allows
    const ending = rng.fork('ending').chance(feel.open) ? 'open' : 'home';

    const t = rng.fork('tone');
    const tone = {
      bright: t.range(feel.bright[0], feel.bright[1]),
      detune: t.range(0.75, 1.35),
      fmRatio: t.pick([3.4, 3.5, 2, 1.4, 4, 5.19]),
      vibrato: t.range(0.6, 1.3),
      crackle: t.range(style.crackle[0], style.crackle[1]),
      wow: t.range(style.wow[0], style.wow[1]),
    };
    // the room it is recorded in, as the mood leans: to the biggest the style allows, or to the closest
    const leanRoom = (i: number, all: readonly Space[]) =>
      1 + (feel.space >= 1.15 && i === all.length - 1 ? 2 : 0) + (feel.space <= 0.9 && i === 0 ? 2 : 0);
    const space = rng.fork('space').weighted(style.spaces.map((sp, i, all): [Space, number] => [sp, leanRoom(i, all)]));
    const room = SPACES[space];
    const x = rng.fork('mix');
    const mix = {
      room: x.range(room.room[0], room.room[1]),
      reverb: x.range(style.reverb[0], style.reverb[1]) * room.reverb,
      delayBeats: x.pick(style.delayBeats),
      delayFeedback: x.range(style.delayFeedback[0], style.delayFeedback[1]),
      delayWet: x.range(style.delayWet[0], style.delayWet[1]) * room.echo,
      peak: style.dynamics[0] + feel.dynamics[0],
      range: Math.max(4, style.dynamics[1] + feel.dynamics[1]),
      drums: style.balance[0],
      bass: style.balance[1],
      ...style.record,
      early: style.record.early * room.early,
    };
    // the tune, as the mood leans: one the style writes; a riff only in four and in a minor mode (a figure restated
    // in a major key, or in three, is a carousel)
    const writes = (t: Tune) =>
      style.tunes.includes(t) && (t !== 'riff' || (meter === '4/4' && !MAJOR_MODES.has(mode)));
    const tunes = (Object.entries(feel.tunes) as [Tune, number][]).filter(([t]) => writes(t));
    const tune: Tune = tunes.length ? rng.fork('tune').weighted(tunes) : 'song';
    // one big idea, now and then: a phase piece only when it isn't driving (its loops need room to be heard)
    const ideas = style.conceits.filter((c) => c !== 'phase' || motion !== 'driving');
    const conceit: Conceit = rng.fork('conceit').weighted<Conceit>([
      ['none', 1.2],
      ...ideas.map((c) => [c, 1] as const),
    ]);
    // now and then the band implies the chords with no bed under them (never in a still piece: it would be empty)
    const texture = motion !== 'still' && rng.fork('texture').chance(style.bare) ? 'bare' : 'bed';

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
      progressions: { main: toChords(verse), lift: toChords(chorus), alt: toChords(alt), bridge: toChords(bridge) },
      barsPerChord,
      tone,
      mix,
      transition,
      arc: told,
      mood,
      motion,
      harmony,
      ending,
      tune,
      space,
      texture,
      surprise: placed,
      conceit,
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
  wanted: Arc,
  surprises: readonly Surprise[],
): { steps: Omit<SectionDef, 'seconds'>[]; arc: Arc; surprise: Surprise | null } {
  let steps = shapeForm(
    wanted,
    rng.pick(style.forms).split(' ').map((s) => {
      const [role, bars] = s.replace('?', '').split(':');
      return { role: role as Role, bars: Number(bars), optional: s.endsWith('?') };
    }),
  );
  const [lo, hi] = LENGTHS[length].map((x) => x * (style.stretch ?? 1));
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

  // too short, in a style that grows (post-rock): its parts get longer instead, the builds and the climaxes first,
  // eight bars at a time up to 32; the waves stay as they are, only slower to break
  if (style.grow) {
    const order: Role[] = ['build', 'drop', 'chorus', 'verse', 'break', 'intro'];
    for (let pass = 0; pass < 8 && seconds() < target - 20; pass++) {
      for (const role of order) {
        for (const s of steps) {
          if (s.role !== role || s.bars >= 32 || seconds() + 8 * bar > target + 15) continue;
          s.bars += 8;
        }
      }
    }
  }

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

  steps = settle(wanted, steps);
  const arc = tells(wanted, steps);
  // where a lift would start: the last run of choruses (or drops), in a movement with an earlier one to lift from
  let liftAt = steps.length;
  {
    const peak: Role = steps.some((s) => s.role === 'chorus') ? 'chorus' : 'drop';
    let k = steps.length - 1;
    while (k >= 0 && steps[k].role !== peak) k--;
    while (k > 0 && steps[k - 1].role === peak) k--;
    // a drop lifts together with the build that leads into it
    if (peak === 'drop' && steps[k - 1]?.role === 'build') k--;
    if (k > 0 && steps.slice(0, k).some((s) => s.role === peak)) liftAt = k;
  }
  const shift = rng.chance(style.lift) && LIFTS.has(arc) ? rng.pick([1, 2]) : 0;
  const liftFrom = shift ? liftAt : steps.length;

  // a bridge sometimes goes away to the key a fourth up (the subdominant), and the piece comes home after it
  const away = rng.fork('away').chance(style.away) ? 5 : 0;

  const { energy, treatment } = arcPlan(arc, steps, rng.fork('arc').pick(BURNS));
  const out: Omit<SectionDef, 'seconds'>[] = steps.map((s, i) => ({
    role: s.role,
    bars: s.bars,
    energy: energy[i],
    shift: (i >= liftFrom ? shift : 0) + (s.role === 'bridge' ? away : 0),
    ...(treatment[i] ? { treatment: treatment[i] } : {}),
  }));
  // the first of the surprises it can place: a key jump lifts the last choruses a major third (the chromatic
  // mediant, the film composer's lift) where a lift could be; an arc that already quiets its later parts has no room
  // for a sudden hush or a part left alone
  const placed = surprises.find((k) => {
    if (k === 'keyJump') {
      if (!LIFTS.has(arc) || liftAt >= steps.length) return false;
      for (let i = liftAt; i < out.length; i++) {
        out[i] = { ...out[i], shift: 4 + (out[i].role === 'bridge' ? away : 0) };
      }
      return true;
    }
    if ((arc === 'early' || arc === 'dissolve') && (k === 'subito' || k === 'alone')) return false;
    return placeSurprise(k, out) !== null;
  }) ?? null;
  // an ending that fades or pauses is followed by a rest, so it's heard as an ending: about a bar after a
  // fade, a little longer after a pause (the outro's last chord rings out into it first)
  if (transition === 'pause' || transition === 'fade') {
    // not whole bars: a rest is as long as it wants to be, sometimes barely a breath
    const seconds = transition === 'pause' ? rng.range(1.2, 3.6) : rng.range(0.8, 3);
    const bars = seconds / bar;
    out.push({ role: 'rest', bars, energy: ROLE_ENERGY.rest, shift: out[out.length - 1].shift });
  }
  return { steps: out, arc, surprise: placed };
}
/** How a climb grows (see arcs.ts): most steadily, some near their height early, some smouldering and burning late. */
const BURNS = [0.6, 1, 1, 1.8];

export const sectionDuration = (mv: Movement, local: number) => mv.sections[local].seconds;
export function sectionOffset(mv: Movement, local: number): number {
  let seconds = 0;
  for (let s = 0; s < local; s++) seconds += mv.sections[s].seconds;
  return seconds;
}
