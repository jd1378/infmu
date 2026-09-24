// One arranger per style: given a section's role (intro, verse, drop...), decide which parts play and how.
// Choices that should stay the same for a whole movement (hook, drum pattern, arp shape) come from the
// movement's stream `ctx.mrng`; per-section detail comes from `ctx.rng`.

import type { LeadKind, Note, StyleId } from '../types.ts';
import type { Ctx } from './context.ts';
import { makeMotif, phrase } from './melody.ts';
import {
  arp,
  arpNotes,
  type ArpShape,
  bassFigure,
  type BassHit,
  comp,
  cymbalInto,
  drums,
  EIGHTHS,
  OCTAVES,
  OFFBEAT,
  organChords,
  padChords,
  roll,
  ROLLING,
  stab,
  sustainedBass,
  tomFill,
  transition,
} from './parts.ts';

export function arrange(ctx: Ctx): void {
  ARRANGERS[ctx.mv.style](ctx);
  transition(ctx);
}

function lead(ctx: Ctx, k: LeadKind, ns: Note[]): void {
  if (ns.length) ctx.push({ i: 'lead', t: ns[0].t, k, ns });
}

function bells(ctx: Ctx, ns: Note[], v: number): void {
  for (const n of ns) ctx.push({ i: 'bell', t: n.t, n: [n.n], v: v * n.v });
}

const halves = (ctx: Ctx) => ({ half: Math.floor(ctx.bars / 2), last: ctx.bars - 1 });

// ------------------------------------------------------------------ rise: trance

