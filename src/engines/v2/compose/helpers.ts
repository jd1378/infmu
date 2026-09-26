// Helpers the v2 styles share: playing a melody on any instrument, choirs, solos, and the silences and
// ringing endings that give a movement room to breathe.

import { hash32, Rng } from '../rng.ts';
import type { LeadKind, MalletKind, Note, StringKind, Vowel, WindKind } from '../types.ts';
import type { Ctx } from './context.ts';
import {
  character,
  embellish,
  inMeter,
  makeMotif,
  type Motif,
  phrase,
  PHRASE_FORMS,
  type PhraseForm,
  PROFILES,
  type RealizeOpts,
} from './melody.ts';

/** Anything that can carry a melody. */
export type Voice =
  | LeadKind
  | 'bell'
  | 'piano'
  | `wind:${WindKind}`
  | `mallet:${MalletKind}`
  | `string:${StringKind}`;

/** Where each voice sounds like itself, in MIDI notes: a line is moved there by octaves, never note by note. */
const RANGE: Record<Voice, readonly [lo: number, hi: number]> = {
  'string:guitar': [52, 86],
  'string:electric': [52, 88],
  'string:overdrive': [52, 88],
  'string:harp': [48, 96],
  'mallet:vibes': [53, 89],
  'mallet:kalimba': [60, 88],
  'mallet:marimba': [48, 88],
  'wind:sax': [49, 80],
  'wind:hum': [45, 79],
  'wind:flute': [60, 96],
  brass: [48, 82],
  piano: [55, 91],
  hook: [57, 88],
  hook2: [57, 88],
  saw: [57, 88],
  flute: [60, 96],
  bell: [60, 96],
};

function inRange(voice: Voice, ns: readonly Note[]): readonly Note[] {
  const [lo, hi] = RANGE[voice];
  const top = Math.max(...ns.map((n) => n.n));
  const bottom = Math.min(...ns.map((n) => n.n));
  let shift = 0;
  while (top + shift > hi && bottom + shift - 12 >= lo - 5) shift -= 12;
  while (bottom + shift < lo && top + shift + 12 <= hi + 5) shift += 12;
  return shift ? ns.map((n) => ({ ...n, n: n.n + shift })) : ns;
}

/** Plays a line on a voice; `lead` false for a counter-line or an accent that shouldn't ride on top. */
export function play(ctx: Ctx, voice: Voice, line: readonly Note[], gain = 1, lead = true): void {
  if (!line.length) return;
  const ns = inRange(voice, line);
  const [kind, sub] = voice.split(':') as [string, string | undefined];
  switch (kind) {
    case 'bell':
      for (const n of ns) ctx.push({ i: 'bell', t: n.t, n: [n.n], v: 0.7 * gain * n.v, lead });
      break;
    case 'piano':
      for (const n of ns) ctx.push({ i: 'piano', t: n.t, d: n.d, n: [n.n], v: 0.8 * gain * n.v, lead });
      break;
    case 'wind':
      ctx.push({ i: 'wind', t: ns[0].t, k: sub as WindKind, ns: ns.map((n) => ({ ...n, v: n.v * gain })), lead });
      break;
    case 'mallet':
      for (const n of ns) {
        ctx.push({ i: 'mallet', t: n.t, n: n.n, v: 0.9 * gain * n.v, k: sub as MalletKind, lead });
      }
      break;
    case 'string':
      for (const n of ns) {
        ctx.push({ i: 'string', t: n.t, n: n.n, v: 0.9 * gain * n.v, k: sub as StringKind, d: n.d, lead });
      }
      break;
    default:
      ctx.push({ i: 'lead', t: ns[0].t, k: kind as LeadKind, ns: ns.map((n) => ({ ...n, v: n.v * gain })), lead });
  }
}

/**
 * The movement's motifs, in its own melodic character within its style's idiom: A, the hook (choruses); B, its
 * falling contrast (bridges); C, the verse's own tune, calmer and lower-reaching than the hook it leads to.
 */
export function motifs(ctx: Ctx): { a: Motif; b: Motif; c: Motif } {
  const p = character(ctx.mrng.fork('character'), inMeter(PROFILES[ctx.mv.style], ctx.mv.meter), ctx.mv.key.mode);
  return {
    a: makeMotif(ctx.mrng.fork('hook'), p),
    b: makeMotif(ctx.mrng.fork('hook-b'), { ...p, shapes: [['fall', 2], ['arch', 1]] }, 'short', 1),
    c: makeMotif(ctx.mrng.fork('hook-c'), { ...p, climb: [p.climb[0] - 1, p.climb[1] - 1] }),
  };
}

/**
 * What a movement's verses sing: the hook itself (a piece built on one theme), a tune of their own (motif C:
 * the chorus then brings the hook as something new), or nothing (the verse is the band's). `usual` is what the
 * style's verses did before it had a choice; a piece mostly keeps to it.
 */
