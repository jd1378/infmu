// A player's touch. Written notes sit exactly on the grid at a handful of fixed velocities; players don't. This
// pass performs each pitched part the way the KTH performance rules describe (Friberg, Bresin and Sundberg,
// "Overview of the KTH rule system for musical performance", 2006): a melody swells towards the middle of its
// phrase and relaxes at the end; the last note before a breath comes a little late and is held longer; each
// player drifts slowly and on their own around the beat (correlated, not jittered: white-noise timing only
// sounds sloppy); short notes are detached and long ones joined; chords are rolled a little differently every
// time. Only what a person would play is performed: arpeggiators, the 303 and the sequenced leads of dance
// music keep a machine's grid, and the kick and the bass keep time (groove research finds wobble there only
// hurts; a bassist's touch shows in dynamics). A style played by a band has a drummer too (see drummer()).
// Everything is drawn from the seed's own streams, so a seed still plays the same performance.

import type { Rng } from '../rng.ts';
import { type Ev, isMelody, type Note, type StyleId, TAKES } from '../types.ts';
import type { Ctx } from './context.ts';

/** How a part is played: how far its player drifts (s), their jitter (s), how much their dynamics move. */
interface Touch {
  drift: number;
  jitter: number;
  loud: number;
  /** The tune: phrase dynamics and breaths. */
  melody: boolean;
}

const PLAYED: ReadonlySet<Ev['i']> = new Set(['string', 'piano', 'mallet', 'keys', 'bell', 'wind', 'lead']);

/** Who plays a part: a person (how), or a machine (null: it stays exactly as written). */
function touch(ctx: Ctx, e: Ev): Touch | null {
  switch (e.i) {
    case 'lead':
      // trance and acid leads are sequenced; brass and flute are always played
      if ((ctx.mv.style === 'rise' || ctx.mv.style === 'acid') && e.k !== 'brass' && e.k !== 'flute') return null;
      break;
    case 'bass':
      // a bassist (round, saw) plays in time with the kick, with their own dynamics; synth basses are sequenced
      return e.k === 'round' || e.k === 'saw' ? { drift: 0, jitter: 0.0015, loud: 0.05, melody: false } : null;
    case 'choir':
    case 'organ':
      return { drift: 0.008, jitter: 0.004, loud: 0, melody: false };
  }
  if (!PLAYED.has(e.i)) return null;
  const melody = isMelody(e);
  return { drift: melody ? 0.012 : 0.008, jitter: 0.003, loud: 0.06, melody };
}

/** A slow wander in about [-1, 1]: three unrelated slow sines, as a player's drift around the beat. */
function wander(rng: Rng): (t: number) => number {
  const parts = [0, 1, 2].map(() => [rng.range(0.07, 0.5), rng.range(0, 2 * Math.PI)] as const);
  return (t) => parts.reduce((s, [f, ph]) => s + Math.sin(2 * Math.PI * f * t + ph), 0) / 2;
}

type Played = { t: number; v: number; d?: number };

/** One player's reading of their part. */
function player(ctx: Ctx, rng: Rng, { drift, jitter, loud: moves, melody }: Touch) {
  const time = wander(rng.fork('time'));
  const loud = wander(rng.fork('loud'));
  const phrase = 4 * ctx.bar;
  return (n: Played, breath: boolean, short: boolean): void => {
    let v = n.v * (1 + moves * (loud(n.t) + rng.jitter(0.8)));
    // a phrase swells towards its middle and relaxes at its end
    if (melody) v *= 0.9 + 0.2 * Math.sin(Math.PI * ((n.t % phrase) / phrase));
    let t = n.t + drift * time(n.t) + rng.jitter(jitter);
    let d = n.d;
    if (d !== undefined && moves) d *= short ? rng.range(0.72, 0.92) : rng.range(0.9, 1);
    // the last note before a breath comes a little late and is held on
    if (breath && melody) {
      t += Math.min(0.035, 0.06 * ctx.beat) * rng.range(0.5, 1);
      if (d !== undefined) d *= 1.12;
    }
    n.t = Math.max(0, t);
    n.v = Math.max(0.05, v);
    if (d !== undefined) n.d = d;
  };
}

export function perform(ctx: Ctx): void {
  players(ctx);
  drummer(ctx);
}

function players(ctx: Ctx): void {
  const parts = new Map<string, { how: Touch; events: Ev[] }>();
  for (const e of ctx.events) {
    const part = `${e.i}:${'k' in e ? e.k : ''}:${isMelody(e) ? 'melody' : ''}`;
    const known = parts.get(part);
    if (known) known.events.push(e);
    else {
      const how = touch(ctx, e);
      if (how) parts.set(part, { how, events: [e] });
    }
  }
  for (const [name, { how, events }] of parts) {
    const play = player(ctx, ctx.rng.fork('perform', name), how);
    const onsets = events.flatMap((e) => ('ns' in e ? e.ns.map((n) => n.t) : [e.t])).sort((a, b) => a - b);
    // a breath: nothing new from this part for a beat or more after the note
    const breathAfter = (t: number) => {
      const next = onsets.find((x) => x > t + 1e-6);
      return next === undefined || next - t >= ctx.beat;
    };
    events.forEach((e, index) => {
      if ('ns' in e) {
        const ns = e.ns as Note[];
        ns.forEach((n, k) => {
          const gap = (ns[k + 1]?.t ?? n.t + n.d) - n.t;
          play(n, breathAfter(n.t), gap < ctx.beat * 0.75);
        });
        e.t = ns[0].t;
        return;
      }
      const d = 'd' in e ? e.d : undefined;
      const n: Played = { t: e.t, v: 'v' in e ? e.v : 1, d };
      play(n, breathAfter(e.t), d !== undefined && d < ctx.beat * 0.75);
      e.t = n.t;
      if ('v' in e) e.v = n.v;
      if ('d' in e && n.d !== undefined) e.d = n.d;
      // a chord is rolled a little differently every time
      if (e.i === 'piano') e.strum = (e.strum ?? 0.01) * ctx.rng.fork('roll', name, index).range(0.6, 1.6);
    });
  }
}

