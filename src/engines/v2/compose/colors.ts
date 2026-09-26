// A signature colour: one texture from across the whole instrument set (mostly one that suits the style, now
// and then a wildcard) laid over a style's own arrangement. It joins the band as the piece develops and stays:
// a movement's band grows, it doesn't change.

import { bounces } from '../moods.ts';
import type { StyleId } from '../types.ts';
import type { Ctx } from './context.ts';
import { choir, play } from './helpers.ts';
import { inMeter, makeMotif, phrase, TEXTURE } from './melody.ts';
import {
  acidLine,
  acidPattern,
  arp,
  arpNotes,
  guitarVoicing,
  moves,
  organChords,
  padChords,
  percBar,
  pianoBar,
  pick,
  strumBar,
} from './parts.ts';

type ColorId =
  | 'kalimba'
  | 'marimba'
  | 'harp'
  | 'guitar'
  | 'strum'
  | 'electric'
  | 'vibes'
  | 'piano'
  | 'choir'
  | 'strings'
  | 'organ'
  | 'congas'
  | 'acid'
  | 'glock'
  | 'pluck'
  | 'hum';

interface Color {
  write: (ctx: Ctx, v: number) => void;
  /** How well it suits each style (0 or missing: only as a wildcard). */
  suits: Partial<Record<StyleId, number>>;
  /** Too busy or too loud for the quietest parts. */
  busy?: boolean;
}

const bars = (ctx: Ctx, fn: (b: number) => void) => {
  for (let b = 0; b < ctx.bars; b++) fn(b);
};

const COLORS: Record<ColorId, Color> = {
  kalimba: {
    write: (ctx, v) =>
      bars(ctx, (b) => {
        const ns = arpNotes(ctx.chordAt(b), 67);
        [0, 2, 1, 3, 2, 4, 1, 3].slice(0, ctx.spb / 2).forEach((i, k) =>
          moves(ctx, 2 * k) &&
          ctx.push({
            i: 'mallet',
            t: ctx.barAt(b, 2 * k),
            n: ns[i % ns.length],
            v: v * (k % 2 ? 0.7 : 0.9),
            k: 'kalimba',
          })
        );
      }),
    suits: { drift: 3, garden: 1, haze: 2, pulse: 1 },
  },
  marimba: {
    write: (ctx, v) =>
      bars(ctx, (b) => {
        const ns = arpNotes(ctx.chordAt(b), 60);
        for (let s = 0; s < ctx.spb; s++) {
          // sixteenths of a high mallet are a music box: only joy runs that fast (see moods.ts)
          if (!moves(ctx, s) || (s % 2 && !bounces(ctx.mv.mood))) continue;
          const g = ctx.runBar(b) * ctx.spb + s;
          ctx.push({
            i: 'mallet',
            t: ctx.barAt(b, s),
            n: ns[[0, 2, 1][g % 3]],
            v: v * (ctx.onBeat(s) ? 0.9 : 0.65),
            k: 'marimba',
          });
        }
      }),
    suits: { haze: 2, drift: 1, pulse: 1, acid: 1 },
    busy: true,
  },
  harp: {
    write: (ctx, v) => bars(ctx, (b) => pick(ctx, b, 'harp', [0, 2, 4, 5, 3, 2], 2, v, 52)),
    suits: { drift: 1, nocturne: 3, cathedral: 1, garden: 2, haze: 1 },
  },
  guitar: {
    write: (ctx, v) => bars(ctx, (b) => pick(ctx, b, 'guitar', [0, 3, 2, 4, 1, 3, 2, 5], 2, v)),
    suits: { haze: 2, drift: 2, pulse: 1, ember: 1 },
  },
  strum: {
    write: (ctx, v) =>
      bars(ctx, (b) => {
        const ns = guitarVoicing(ctx.chordAt(b));
        strumBar(ctx, b, ns, 'guitar', v);
      }),
    suits: { haze: 2, ember: 1, drift: 1, pulse: 1 },
    busy: true,
  },
  electric: {
    write: (ctx, v) => bars(ctx, (b) => pick(ctx, b, 'electric', [0, 3, 4, 5, 3, 4], 2, v, 52)),
    suits: { pulse: 3, rise: 1, haze: 2, cathedral: 1, drift: 1, acid: 1 },
  },
  vibes: {
    write: (ctx, v) =>
      bars(ctx, (b) => {
        const top = ctx.chordAt(b).voicing.slice(-3).map((n) => n + 12);
        for (const s of [0, ctx.spb === 12 && ctx.mv.meter === '3/4' ? 4 : ctx.spb / 2]) {
          for (const n of top) ctx.push({ i: 'mallet', t: ctx.barAt(b, s), n, v: v * 0.6, k: 'vibes' });
        }
      }),
    suits: { haze: 2, garden: 2, nocturne: 1, pulse: 1, ember: 1 },
  },
  piano: {
    write: (ctx, v) => bars(ctx, (b) => pianoBar(ctx, b, 'broken', v * 0.8)),
    suits: { drift: 2, haze: 2, cathedral: 2, ember: 1, garden: 1, pulse: 1 },
  },
  choir: {
    write: (ctx, v) => choir(ctx, ctx.role === 'chorus' || ctx.role === 'drop' ? 'a' : 'm', 0.9 * v),
    suits: { drift: 2, nocturne: 2, ember: 2, pulse: 1, garden: 1, haze: 1, rise: 1 },
  },
  strings: {
    write: (ctx, v) => padChords(ctx, 'strings', { cut: () => [2400, 3400], g: 0.7 * v, transpose: 12 }),
    suits: { haze: 1, garden: 2, pulse: 1, rise: 1, ember: 1, drift: 1, nocturne: 2 },
  },
  organ: {
    write: (ctx, v) => organChords(ctx, 0.8 * v),
    suits: { ember: 2, drift: 1, haze: 1, pulse: 1 },
  },
  congas: {
    write: (ctx, v) => bars(ctx, (b) => percBar(ctx, b, { conga: 'x..o..x.x..o....', congaHi: '......x.......x.' }, v)),
    suits: { haze: 2, pulse: 1, drift: 1, acid: 1, rise: 1 },
    busy: true,
  },
  acid: {
    write: (ctx, v) =>
      acidLine(ctx, acidPattern(ctx.mrng.fork('colour-acid')), 0, ctx.bars, [260, 900], 0.75, 0.7 * v, false),
    suits: { rise: 2, pulse: 2 },
    busy: true,
  },
  glock: {
    write: (ctx, v) => {
      const m = makeMotif(ctx.mrng.fork('glock'), inMeter(TEXTURE, ctx.mv.meter));
      play(
        ctx,
        'bell',
        phrase(ctx, m, 0, ctx.bars, { center: 7, lo: 3, hi: 13, stretch: 2 }),
        v * 0.9,
        false,
      );
    },
    suits: { ember: 1, pulse: 2, garden: 2, haze: 1, cathedral: 1, rise: 1 },
  },
  pluck: {
    write: (ctx, v) => bars(ctx, (b) => arp(ctx, b, 'broken', { v: v * 0.8, cut: () => 1800, rate: 2, dec: 0.6 })),
    suits: { garden: 1, haze: 1, cathedral: 1, ember: 1, acid: 1 },
  },
  hum: {
    write: (ctx, v) => {
      const m = makeMotif(ctx.mrng.fork('hum-line'), inMeter(TEXTURE, ctx.mv.meter));
      play(
        ctx,
        'wind:hum',
        phrase(ctx, m, 0, ctx.bars, { center: -1, lo: -5, hi: 5, stretch: 2 }),
        v,
        false,
      );
    },
    suits: { drift: 2, garden: 2, haze: 2, nocturne: 1, cathedral: 1 },
  },
};