function rise(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const hook = makeMotif(mrng.fork('hook'), 0.75);
  const counter = makeMotif(mrng.fork('counter'), 0.3);
  const shape = mrng.fork('arp').pick<ArpShape>(['hemi', 'hemi', 'updown', 'broken']);
  const rolling = mrng.fork('bass').pick(ROLLING);
  const first = ctx.chords[0];

  if (ctx.isFirst) ctx.push({ i: 'impact', t: 0, k: 'hit', a: 1, n: stab(first) });

  switch (ctx.role) {
    case 'intro':
      padChords(ctx, 'warm', { cut: (_, i) => [1100 + 300 * i, 1400 + 350 * i], g: 0.85 });
      sustainedBass(ctx, 'sub', 0.38);
      for (let b = 0; b < bars; b++) {
        drums(
          ctx,
          b,
          {
            kick: 'x.........x.....',
            shaker: b >= 2 ? '-o-o-o-o-o-o-o-o' : undefined,
            snare: b >= half ? '........o.......' : undefined,
          },
          { kick: 'soft', snare: 'clap', sc: 0.22 },
          0.8,
        );
        if (b >= 2) arp(ctx, b, shape, { v: 0.85, cut: (x) => 500 * 2 ** (2.5 * x) });
      }
      break;
    case 'verse': {
      padChords(ctx, 'wide', { cut: () => [2600, 4200], g: 0.62 });
      for (let b = 0; b < bars; b++) {
        drums(ctx, b, {
          kick: 'x...x...x...x...',
          snare: b >= 2 ? '....o.......o...' : undefined,
          hat: '--.---.---.---.-',
          open: '..o...o...o...o.',
        }, { kick: 'big', snare: 'clap', sc: 0.45 });
        bassFigure(ctx, b, OFFBEAT, 'saw', 0.45);
        arp(ctx, b, shape, { v: 0.62, cut: () => 2400 });
      }
      if (bars >= 8) {
        lead(
          ctx,
          'brass',
          phrase(ctx, mrng.fork('counter-phrase'), counter, half, half, {
            center: 1,
            lo: -3,
            hi: 6,
            transpose: -12,
            velocity: 0.8,
          }),
        );
      }
      break;
    }
    case 'build':
      padChords(ctx, 'wide', { cut: (_, i) => [2000 + 700 * i, 3000 + 900 * i], g: 0.6 });
      for (let b = 0; b < bars; b++) {
        drums(ctx, b, { kick: b < last ? 'x...x...x...x...' : 'x.x.x.x.x.x.x.x.' }, { kick: 'big', sc: 0.45 });
        bassFigure(ctx, b, b < last ? OFFBEAT : EIGHTHS, 'saw', 0.38 + (0.1 * b) / bars);
        arp(ctx, b, shape, { v: 0.7, cut: (x) => 700 * 2 ** (2.8 * x) });
      }
      roll(ctx, 0, [[bars / 2, bars * 2], [bars / 4, bars * 2], [bars / 4, bars * 4]], 0.35, 0.85);
      ctx.push({ i: 'rise', t: 0, d: ctx.duration, k: 'build' }, { i: 'sweep', t: 0, d: ctx.duration });
      if (ctx.nextRole === 'drop') ctx.push({ i: 'breath', t: ctx.duration - ctx.s16, d: ctx.s16 });
      break;
    case 'drop': {
      ctx.push({ i: 'impact', t: 0, k: 'drop', a: 1, n: stab(first) }, { i: 'snare', t: 0, v: 0.75, k: 'huge' });
      padChords(ctx, 'drop', { cut: () => [8000, 8000] });
      const fill = ctx.nextRole !== 'drop';
      for (let b = 0; b < bars; b++) {
        const f = fill && b === last;
        drums(ctx, b, {
          kick: f ? 'x...x...x.......' : 'x...x...x...x...',
          snare: f ? '....x...........' : '....x.......x...',
          hat: 'xo.xxo.xxo.xxo.x',
          open: '..x...x...x...x.',
        }, { kick: 'drop', snare: 'clap', sc: 0.72 });
        bassFigure(ctx, b, f ? rolling.filter(([s]) => s < 12) : rolling, 'roll', 1);
      }
      if (fill) roll(ctx, bars - 0.25, [[0.125, 2], [0.125, 4]], 0.5, 0.85);
      lead(
        ctx,
        ctx.repeat ? 'hook2' : 'hook',
        phrase(ctx, mrng.fork('hook-phrase'), hook, 0, bars, { center: 3, lo: -1, hi: 10 }),
      );
      break;
    }
    case 'break':
      padChords(ctx, 'wide', { cut: () => [1800, 2600], g: 0.6 });
      sustainedBass(ctx, 'sub', 0.35);
      bells(ctx, phrase(ctx, mrng.fork('bell-phrase'), hook, 0, bars, { center: 5, lo: 0, hi: 12, stretch: 2 }), 0.7);
      for (let b = half; b < bars; b++) arp(ctx, b, shape, { v: 0.45, cut: (x) => 600 * 2 ** (1.5 * x) });
      break;
    case 'outro':
    default:
      padChords(ctx, 'warm', { cut: (_, i) => [3000 - 200 * i, 1800 - 120 * i], g: 0.8, rel: 2 });
      for (let b = 0; b < half; b++) {
        drums(ctx, b, { kick: 'x...x...x...x...', snare: '....o.......o...', open: '..o...o...o...o.' }, {
          kick: 'big',
          snare: 'clap',
          sc: 0.4,
        });
        bassFigure(ctx, b, OFFBEAT, 'saw', 0.4);
      }
      sustainedBass(ctx, 'sub', 0.35, half, bars, 2);
      for (let b = 0; b < bars - 2; b++) arp(ctx, b, shape, { v: 0.7 * (1 - b / bars), cut: () => 1400 });
      if (ctx.mv.transition === 'fade') bells(ctx, [{ t: ctx.barAt(last), d: 1, n: ctx.tonicMid + 12, v: 1 }], 0.6);
  }
  if ((ctx.nextRole === 'drop' || ctx.nextRole === 'chorus') && ctx.role !== 'build') cymbalInto(ctx);
}

// ------------------------------------------------------------------ pulse: synthwave

