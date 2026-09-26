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

import { MOODS } from '../moods.ts';
import type { Rng } from '../rng.ts';
import { MODES, pc } from '../theory.ts';
import { type Ev, isMelody, type Note, type StyleId, TAKES, VIB_HELD } from '../types.ts';
import type { Ctx } from './context.ts';
import { ANYONE, guitarist } from './guitarist.ts';

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

/** One player's reading of their part; `hands` seeds their sense of time, shared by the parts they play. */
function player(ctx: Ctx, rng: Rng, hands: Rng, { drift, jitter, loud: moves, melody }: Touch) {
  const time = wander(hands.fork('time'));
  const loud = wander(rng.fork('loud'));
  const phrase = 4 * ctx.bar;
  // the mood's touch: held on in grief or peace, detached in joy
  const legato = MOODS[ctx.mv.mood].legato;
  return (n: Played, breath: boolean, short: boolean): void => {
    let v = n.v * (1 + moves * (loud(n.t) + rng.jitter(0.8)));
    // a phrase swells towards its middle and relaxes at its end
    if (melody) v *= 0.9 + 0.2 * Math.sin(Math.PI * ((n.t % phrase) / phrase));
    let t = n.t + drift * time(n.t) + rng.jitter(jitter);
    let d = n.d;
    if (d !== undefined && moves) d *= Math.min(1, (short ? rng.range(0.72, 0.92) : rng.range(0.9, 1)) * legato);
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
  // after the timing: a grace note stays with its note, however late that comes
  ornament(ctx);
  drummer(ctx);
  listen(ctx);
  pedal(ctx);
  hammers(ctx);
  fretwork(ctx);
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
    // a pianist's two hands keep one time: the tune and the accompaniment drift together
    const hands = ctx.rng.fork('perform', events[0].i === 'piano' ? 'piano' : name);
    const play = player(ctx, ctx.rng.fork('perform', name), hands, how);
    const onsets = events.flatMap((e) => ('ns' in e ? e.ns.map((n) => n.t) : [e.t])).sort((a, b) => a - b);
    // a breath: a rest of half a beat or more after the note (a note without a length: nothing new for 1.5 beats)
    const breathAfter = (t: number, d?: number) => {
      const next = onsets.find((x) => x > t + 1e-6);
      return next === undefined || (d === undefined ? next - t >= 1.5 * ctx.beat : next - (t + d) >= ctx.beat / 2);
    };
    events.forEach((e, index) => {
      if ('ns' in e) {
        const ns = e.ns as Note[];
        ns.forEach((n, k) => {
          const gap = (ns[k + 1]?.t ?? n.t + n.d) - n.t;
          play(n, breathAfter(n.t, n.d), gap < ctx.beat * 0.75);
        });
        e.t = ns[0].t;
        return;
      }
      const d = 'd' in e ? e.d : undefined;
      const n: Played = { t: e.t, v: 'v' in e ? e.v : 1, d };
      play(n, breathAfter(e.t, d), d !== undefined && d < ctx.beat * 0.75);
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

/** Whether a style's drums are played by a drummer (else a drum machine plays them as programmed). */
export const drummed = (style: StyleId): boolean => style in FEEL;

/** How far each limb's dynamics reach: a stroke's level against the loudest of its part is raised to this. */
// a real ghost note sits 19 to 25 dB under the backbeat (measured on recorded kits): x^2 puts the grid's ghost
// ('-', 0.42) 15 dB down, and the drummer's own variation spreads it from there
const REACH: Record<Limb, number> = { kick: 1, snare: 2, hat: 1.3, perc: 1.3, tom: 1.2 };

const CYMBALS: ReadonlySet<string> = new Set(['ride', 'crash', 'acousticRide', 'acousticCrash']);
const limbOf = (e: Hit): Limb => e.i === 'perc' ? (CYMBALS.has(e.k) ? 'hat' : 'perc') : e.i;

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
  const flams: Hit[] = [];
  for (const e of ctx.events) {
    if (e.i !== 'kick' && e.i !== 'snare' && e.i !== 'hat' && e.i !== 'perc' && e.i !== 'tom') continue;
    // each tom is a drum of its own
    const part = `${e.i}:${e.i === 'tom' ? e.n : 'k' in e ? e.k : ''}`;
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
    // a take other than the stroke before's
    let last = -1;
    const fresh = () => {
      const k = rng.int(last < 0 ? TAKES : TAKES - 1);
      return (last = last >= 0 && k >= last ? k + 1 : k);
    };
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
      // a fill's accents are flammed: the other stick a hair before, softly
      const fill = rb % 8 === 7 && into > 0 && rel > 0.8;
      if ((limb === 'snare' || limb === 'tom') && fill && rng.chance(0.5)) {
        const t = Math.max(0, e.t - rng.range(0.018, 0.03));
        flams.push({ ...e, t, v: e.v * rng.range(0.3, 0.45), take: fresh() });
      }
      e.take = fresh();
    }
  }
  ctx.push(...flams);
}

// ------------------------------------------------------------------ the rest of the band

/** One note of the melody, wherever it's written: an event of its own, or a note of a line. */
interface Sung {
  t: number;
  d: number;
  n: number;
  /** Ends the note at `d` seconds. */
  cut(d: number): void;
  /** Adds a grace note leaning into this one. */
  lean(t: number, d: number, n: number): void;
}

/** The melody's notes, in time order; a note without a length lasts until the next. */
function melodyNotes(ctx: Ctx): Sung[] {
  const out: (Omit<Sung, 'd'> & { d?: number })[] = [];
  for (const e of ctx.events) {
    if (!isMelody(e)) continue;
    if ('ns' in e) {
      const ns: Note[] = e.ns;
      for (const x of ns) {
        out.push({
          t: x.t,
          d: x.d,
          n: x.n,
          cut: (d) => (x.d = d),
          lean: (t, d, n) => {
            ns.splice(ns.indexOf(x), 0, { t, d, n, v: x.v * 0.7 });
            e.t = ns[0].t;
          },
        });
      }
    } else if (e.i === 'string' || e.i === 'mallet' || e.i === 'piano' || e.i === 'bell') {
      const n = typeof e.n === 'number' ? e.n : e.n[0];
      out.push({
        t: e.t,
        d: 'd' in e ? e.d : undefined,
        n,
        cut: (d) => {
          if ('d' in e) e.d = d;
        },
        lean: (t, d, m) =>
          ctx.push({ ...e, t, v: e.v * 0.7, n: typeof e.n === 'number' ? m : [m], ...('d' in e ? { d } : {}) } as Ev),
      });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out.map((x, k) => ({ ...x, d: x.d ?? (out[k + 1] ? out[k + 1].t - x.t : ctx.beat) }));
}

/**
 * A returning melody is ornamented a little, differently each time: a grace note a step above, or a semitone
 * below, leans into a few of its longer notes. The written hook stays; only its playing changes. A hook doubled
 * by a second voice is played plain (the two would ornament it differently), and a sequencer never ornaments.
 */
function ornament(ctx: Ctx): void {
  if (!ctx.returning) return;
  const voices = new Set(ctx.events.filter(isMelody).map((e) => `${e.i}:${'k' in e ? e.k : ''}`));
  const first = ctx.events.find(isMelody);
  if (voices.size !== 1 || !first || !touch(ctx, first)) return;
  const rng = ctx.rng.fork('ornament');
  const grace = Math.min(0.08, ctx.s16 / 2);
  const scale = MODES[ctx.key.mode].map((x) => (x + ctx.key.tonic) % 12);
  const above = (n: number) => (scale.includes(pc(n + 1)) ? n + 1 : n + 2);
  const mel = melodyNotes(ctx);
  let budget = Math.max(1, Math.round(ctx.bars / 4));
  for (let k = 0; k < mel.length && budget > 0; k++) {
    const m = mel[k];
    const prev = mel[k - 1];
    const onBeat = Math.abs(m.t / ctx.beat - Math.round(m.t / ctx.beat)) < 0.06;
    // room before it: a rest, or a note long enough to lend it the time
    const room = !prev || prev.t + prev.d <= m.t - grace || m.t - grace - prev.t >= grace;
    if (m.d < ctx.beat || !onBeat || !room || m.t < grace || !rng.chance(0.35)) continue;
    budget--;
    if (prev && prev.t + prev.d > m.t - grace) prev.cut(m.t - grace - prev.t);
    m.lean(m.t - grace, grace, rng.chance(0.6) ? above(m.n) : m.n - 1);
  }
}

/**
 * An ensemble listens to its singer: under a melody note the accompaniment plays softer, in the melody's rests a
 * little fuller. And it moves together: into a bigger section the band swells through its last bar, into a
 * calmer one it eases off. Only people listen: sequenced parts play on as programmed.
 */
function listen(ctx: Ctx): void {
  const mel = melodyNotes(ctx);
  const next = ctx.isLast ? null : ctx.mv.sections[ctx.local + 1];
  const lift = next && next.role !== 'rest' ? next.energy - ctx.sec.energy : 0;
  const from = ctx.duration - ctx.bar;
  const shape = (t: number, bed: boolean) => {
    let g = 1;
    if (bed && mel.length) g *= mel.some((m) => t >= m.t - 0.02 && t < m.t + m.d) ? 0.8 : 1.12;
    const x = Math.min(1, Math.max(0, (t - from) / ctx.bar));
    if (lift > 0.1) g *= 1 + Math.min(0.25, lift) * x;
    else if (lift < -0.15) g *= 1 - 0.15 * x;
    return g;
  };
  for (const e of ctx.events) {
    if (!touch(ctx, e)) continue;
    // the bass keeps its level under the tune; the rest of the band makes room for it
    const bed = !isMelody(e) && e.i !== 'bass';
    if ('ns' in e) { for (const n of e.ns) n.v *= shape(n.t, bed); }
    else if ('v' in e) e.v *= shape(e.t, bed);
  }
}

/** Styles whose pianist keeps the sustain pedal down through each chord: the slow, legato ones. */
const PEDAL: ReadonlySet<StyleId> = new Set(['nocturne', 'cathedral', 'drift']);

/**
 * The sustain pedal in a slow piece: held through each chord and changed just after the next one is struck
 * (legato pedalling), so a broken chord rings on as a chord and the harmony never blurs into the next one. The
 * melody's notes ring into the note after them.
 */
function pedal(ctx: Ctx): void {
  if (!PEDAL.has(ctx.mv.style)) return;
  const changes = [...ctx.chords.slice(1).map((c) => ctx.barAt(c.bar)), ctx.duration];
  // a note up to 50 ms early belongs to the chord it anticipates
  const up = (t: number) => (changes.find((x) => x > t + 0.05) ?? ctx.duration) + 0.06;
  const piano = ctx.events.filter((e): e is Extract<Ev, { i: 'piano' }> => e.i === 'piano').sort((a, b) => a.t - b.t);
  const tune = piano.filter(isMelody);
  for (const e of piano) {
    const held = up(e.t);
    const next = isMelody(e) ? tune.find((x) => x.t > e.t + 1e-6) : undefined;
    const end = next ? Math.min(held, next.t + 0.03) : held;
    e.d = Math.max(e.d, end - e.t);
    e.pedal = true;
  }
}

/** Seconds of hammer flight per unit of (1 - velocity)^2, against a key struck at 0.6. */
const HAMMER = 0.1;

/**
 * A piano's hammers fly: a key struck hard sounds sooner after the finger than one pressed gently, so a melody
 * played out over a soft accompaniment sounds a few tens of ms ahead of it, one of the ways a pianist's tune
 * stands out (Goebl, "Melody lead in piano performance: expressive device or artifact?", 2001). Centred on a
 * middling touch, so the piano as a whole stays with the band.
 */
function hammers(ctx: Ctx): void {
  for (const e of ctx.events) {
    if (e.i === 'piano') e.t = Math.max(0, e.t + HAMMER * ((1 - Math.min(1, e.v)) ** 2 - 0.16));
  }
}

/**
 * A guitarist's fretting hand. A note a step from the one before and joined to it is hammered on or pulled
 * off, not picked (always after a grace note, unless the hand wears a slide); a held note joined to the one
 * before may be slid to from it along the ringing string; a held note on an electric may be picked on the scale's
 * note below and bent up to; a held note reached by a leap is sometimes slid into from a fret or two away; on an acoustic's wound
 * strings a shift of the hand squeaks now and then, in a line and between the chords of a strummed part. The
 * tune is the lead guitarist's, played their way (see guitarist.ts): how often they do each, how they shake a
 * held note, where they sit against the beat.
 */
function fretwork(ctx: Ctx): void {
  const rng = ctx.rng.fork('fretwork');
  const lead = guitarist(ctx).hands;
  const scale = MODES[ctx.key.mode].map((x) => (x + ctx.key.tonic) % 12);
  type Str = Extract<Ev, { i: 'string' }>;
  const strings = ctx.events.filter((e): e is Str => e.i === 'string' && e.k !== 'harp').sort((a, b) => a.t - b.t);
  const lines = new Map<string, Str[]>();
  for (const e of strings) {
    const part = `${e.k}:${e.lead === undefined ? 'chords' : e.lead ? 'melody' : 'line'}`;
    const known = lines.get(part);
    if (known) known.push(e);
    else lines.set(part, [e]);
  }
  for (const [part, notes] of lines) {
    if (part.endsWith(':chords')) {
      // a strummed or picked part: the hand moves when the chord does
      if (notes[0].k !== 'guitar') continue;
      for (let k = 1; k < notes.length; k++) {
        const moved =
          ctx.chordAt(Math.floor(notes[k].t / ctx.bar)) !== ctx.chordAt(Math.floor(notes[k - 1].t / ctx.bar));
        if (moved && notes[k].t - notes[k - 1].t > 0.1 && rng.chance(0.15)) notes[k].squeak = rng.range(0.2, 0.5);
      }
      continue;
    }
    const melody = part.endsWith(':melody');
    const h = melody ? lead : ANYONE;
    // a slide's time along the frets, as the synth's quick one, times the player's
    const glide = (semitones: number) => h.glide * (0.04 + 0.03 * semitones);
    for (let k = 1; k < notes.length; k++) {
      const a = notes[k - 1];
      const b = notes[k];
      const iv = Math.abs(b.n - a.n);
      const end = a.t + (a.d ?? ctx.beat);
      const joined = end > b.t - 0.03 && b.t - a.t <= ctx.beat * 1.01;
      const grace = (a.d ?? ctx.beat) <= 0.09;
      const held = (b.d ?? 0) >= ctx.beat;
      // a player who slides to the next note holds this one on until they do
      const close = b.t - end < Math.min(0.3, ctx.beat / 2) && b.t - a.t <= 2 * ctx.beat;
      if (iv >= 1 && iv <= 2 && joined && ((grace && h.slur > 0) || rng.chance(h.slur))) {
        b.slur = true;
        a.d = b.t - a.t;
      } else if (iv >= 1 && iv <= 7 && close && held && rng.chance(h.legato)) {
        b.slur = true;
        b.slide = a.n - b.n;
        b.glide = glide(iv);
        a.d = b.t - a.t;
      } else if (b.k !== 'guitar' && held && rng.chance(h.bend)) {
        // picked on the scale's note below and pushed up to it: slower than a finger slides
        const up = scale.includes(pc(b.n - 1)) ? 1 : 2;
        b.slide = -up;
        b.glide = 0.12 + 0.06 * up;
      } else if (iv >= 3 && held && rng.chance(h.slide)) {
        b.slide = (b.n > a.n ? -1 : 1) * rng.pick([1, 2]);
        if (h.glide !== 1) b.glide = glide(Math.abs(b.slide));
      }
      if (b.k === 'guitar' && iv >= 5 && b.t - end > 0.08 && rng.chance(0.3)) b.squeak = rng.range(0.3, 0.7);
    }
    if (!melody) continue;
    for (const e of notes) {
      e.t = Math.max(0, e.t + h.lag);
      if (e.vib === undefined && !e.swell && (e.d ?? 0) >= VIB_HELD) {
        e.vib = h.vib;
        e.vibRate = h.rate;
      }
    }
  }
}