const IDS = Object.keys(COLORS) as ColorId[];

/** The movement's colour, the same for all its sections. */
function signature(ctx: Ctx): ColorId {
  const rng = ctx.mrng.fork('colours');
  // now and then a less usual choice, but never one foreign to the style (a guitar in a piano nocturne)
  const wild = rng.chance(0.2);
  const weighted = IDS.map((id) =>
    [id, (COLORS[id].suits[ctx.mv.style] ?? 0) && (wild ? 1 : COLORS[id].suits[ctx.mv.style]!)] as const
  ).filter(([, w]) => w > 0);
  return rng.weighted(weighted);
}

/**
 * How loud the colour plays in a section, or 0. It's something the piece grows into, not wallpaper: it comes in
 * when a verse or a chorus returns, and has its moment in the bridge or the break. In some pieces it is the voice
 * the piece is remembered by: it opens the piece, closes it, and plays from the first verse on.
 */
function level(ctx: Ctx): number {
  const featured = ctx.mrng.fork('featured').chance(0.35);
  switch (ctx.sec.role) {
    case 'intro':
      return featured ? 0.5 : 0;
    case 'outro':
      return featured ? 0.45 : 0;
    case 'verse':
      return ctx.returning ? 0.45 : featured ? 0.4 : 0;
    case 'chorus':
      return ctx.returning ? 0.4 : featured ? 0.35 : 0;
    case 'drop':
      return ctx.returning ? 0.35 : 0;
    case 'bridge':
    case 'break':
      return 0.45;
    default:
      return 0;
  }
}

export function colours(ctx: Ctx): void {
  const c = COLORS[signature(ctx)];
  const v = level(ctx);
  if (v <= 0 || (c.busy && ctx.sec.energy < 0.4)) return;
  const from = ctx.events.length;
  c.write(ctx, v);
  // opening a piece, it comes in on the intro's second bar: a piece opens quietly (see opening())
  if (ctx.role !== 'intro') return;
  const kept = ctx.events.slice(from).filter((e) => e.t >= ctx.bar - 1e-6);
  ctx.events.length = from;
  ctx.events.push(...kept);
}