// ------------------------------------------------------------------ the drummer

type Limb = 'kick' | 'snare' | 'hat' | 'perc' | 'tom';
type Hit = Extract<Ev, { i: 'kick' | 'snare' | 'hat' | 'perc' | 'tom' }>;

/**
 * Where each limb of a style's drummer sits against the beat, in seconds (+ late). A feel is systematic, not
 * random: drummers asked to play laid back or pushed place their strokes consistently a few ms off the beat
 * (Danielsen et al., "Effects of instructed timing and tempo on snare drum sound in drum kit performance",
 * 2015). The styles without an entry are played by a drum machine: the same sample, exactly where it was
 * programmed.
 */
const FEEL: Partial<Record<StyleId, Record<Limb, number>>> = {
  // a lazy rim, a shaker a hair ahead
  drift: { kick: 0, snare: 0.008, hat: -0.002, perc: 0.004, tom: 0.004 },
  // the lean of a sampled break: kicks early, hats and snares behind (the grooves' own lag adds to it)
  haze: { kick: -0.004, snare: 0.004, hat: 0.006, perc: 0.006, tom: 0 },
  // the shaker drives, the hand drums sit back
  garden: { kick: 0, snare: 0.006, hat: -0.003, perc: 0.005, tom: 0 },
  // heavy sticks speak late
  cathedral: { kick: 0, snare: 0.003, hat: 0, perc: 0.002, tom: 0.006 },
  nocturne: { kick: 0, snare: 0.004, hat: 0, perc: 0.004, tom: 0.004 },
  // a rock drummer pushes on the cymbals and leans back on a fat backbeat
  ember: { kick: 0, snare: 0.006, hat: -0.004, perc: -0.003, tom: 0.002 },
};

/** How far each limb's dynamics reach: a stroke's level against the loudest of its part is raised to this. */
const REACH: Record<Limb, number> = { kick: 1, snare: 1.6, hat: 1.3, perc: 1.3, tom: 1.2 };

const limbOf = (e: Hit): Limb => e.i === 'perc' ? (e.k === 'ride' || e.k === 'crash' ? 'hat' : 'perc') : e.i;

/**
 * A drummer plays the written kit: ghost notes fall well under the backbeat (a machine plays the grid's three
 * levels; a player's reach is wider) and are never twice the same; every limb sits where the style's feel puts
 * it and wanders a little around there, slowly, as players do; the last bar of each phrase swells into the
 * next; and every stroke is one of the drum's takes, never the same take twice in a row.
 */
function drummer(ctx: Ctx): void {
  const feel = FEEL[ctx.mv.style];
  if (!feel) return;
  // one drummer across the movement: their drift runs on through the sections
  const from = ctx.mv.sections.slice(0, ctx.local).reduce((n, s) => n + s.bars, 0) * ctx.bar;
  const parts = new Map<string, Hit[]>();
  for (const e of ctx.events) {
    if (e.i !== 'kick' && e.i !== 'snare' && e.i !== 'hat' && e.i !== 'perc' && e.i !== 'tom') continue;
    const part = `${e.i}:${'k' in e ? e.k : ''}`;
    const known = parts.get(part);
    if (known) known.push(e);
    else parts.set(part, [e]);
  }
  for (const [name, hits] of parts) {
    hits.sort((a, b) => a.t - b.t);
    const limb = limbOf(hits[0]);
    const rng = ctx.rng.fork('drummer', name);
    const time = wander(ctx.mrng.fork('drummer', limb, 'time'));
    const loud = wander(ctx.mrng.fork('drummer', limb, 'loud'));
    const top = Math.max(...hits.map((e) => e.v));
    let take = rng.int(TAKES);
    for (const e of hits) {
      const rel = e.v / top;
      let v = top * rel ** REACH[limb];
      // ghost notes vary most
      v *= 1 + 0.05 * loud(from + e.t) + rng.jitter(0.04 + 0.12 * (1 - rel));
      // the last bar of a phrase swells into the next: more at the end of eight bars than of four
      const bar = Math.floor((e.t + 0.01) / ctx.bar);
      const rb = ctx.runBar(bar);
      const into = (e.t / ctx.bar - bar - 0.5) * 2;
      if (rb % 4 === 3 && into > 0) v *= 1 + (rb % 8 === 7 ? 0.25 : 0.12) * into;
      e.v = Math.max(0.02, v);
      e.t = Math.max(0, e.t + feel[limb] + 0.003 * time(from + e.t) + (limb === 'kick' ? rng.jitter(0.0015) : 0));
      e.take = take;
      take = (take + 1 + rng.int(TAKES - 1)) % TAKES;
    }
  }
}