function pulse(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const hook = makeMotif(mrng.fork('hook'), 0.6);
  const counter = makeMotif(mrng.fork('counter'), 0.3);
  const shape = mrng.fork('arp').pick<ArpShape>(['up', 'updown', 'broken']);
  const kick = mrng.fork('kick').pick(['x.......x.x.....', 'x.......x.......', 'x.....x.x.......']);
  const kit = { kick: 'punch', snare: 'gated', sc: 0.35, hats: 0.65 } as const;
  const arps = (from: number, to: number, v: (b: number) => number, cut: (x: number) => number) => {
    for (let b = from; b < to; b++) arp(ctx, b, shape, { v: v(b), cut, from: 57, dec: 0.75 });
  };

  if (ctx.isFirst) ctx.push({ i: 'impact', t: 0, k: 'soft', a: 0.7, n: stab(ctx.chords[0]) });

  switch (ctx.role) {
    case 'intro':
      padChords(ctx, 'warm', { cut: (_, i) => [900 + 250 * i, 1200 + 300 * i], g: 0.8 });
      sustainedBass(ctx, 'sub', 0.36);
      arps(0, bars, () => 0.7, (x) => 600 * 2 ** (1.8 * x));
      for (let b = half; b < bars; b++) drums(ctx, b, { hat: 'x.o.x.o.x.o.x.o.' }, kit, 0.6);
      break;
    case 'verse':
      padChords(ctx, 'wide', { cut: () => [1800, 2400], g: 0.45 });
      arps(0, bars, () => 0.6, () => 1600);
      for (let b = 0; b < bars; b++) {
        drums(ctx, b, { kick, snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' }, kit);
        bassFigure(ctx, b, EIGHTHS, 'pulse', 0.5);
      }
      if (bars >= 8) {
        lead(
          ctx,
          'brass',
          phrase(ctx, mrng.fork('counter-phrase'), counter, half, half, {
            center: 1,
            lo: -3,
            hi: 6,
            transpose: -12,
            velocity: 0.8,
          }),
        );
      }
      break;
    case 'chorus':
      padChords(ctx, 'wide', { cut: () => [2800, 4200], g: 0.55 });
      arps(0, bars, () => 0.5, () => 2400);
      for (let b = 0; b < bars; b++) {
        const f = b === last && bars >= 8;
        drums(ctx, b, {
          kick: 'x...x...x...x...',
          snare: f ? '....x.......' : '....x.......x...',
          hat: 'x-o-x-o-x-o-x-o-',
          open: '..............o.',
        }, kit);
        if (f) tomFill(ctx, b, ctx.chordAt(b));
        bassFigure(ctx, b, OCTAVES, 'pulse', 0.55);
      }
      lead(
        ctx,
        'saw',
        phrase(ctx, mrng.fork('hook-phrase'), hook, 0, bars, {
          center: 2,
          lo: -2,
          hi: 9,
          transpose: ctx.repeat ? 12 : 0,
        }),
      );
      break;
    case 'break':
      padChords(ctx, 'warm', { cut: () => [1400, 1800], g: 0.6 });
      padChords(ctx, 'glass', { cut: () => [3000, 4000], g: 0.3, transpose: 12 });
      sustainedBass(ctx, 'sub', 0.34);
      bells(ctx, phrase(ctx, mrng.fork('bell-phrase'), hook, 0, bars, { center: 4, lo: 0, hi: 11, stretch: 2 }), 0.7);
      arps(half, bars, () => 0.4, (x) => 700 * 2 ** x);
      break;
    case 'outro':
    default:
      padChords(ctx, 'warm', { cut: (_, i) => [2200 - 200 * i, 1600 - 150 * i], g: 0.8, rel: 2 });
      arps(0, bars - 1, (b) => 0.6 * (1 - b / bars), () => 1400);
      for (let b = 0; b < half; b++) {
        drums(ctx, b, { kick, snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' }, kit, 0.85);
        bassFigure(ctx, b, EIGHTHS, 'pulse', 0.45);
      }
      sustainedBass(ctx, 'sub', 0.34, half, bars, 2);
  }
  if (ctx.nextRole === 'chorus') cymbalInto(ctx);
}

// ------------------------------------------------------------------ haze: lo-fi hip hop

const HAZE_KICKS = ['x......x..x.....', 'x.........x.....', 'x..x......x..x..', 'x......x.x......', 'x.....x...x.....'];
const HAZE_HATS = ['x.o.x.o.x.o.x.o.', 'x-o-x-o-x-o-x-o-', 'x.o.x.oox.o.x.o-'];
const COMPS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 16]],
  [[0, 6], [6, 2], [10, 6]],
  [[0, 4], [8, 6]],
  [[0, 6], [6, 6], [12, 4]],
  [[0, 10], [14, 2]],
];

/** The bass locks to the kick: a note on every kick, held to the next, plus a walk into the next chord. */
function bassFromKick(kick: string): BassHit[] {
  const on = [...kick].flatMap((c, s) => (c === 'x' || c === 'o' ? [s] : []));
  const hits: BassHit[] = on.map((s, k) => {
    const next = on[k + 1] ?? 16;
    return [s, Math.min(next, 14) - s, k === 0 ? 0 : k % 2 ? 7 : 12, k === 0 ? 1 : 0.8];
  });
  if (!on.includes(14)) hits.push([14, 2, 'A', 0.75]);
  return hits.filter(([, len]) => len > 0);
}

function haze(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half } = halves(ctx);
  const hook = makeMotif(mrng.fork('hook'), 0.45);
  const kick = mrng.fork('kick').pick(HAZE_KICKS);
  const hat = mrng.fork('hat').pick(HAZE_HATS);
  const verseComp = mrng.fork('comp').pick(COMPS.slice(1));
  const chorusComp = mrng.fork('comp2').pick(COMPS.slice(1));
  const bass = bassFromKick(kick);
  const kit = { kick: 'dusty', snare: 'dusty', hat: 'dusty', sc: 0.15 } as const;
  const snare = mrng.fork('snare').chance(0.5) ? '....x.......x..-' : '....x.......x...';
  // the last bar of a phrase: ghost notes walking into the next downbeat
  const fill = mrng.fork('fill').pick(['....x.......x-o-', '....x.....-.x.-o', '....x...-...x-x-']);

  if (ctx.mv.tone.crackle > 0) ctx.push({ i: 'vinyl', t: 0, d: ctx.duration });

  switch (ctx.role) {
    case 'intro':
      for (let b = 0; b < bars; b++) comp(ctx, b, COMPS[0], 0.55);
      break;
    case 'verse':
      for (let b = 0; b < bars; b++) {
        drums(ctx, b, { kick, snare: b === ctx.bars - 1 ? fill : snare, hat }, kit);
        bassFigure(ctx, b, bass, 'round', 0.9);
        comp(ctx, b, verseComp, 0.7);
      }
      break;
    case 'chorus':
      padChords(ctx, 'warm', { cut: () => [900, 1100], g: 0.3 });
      for (let b = 0; b < bars; b++) {
        drums(ctx, b, { kick, snare: b === ctx.bars - 1 ? fill : snare, hat, shaker: '..-...-...-...-.' }, kit);
        bassFigure(ctx, b, bass, 'round', 0.9);
        comp(ctx, b, chorusComp, 0.62);
      }
      lead(
        ctx,
        'flute',
        phrase(ctx, mrng.fork('hook-phrase'), hook, 0, bars, { center: 2, lo: -2, hi: 8, velocity: 0.9 }),
      );
      break;
    case 'break':
      for (let b = 0; b < bars; b++) {
        comp(ctx, b, COMPS[0], 0.6);
        drums(ctx, b, { hat }, kit, 0.7);
      }
      lead(
        ctx,
        'flute',
        phrase(ctx, mrng.fork('break-phrase'), hook, 0, bars, { center: 4, lo: 0, hi: 10, stretch: 2, velocity: 0.75 }),
      );
      break;
    case 'outro':
    default:
      for (let b = 0; b < bars; b++) comp(ctx, b, b < half ? verseComp : COMPS[0], 0.6);
      for (let b = 0; b < half; b++) {
        drums(ctx, b, { kick, snare }, kit, 0.85);
        bassFigure(ctx, b, bass, 'round', 0.8);
      }
  }
}