export type VersePlan = 'hook' | 'own' | 'none';
export function versePlan(ctx: Ctx, usual: 'hook' | 'none'): VersePlan {
  const rng = ctx.mrng.fork('verse plan');
  return usual === 'hook'
    ? rng.weighted([['hook', 2], ['own', 3]] as const)
    : rng.weighted([['none', 2], ['own', 2]] as const);
}

/**
 * Sometimes an intro gives a glimpse of the hook: its first statement, softly, on the movement's second voice, in
 * the intro's second half. A movement decides once.
 */
export function introPreview(ctx: Ctx, voice: Voice, hook: Motif, o: Omit<RealizeOpts, 'step'>): void {
  if (ctx.role !== 'intro' || ctx.bars < 4 || !ctx.mrng.fork('preview').chance(0.3)) return;
  const half = Math.floor(ctx.bars / 2);
  play(
    ctx,
    voice,
    phrase(ctx, hook, half, Math.min(4, ctx.bars - half), { ...o, velocity: 0.6 }, 'period', undefined, 'open'),
    0.7,
    false,
  );
}

/** The phrase form a role uses in this movement: stable, so a returning chorus is recognised. */
export const formFor = (ctx: Ctx, role: string): PhraseForm => ctx.mrng.fork('form', role).pick(PHRASE_FORMS);

/**
 * A melody over the section: motif A in the movement's phrase form for this role. A returning chorus sings
 * the same notes; from its third time on it climbs an octave.
 */
export function sing(
  ctx: Ctx,
  voice: Voice,
  m: Motif,
  o: Omit<RealizeOpts, 'step'>,
  opts: { from?: number; bars?: number; form?: PhraseForm; b?: Motif; gain?: number; label?: string } = {},
): Note[] {
  const from = opts.from ?? 0;
  const bars = opts.bars ?? ctx.bars - from;
  // a drop is the chorus of a dance form: a piece with both sings its hook in both
  const role = opts.label ?? (ctx.role === 'drop' ? 'chorus' : ctx.role);
  // octaves up are decided for the whole phrase (it moves up only if all of it fits); folding single notes
  // back down would tear the melody's shape apart
  // the final chorus or drop climbs an octave (when the piece has had one before)
  const lift = Math.max(0, o.transpose ?? 0) +
    (ctx.finalTurn && ctx.turn >= 1 && (ctx.role === 'chorus' || ctx.role === 'drop') ? 12 : 0);
  const base = phrase(
    ctx,
    m,
    from,
    bars,
    { ...o, transpose: Math.min(0, o.transpose ?? 0) },
    opts.form ?? formFor(ctx, role),
    opts.b,
    // the first half of a long part ends open, the second half closes it: one phrase, not the same one twice
    ctx.runEnd ? undefined : 'open',
  );
  const top = base.reduce((x, n) => Math.max(x, n.n), 0);
  let up = 0;
  while (up + 12 <= lift && top + up + 12 <= RANGE[voice][1]) up += 12;
  const ns = up ? base.map((n) => ({ ...n, n: n.n + up })) : base;
  play(ctx, voice, ns, opts.gain);
  return ns;
}

/** A solo: the hook paraphrased (ornamented, a little higher, spun out as a sentence), not a new tune. */
export function solo(ctx: Ctx, voice: Voice, hook: Motif, o: Omit<RealizeOpts, 'step'>): void {
  play(ctx, voice, phrase(ctx, embellish(hook, 2), 0, ctx.bars, { ...o, center: o.center + 2 }, 'sentence'));
}

/** A choir (or a hum) on each chord of the section. */
export function choir(ctx: Ctx, vowel: Vowel, g: number, transpose = 0, fromBar = 0, toBar = ctx.bars): void {
  for (const slot of ctx.chords) {
    const a = Math.max(slot.bar, fromBar);
    const b = Math.min(slot.bar + slot.bars, toBar);
    if (b <= a) continue;
    ctx.push({
      i: 'choir',
      t: ctx.barAt(a),
      d: (b - a) * ctx.bar,
      n: slot.voicing.map((n) => n + transpose),
      vowel,
      g,
    });
  }
}

/**
 * How long a written silence lasts: never the same every time. Up to `longest` beats, usually a little less,
 * sometimes much less, always on the sixteenth-note grid so it still lands in time.
 */
export function breath(ctx: Ctx, longest: number): number {
  const f = ctx.rng.fork('breath').weighted([[1, 3], [0.75, 3], [0.5, 2], [0.25, 1]] as const);
  return Math.max(0.25, Math.round(longest * f * 4) / 4);
}

/** The band stops for the last beats of the section (up to `longest`), and the room rings (or not) into what's next. */
export function stopBefore(ctx: Ctx, longest: number, room = true): void {
  ctx.hush(ctx.duration - breath(ctx, longest) * ctx.beat, ctx.duration, room);
}

