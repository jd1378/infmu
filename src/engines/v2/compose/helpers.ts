// Helpers the v2 styles share: playing a melody on any instrument, choirs, solos, and the silences and
// ringing endings that give a movement room to breathe.

import type { Rng } from '../rng.ts';
import type { LeadKind, MalletKind, Note, StringKind, Vowel, WindKind } from '../types.ts';
import type { Ctx } from './context.ts';
import { makeMotif, type Motif, phrase, PHRASE_FORMS, type PhraseForm, type RealizeOpts } from './melody.ts';

/** Anything that can carry a melody. */
export type Voice =
  | LeadKind
  | 'bell'
  | 'piano'
  | `wind:${WindKind}`
  | `mallet:${MalletKind}`
  | `string:${StringKind}`;

const WIND_TOP: Record<WindKind, number> = { hum: 79, sax: 80, flute: 96 };

/** Plays a line on a voice; `lead` false for a counter-line or an accent that shouldn't ride on top. */
export function play(ctx: Ctx, voice: Voice, ns: readonly Note[], gain = 1, lead = true): void {
  if (!ns.length) return;
  const [kind, sub] = voice.split(':') as [string, string | undefined];
  switch (kind) {
    case 'bell':
      for (const n of ns) ctx.push({ i: 'bell', t: n.t, n: [n.n], v: 0.7 * gain * n.v, lead });
      break;
    case 'piano':
      for (const n of ns) ctx.push({ i: 'piano', t: n.t, d: n.d, n: [n.n], v: 0.8 * gain * n.v, lead });
      break;
    case 'wind': {
      // a hummed or saxophone line stays where it can be played: the whole phrase moves down if it's high
      const top = Math.max(...ns.map((n) => n.n));
      let down = 0;
      while (top - down > WIND_TOP[sub as WindKind]) down += 12;
      ctx.push({
        i: 'wind',
        t: ns[0].t,
        k: sub as WindKind,
        ns: ns.map((n) => ({ ...n, n: n.n - down, v: n.v * gain })),
        lead,
      });
      break;
    }
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

/** The movement's two motifs: A, the hook, and B, its contrast (used by bridges). */
export function motifs(ctx: Ctx, density: number): { a: Motif; b: Motif } {
  return {
    a: makeMotif(ctx.mrng.fork('hook'), density),
    b: makeMotif(
      ctx.mrng.fork('hook-b'),
      Math.max(0.1, Math.min(0.95, density + ctx.mrng.fork('b-density').range(-0.3, 0.2))),
    ),
  };
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
  const lift = Math.max(0, o.transpose ?? 0) +
    (ctx.occ >= 2 && (ctx.role === 'chorus' || ctx.role === 'drop') ? 12 : 0);
  const base = phrase(
    ctx,
    ctx.mrng.fork('phrase', role),
    m,
    from,
    bars,
    { ...o, transpose: Math.min(0, o.transpose ?? 0) },
    opts.form ?? formFor(ctx, role),
    opts.b,
  );
  const top = base.reduce((x, n) => Math.max(x, n.n), 0);
  let up = 0;
  while (up + 12 <= lift && top + up + 12 <= 93) up += 12;
  const ns = up ? base.map((n) => ({ ...n, n: n.n + up })) : base;
  play(ctx, voice, ns, opts.gain);
  return ns;
}

/** An improvised-sounding solo: a busy new motif from this section's own stream, spun out as a sentence. */
export function solo(ctx: Ctx, voice: Voice, o: Omit<RealizeOpts, 'step'>, density = 0.85): void {
  const rng: Rng = ctx.rng.fork('solo');
  const m = makeMotif(rng, density);
  const ns = phrase(ctx, rng, m, 0, ctx.bars, o, rng.pick(['sentence', 'sequence'] as const));
  play(ctx, voice, ns);
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
 * pool always gives the same voice within a movement.
 */
export function voiceFrom(ctx: Ctx, pool: readonly Voice[], not?: Voice): Voice {
  const rng = ctx.mrng.fork('voice');
  const order = [...new Set(pool)];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.find((v) => v !== not) ?? order[0];
}

/**
 * The chorus: the movement's hook on its lead, the same notes every time it returns (repetition is what makes
 * a hook a hook). At the climax of the movement's arc the second voice doubles it an octave away, for size.
 */
export function chorusMelody(ctx: Ctx, lead: Voice, second: Voice, m: Motif, o: Omit<RealizeOpts, 'step'>): void {
  const ns = sing(ctx, lead, m, o);
  if (ctx.sec.energy < 0.9 || second === lead) return;
  // an octave above if the whole line fits there, otherwise an octave below
  const shift = ns.reduce((x, n) => Math.max(x, n.n), 0) + 12 <= 93 ? 12 : -12;
  play(ctx, second, ns.map((n) => ({ ...n, n: n.n + shift })), 0.5);
}