// ------------------------------------------------------------------ drift: ambient

function drift(ctx: Ctx): void {
  const { bars, mrng, rng } = ctx;
  const motif = makeMotif(mrng.fork('hook'), 0.15);
  const pulseOn = mrng.fork('pulse').chance(0.5);
  const avoid = [3, 6];
  const glassArp = (from: number, to: number, v: number) => {
    for (let b = from; b < to; b++) arp(ctx, b, 'broken', { v, cut: () => 2400, from: 64, rate: 2, dec: 0.35 });
  };

  if (ctx.isFirst) {
    ctx.push({ i: 'impact', t: 0, k: 'ping', a: 0.8 });
    bells(ctx, [{ t: 0, d: 4, n: ctx.tonicMid + 12, v: 1 }, { t: 0, d: 4, n: ctx.tonicMid + 19, v: 0.6 }], 0.8);
  }

  switch (ctx.role) {
    case 'intro':
      ctx.push({ i: 'drone', t: 0, d: ctx.duration + 2, n: ctx.tonicLow + 12 });
      padChords(ctx, 'warm', { cut: (_, i) => [1100 + 400 * i, 1600 + 400 * i], g: 0.75 });
      break;
    case 'verse':
      padChords(ctx, 'warm', { cut: () => [1600, 2800], g: 0.8 });
      sustainedBass(ctx, 'sub', 0.3);
      glassArp(0, bars, 0.4);
      for (let b = 1; b < bars; b += 2) {
        const slot = ctx.chordAt(b);
        const n = rng.pick(slot.voicing) + 12;
        bells(ctx, [{ t: ctx.barAt(b, rng.pick([0, 4, 6, 8])), d: 2, n, v: 1 }], 0.45);
      }
      break;
    case 'chorus':
      padChords(ctx, 'warm', { cut: () => [2000, 3200], g: 0.75 });
      padChords(ctx, 'glass', { cut: () => [4500, 7000], g: 0.3, transpose: 12 });
      sustainedBass(ctx, 'sub', 0.32);
      glassArp(0, bars, 0.35);
      bells(
        ctx,
        phrase(ctx, mrng.fork('bell-phrase'), motif, 0, bars, { center: 4, lo: 0, hi: 11, stretch: 2, avoid }),
        0.7,
      );
      if (pulseOn) { for (let b = 0; b < bars; b++) drums(ctx, b, { shaker: '-.-o-.-o-.-o-.-o' }, {}, 0.5); }
      break;
    case 'break':
      padChords(ctx, 'strings', { cut: () => [2500, 4000], g: 0.6 });
      bells(
        ctx,
        phrase(ctx, mrng.fork('break-phrase'), motif, 0, bars, { center: 2, lo: -2, hi: 9, stretch: 2, avoid }),
        0.6,
      );
      break;
    case 'outro':
    default:
      padChords(ctx, 'warm', { cut: (_, i) => [2400 - 250 * i, 1400 - 150 * i], g: 0.75, rel: 3 });
      sustainedBass(ctx, 'sub', 0.28, 0, bars, 3);
      glassArp(0, Math.max(1, bars - 2), 0.3);
  }
}