/** Stop-time: the band plays the downbeat of `bar` together, then holds its breath for most of the bar. */
export function stopTime(ctx: Ctx, bar: number): void {
  const from = ctx.rng.fork('stop-time').weighted([[2, 1], [4, 2], [6, 3], [8, 3]] as const);
  ctx.hush(ctx.barAt(bar, from), ctx.barAt(bar + 1), true);
}

/**
 * The outro's end: after the final downbeat (or, sometimes, after the first half of the last bar) nothing new
 * is played, so the last chord rings out.
 */
export function ringOut(ctx: Ctx): void {
  if (ctx.role !== 'outro' || ctx.nextRole === 'outro') return;
  const from = ctx.mrng.fork('ring-out').chance(0.4) ? 8 : 1;
  ctx.clear(ctx.barAt(ctx.bars - 1, from), ctx.duration);
}

export const halves = (ctx: Ctx) => ({ half: Math.floor(ctx.bars / 2), last: ctx.bars - 1 });

// ------------------------------------------------------------------ one arc across a run of sections
// Sections of the same role in a row are one part: automation runs across all of them instead of starting over.

/** A filter moving from c0 to c1 (exponentially) across the whole run, for a chord slot of this section. */
export function runCut(ctx: Ctx, slot: { bar: number; bars: number }, c0: number, c1: number): [number, number] {
  const at = (bar: number) => c0 * (c1 / c0) ** ctx.runAt(Math.min(1, bar / ctx.bars));
  return [at(slot.bar), at(slot.bar + slot.bars)];
}

/** The bar of this section where the run reaches its middle (0 if already past it, bars if not reached). */
export const runHalf = (ctx: Ctx) => Math.min(ctx.bars, Math.max(0, Math.ceil(ctx.runBars / 2 - ctx.runStartBar)));

/** A cutoff pair from c0 to c1 across the run, for this section's share of it from progress `from`. */
export function span(ctx: Ctx, c0: number, c1: number, from = 0): [number, number] {
  return [c0 * (c1 / c0) ** ctx.runAt(from), c0 * (c1 / c0) ** ctx.runAt(1)];
}

// ------------------------------------------------------------------ the movement's voices

/**
 * A voice for the whole movement, drawn from a pool (other than `not`): a piece keeps its singer. The same
 * pool always gives the same voice within a movement. A lead (no `not`) is also not the one a recent piece of
 * the same style had, while the pool has another.
 */
export function voiceFrom(ctx: Ctx, pool: readonly Voice[], not?: Voice): Voice {
  const order = (seed: number) => {
    const rng = new Rng(hash32(seed, 0x6d6f74)).fork('voice');
    const out = [...new Set(pool)];
    for (let i = out.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const taken = new Set<Voice>(not ? [not] : []);
  if (!not) {
    for (let m = Math.max(0, ctx.mv.index - 4); m < ctx.mv.index; m++) {
      const mv = ctx.song.movement(m);
      if (mv.style === ctx.mv.style) taken.add(order(mv.seed)[0]);
    }
  }
  const mine = order(ctx.mv.seed);
  return mine.find((v) => !taken.has(v)) ?? mine.find((v) => v !== not) ?? mine[0];
}

/**
 * The chorus: the movement's hook on its lead, the same notes every time it returns (repetition is what makes
 * a hook a hook). Each return grows by one thing: a middle return has the second voice answering the hook in
 * its rests, the peak has it doubling the hook an octave away.
 */
export function chorusMelody(ctx: Ctx, lead: Voice, second: Voice, m: Motif, o: Omit<RealizeOpts, 'step'>): void {
  const ns = sing(ctx, lead, m, o);
  if (second === lead) return;
  if (ctx.peak) {
    // an octave above if the whole line fits there, otherwise an octave below
    const shift = ns.reduce((x, n) => Math.max(x, n.n), 0) + 12 <= RANGE[second][1] ? 12 : -12;
    play(ctx, second, ns.map((n) => ({ ...n, n: n.n + shift })), 0.5);
  } else if (ctx.returning) answer(ctx, second, ns);
}

/**
 * A counter-line that answers the lead: in each of its rests of two beats or more, the top voice of the
 * voice-led chord enters half a beat after the lead stops and holds until it returns. The pads' top voice moves
 * by step, so the answers join into a line, and nothing in it is new to the harmony. Part of the bed, not the
 * melody.
 */
export function answer(ctx: Ctx, voice: Voice, lead: readonly Note[], gain = 0.45): void {
  const ns: Note[] = [];
  let free = 0;
  for (const [on, off] of [...lead.map((n) => [n.t, n.t + n.d]), [ctx.duration, ctx.duration]]) {
    if (on - free >= 2 * ctx.beat) {
      const step = Math.ceil((free + ctx.beat / 2) / ctx.s16);
      const t = ctx.at(step);
      const slot = ctx.chordAtStep(step);
      ns.push({ t, d: Math.max(ctx.s16, on - t - ctx.s16), n: slot.voicing[slot.voicing.length - 1], v: 0.8 });
    }
    free = Math.max(free, off);
  }
  if (ns.length) play(ctx, voice, ns, gain, false);
}