// ------------------------------------------------------------------ cathedral: cinematic

function cathedral(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const hook = makeMotif(mrng.fork('hook'), 0.45);
  const first = ctx.chords[0];
  const taiko = (b: number, v: number) => {
    const low = ctx.tonicLow + 12;
    for (const [s, n, vv] of [[0, low, 1], [6, low + 7, 0.7], [10, low, 0.85]] as const) {
      ctx.push({ i: 'tom', t: ctx.barAt(b, s), v: v * vv, n });
    }
  };

  if (ctx.isFirst) ctx.push({ i: 'impact', t: 0, k: 'cosmic', a: 0.7, n: stab(first) });

  switch (ctx.role) {
    case 'intro':
      ctx.push({ i: 'drone', t: 0, d: ctx.duration + 2, n: ctx.tonicLow + 12 });
      organChords(ctx, 0.6);
      if (ctx.isFirst) bells(ctx, [{ t: 0, d: 4, n: ctx.tonicMid + 12, v: 1 }], 0.7);
      break;
    case 'verse':
      organChords(ctx, 0.85);
      padChords(ctx, 'strings', { cut: () => [3200, 4200], g: 0.35, transpose: 12 });
      sustainedBass(ctx, 'saw', 0.5);
      for (let b = 0; b < bars; b++) taiko(b, 0.7);
      lead(
        ctx,
        'brass',
        phrase(ctx, mrng.fork('verse-phrase'), hook, 0, bars, {
          center: 0,
          lo: -4,
          hi: 6,
          transpose: -12,
          velocity: 0.85,
        }),
      );
      break;
    case 'chorus':
      organChords(ctx, 1);
      padChords(ctx, 'strings', { cut: () => [4000, 5200], g: 0.45, transpose: 12 });
      sustainedBass(ctx, 'saw', 0.55);
      for (let b = 0; b < bars; b++) {
        drums(ctx, b, { kick: 'x.........x.....', snare: '........x.......', hat: 'o.-.o.-.o.-.o.-.' }, {
          kick: 'big',
          snare: 'huge',
          sc: 0.4,
        });
      }
      lead(ctx, 'brass', phrase(ctx, mrng.fork('hook-phrase'), hook, 0, bars, { center: 2, lo: -2, hi: 9 }));
      break;
    case 'break':
      organChords(ctx, 0.5);
      padChords(ctx, 'strings', { cut: () => [1500, 2000], g: 0.4 });
      bells(ctx, phrase(ctx, mrng.fork('bell-phrase'), hook, 0, bars, { center: 5, lo: 0, hi: 12, stretch: 2 }), 0.7);
      break;
    case 'build': {
      organChords(ctx, 0.8, 1);
      padChords(ctx, 'strings', { cut: (_, i) => [2000 + 1000 * i, 3000 + 1000 * i], g: 0.45, transpose: 12 });
      sustainedBass(ctx, 'saw', 0.55);
      for (let b = 0; b < bars; b++) {
        taiko(b, 0.6 + (0.4 * b) / bars);
        if (b >= half) drums(ctx, b, { kick: 'x...x...x...x...' }, { kick: 'big', sc: 0.3 }, 0.85);
      }
      // the arp climbs a rung every beat, from the bass register to the top of the piano
      const total = bars * 16;
      for (let s = 0; s < total; s++) {
        const slot = ctx.chordAtStep(s);
        const lad = [...arpNotes(slot, 55), ...arpNotes(slot, 67).slice(1), ...arpNotes(slot, 79).slice(1)];
        const x = s / total;
        const rung = Math.min(lad.length - 1, Math.floor(x * (lad.length - 4)) + [0, 2, 1, 3][s % 4]);
        ctx.push({
          i: 'pluck',
          t: ctx.at(s),
          n: lad[rung],
          v: 0.6 + 0.35 * x,
          cut: 800 * 2 ** (2 * x),
          p: s % 2 ? 0.45 : -0.45,
        });
      }
      roll(ctx, 0, [[bars / 2, bars * 2], [bars / 4, bars * 2], [bars / 4, bars * 4]], 0.45, 0.9);
      ctx.push({ i: 'rise', t: 0, d: ctx.duration, k: 'build' });
      if (ctx.nextRole === 'drop') ctx.push({ i: 'breath', t: ctx.duration - ctx.s16, d: ctx.s16 });
      break;
    }
    case 'drop':
      ctx.push({ i: 'impact', t: 0, k: 'cosmic', a: 1, n: stab(first) }, { i: 'snare', t: 0, v: 0.75, k: 'huge' });
      organChords(ctx, 1, 1);
      padChords(ctx, 'strings', { cut: () => [3200, 5000], g: 0.45, transpose: 12 });
      sustainedBass(ctx, 'saw', 0.58);
      for (let b = 0; b < bars; b++) {
        drums(ctx, b, { kick: 'x.........x.....', snare: '........x.......', hat: 'o.-.o.-.o.-.o.-.' }, {
          kick: 'big',
          snare: 'huge',
          sc: 0.4,
        });
        if (b === last) tomFill(ctx, b, ctx.chordAt(b), 0.9);
        arp(ctx, b, 'hemi', { v: 0.55, cut: () => 2200, from: 62 });
      }
      lead(ctx, 'hook2', phrase(ctx, mrng.fork('hook-phrase'), hook, 0, bars, { center: 3, lo: -1, hi: 10 }));
      break;
    case 'outro':
    default: {
      organChords(ctx, 0.6, 0, 0, bars);
      const end = ctx.chords[ctx.chords.length - 1];
      ctx.push({
        i: 'pad',
        t: ctx.barAt(end.bar),
        d: end.bars * ctx.bar,
        n: end.voicing,
        k: 'bloom',
        cut: [4200, 700],
        g: 0.8,
      });
      sustainedBass(ctx, 'sub', 0.5, 0, bars, 2.5);
      bells(ctx, [{ t: ctx.barAt(last), d: 4, n: ctx.tonicMid + 12, v: 1 }, {
        t: ctx.barAt(last),
        d: 4,
        n: ctx.tonicMid + 19,
        v: 0.7,
      }], 0.6);
    }
  }
  if (ctx.nextRole === 'chorus' && ctx.role === 'verse') cymbalInto(ctx);
}

const ARRANGERS: Record<StyleId, (ctx: Ctx) => void> = { rise, pulse, haze, drift, cathedral };
