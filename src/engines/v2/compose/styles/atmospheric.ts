// Drift (ambient), Cathedral (cinematic) and Ember (post-rock).

import type { Ctx } from '../context.ts';
import { CATHEDRAL_TIMES, DRIFT_TIMES, EMBER_TIMES, grooveBar, grooveFor, inTime, playGroove } from '../grooves.ts';
import {
  choir,
  chorusMelody,
  halves,
  introPreview,
  motifs,
  play,
  ringOut,
  runCut,
  runHalf,
  sing,
  solo,
  stopBefore,
  versePlan,
  type Voice,
  voiceFrom,
} from '../helpers.ts';
import {
  arp,
  arpNotes,
  crash,
  drums,
  organChords,
  padChords,
  pianoBar,
  pick,
  runRiser,
  runRoll,
  stab,
  sustainedBass,
  tomFill,
} from '../parts.ts';

// ------------------------------------------------------------------ drift: ambient

export function drift(ctx: Ctx): void {
  const { bars, mrng, rng } = ctx;
  const { half } = halves(ctx);
  const { a: motif, b: motifB, c: own } = motifs(ctx);
  const verse = versePlan(ctx, 'none');
  const g = grooveFor(ctx, inTime(ctx, DRIFT_TIMES));
  const avoid = [3, 6];
  const leads: Voice[] = [
    'bell',
    'wind:hum',
    'mallet:vibes',
    'piano',
    'mallet:kalimba',
    'string:harp',
    'wind:flute',
    'string:guitar',
  ];
  const lead = voiceFrom(ctx, leads);
  const second = voiceFrom(ctx, ['mallet:kalimba', 'mallet:vibes', 'string:harp'], lead);
  const harp = mrng.fork('harp').chance(0.5);
  const aura = mrng.fork('aura').pick(['glass', 'choir'] as const);
  const shimmer = (from: number, to: number, v: number) => {
    for (let b = from; b < to; b++) {
      if (harp) pick(ctx, b, 'harp', [0, 2, 4, 5, 3, 2], 2, v, 52);
      else arp(ctx, b, 'broken', { v, cut: () => 2400, from: 64, rate: 2, dec: 0.35 });
    }
  };

  switch (ctx.role) {
    case 'intro':
      ctx.push({ i: 'drone', t: 0, d: ctx.duration + 2, n: ctx.tonicLow + 12 });
      padChords(ctx, 'warm', { cut: (_, i) => [1100 + 400 * i, 1600 + 400 * i], g: 0.75 });
      shimmer(half, bars, 0.3);
      introPreview(ctx, second, motif, { center: 4, lo: 0, hi: 11, stretch: 2, avoid });
      break;
    case 'verse':
      padChords(ctx, 'warm', { cut: () => [1600, 2800], g: 0.8 });
      sustainedBass(ctx, 'sub', 0.3);
      shimmer(0, bars, 0.4);
      if (verse === 'own') sing(ctx, second, own, { center: 3, lo: -1, hi: 9, stretch: 2, avoid, velocity: 0.8 });
      for (let b = 1; b < bars && verse !== 'own'; b += 2) {
        const n = rng.pick(ctx.chordAt(b).voicing) + 12;
        play(
          ctx,
          ctx.returning ? 'piano' : 'bell',
          [{ t: ctx.barAt(b, rng.pick([0, 4, 6, 8])), d: 2, n, v: 1 }],
          0.65,
          false,
        );
      }
      break;
    case 'chorus':
      padChords(ctx, 'warm', { cut: () => [2000, 3200], g: 0.75 });
      if (aura === 'glass') padChords(ctx, 'glass', { cut: () => [4500, 7000], g: 0.3, transpose: 12 });
      else choir(ctx, ctx.returning ? 'a' : 'u', 0.55);
      sustainedBass(ctx, 'sub', 0.32);
      shimmer(0, bars, 0.35);
      chorusMelody(ctx, lead, second, motif, { center: 4, lo: 0, hi: 11, stretch: 2, avoid });
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, { kit: {}, bass: 'sub', bassGain: 0, gain: 0.5, withBass: false });
      }
      break;
    case 'solo':
      padChords(ctx, 'warm', { cut: () => [1800, 2600], g: 0.7 });
      sustainedBass(ctx, 'sub', 0.3);
      solo(ctx, second, motif, {
        center: 4,
        lo: 0,
        hi: 12,
        avoid,
      });
      break;
    case 'bridge':
      padChords(ctx, 'strings', { cut: () => [2200, 3400], g: 0.55 });
      choir(ctx, 'm', 0.6);
      for (let b = 0; b < bars; b += 2) pianoBar(ctx, b, 'block', 0.4);
      sing(ctx, second, motifB, { center: 2, lo: -2, hi: 9, stretch: 2, avoid });
      break;
    case 'break':
      padChords(ctx, 'strings', { cut: () => [2500, 4000], g: 0.6 });
      sing(ctx, lead, motif, { center: 2, lo: -2, hi: 9, stretch: 2, avoid });
      if (mrng.fork('break-rest').chance(0.5)) stopBefore(ctx, 2);
      break;
    case 'rest':
      break;
    case 'outro':
    default:
      padChords(ctx, 'warm', { cut: (_, i) => [2400 - 250 * i, 1400 - 150 * i], g: 0.75, rel: 3 });
      sustainedBass(ctx, 'sub', 0.28, 0, bars, 3);
      shimmer(0, Math.max(1, bars - 2), 0.3);
  }
  ringOut(ctx);
}

// ------------------------------------------------------------------ cathedral: cinematic

export function cathedral(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const { a: hook, b: hookB, c: own } = motifs(ctx);
  const verse = versePlan(ctx, 'hook');
  const first = ctx.chords[0];
  const guitars = mrng.fork('guitars').chance(0.35);
  const g = grooveFor(ctx, inTime(ctx, CATHEDRAL_TIMES));
  const epic = { kit: { kick: 'big', snare: 'huge', sc: 0.4 }, bass: 'saw', bassGain: 0, withBass: false } as const;
  // the taiko of the movement's groove alone (a build swells them)
  const taiko = (b: number, v: number) =>
    grooveBar(ctx, b, { lo: g.light.lo, mid: g.light.mid, hi: g.light.hi }, {}, v);
  // palm-muted power chords through the amp: root, fifth, octave
  const power = (b: number, v: number) => {
    const r = ctx.root(ctx.chordAt(b));
    const root = r < 40 ? r + 12 : r;
    for (let s = 0; s < ctx.spb; s += 2) {
      for (const n of [root, root + 7, root + 12]) {
        ctx.push({
          i: 'string',
          t: ctx.barAt(b, s),
          n,
          v: v * (ctx.onBeat(s) ? 1 : 0.8),
          k: 'overdrive',
          d: ctx.s16 * 1.6,
        });
      }
    }
  };

  switch (ctx.role) {
    case 'intro':
      ctx.push({ i: 'drone', t: 0, d: ctx.duration + 2, n: ctx.tonicLow + 12 });
      organChords(ctx, 0.6);
      break;
    case 'verse':
      organChords(ctx, 0.85);
      padChords(ctx, 'strings', { cut: () => [3200, 4200], g: 0.35, transpose: 12 });
      sustainedBass(ctx, 'saw', 0.5);
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, { ...epic, gain: 0.7 });
        pick(ctx, b, 'harp', [0, 2, 3, 4, 5, 4, 3, 2], 2, 0.4, 48);
      }
      sing(ctx, 'brass', verse === 'own' ? own : hook, {
        center: 0,
        lo: -4,
        hi: 6,
        transpose: -12,
        velocity: 0.85,
      });
      break;
    case 'chorus':
      organChords(ctx, 1);
      padChords(ctx, 'strings', { cut: () => [4000, 5200], g: 0.45, transpose: 12 });
      choir(ctx, 'a', 0.45);
      sustainedBass(ctx, 'saw', 0.55);
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, epic);
      }
      chorusMelody(ctx, 'brass', voiceFrom(ctx, ['bell', 'piano', 'string:harp']), hook, { center: 2, lo: -2, hi: 9 });
      break;
    case 'bridge':
      padChords(ctx, 'strings', { cut: () => [2400, 3200], g: 0.5 });
      choir(ctx, 'm', 0.6);
      for (let b = 0; b < bars; b++) pianoBar(ctx, b, 'broken', 0.45);
      sing(ctx, 'piano', hookB, { center: 4, lo: 0, hi: 11 });
      break;
    case 'break':
      organChords(ctx, 0.5);
      padChords(ctx, 'strings', { cut: () => [1500, 2000], g: 0.4 });
      sing(ctx, 'bell', hook, { center: 5, lo: 0, hi: 12, stretch: 2 });
      break;
    case 'build': {
      organChords(ctx, 0.8, 1);
      padChords(ctx, 'strings', { cut: (_, i) => [2000 + 1000 * i, 3000 + 1000 * i], g: 0.45, transpose: 12 });
      choir(ctx, 'o', 0.5, 0, half, bars);
      sustainedBass(ctx, 'saw', 0.55);
      for (let b = 0; b < bars; b++) {
        taiko(b, 0.6 + (0.4 * b) / bars);
        if (b >= half) drums(ctx, b, { kick: 'x...x...x...x...' }, { kick: 'big', sc: 0.3 }, 0.85);
      }
      // the arp climbs a rung every beat, from the bass register to the top of the piano
      const total = bars * ctx.spb;
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
      runRoll(ctx, 0.45, 0.9);
      runRiser(ctx, 'build', false);
      if (ctx.nextRole === 'drop') {
        if (mrng.fork('drop-gap').chance(0.5)) stopBefore(ctx, 2);
        else ctx.push({ i: 'breath', t: ctx.duration - ctx.s16, d: ctx.s16 });
      }
      break;
    }
    case 'drop':
      if (ctx.prevRole !== 'drop') {
        ctx.push({ i: 'impact', t: 0, k: 'cosmic', a: 1, n: stab(first) }, { i: 'snare', t: 0, v: 0.75, k: 'huge' });
        crash(ctx);
      }
      organChords(ctx, 1, 1);
      padChords(ctx, 'strings', { cut: () => [3200, 5000], g: 0.45, transpose: 12 });
      choir(ctx, 'a', 0.6);
      sustainedBass(ctx, 'saw', 0.58);
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, epic);
        if (b === last) tomFill(ctx, b, ctx.chordAt(b), 0.9);
        if (guitars) power(b, 0.8);
        else arp(ctx, b, 'hemi', { v: 0.55, cut: () => 2200, from: 62 });
      }
      chorusMelody(ctx, 'brass', voiceFrom(ctx, ['bell', 'piano', 'string:harp']), hook, { center: 2, lo: -2, hi: 9 });
      break;
    case 'rest':
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
      choir(ctx, 'm', 0.4, 0, 0, half);
      sustainedBass(ctx, 'sub', 0.5, 0, bars, 2.5);
      play(
        ctx,
        'bell',
        [{ t: ctx.barAt(last), d: 4, n: ctx.tonicMid + 12, v: 1 }, {
          t: ctx.barAt(last),
          d: 4,
          n: ctx.tonicMid + 19,
          v: 0.7,
        }],
        0.85,
        false,
      );
    }
  }
  ringOut(ctx);
}

// ------------------------------------------------------------------ ember: post-rock

const EMBER_LEADS: Voice[] = [
  'string:electric',
  'mallet:vibes',
  'bell',
  'mallet:kalimba',
  'piano',
  'string:guitar',
  'wind:hum',
];

export function ember(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { last } = halves(ctx);
  const { a: hook, b: hookB, c: own } = motifs(ctx);
  const verse = versePlan(ctx, 'hook');
  const lead = voiceFrom(ctx, EMBER_LEADS);
  const second = voiceFrom(ctx, ['mallet:vibes', 'bell', 'mallet:kalimba'], lead);
  const tremolo = mrng.fork('tremolo').chance(0.5);
  const rim = { kick: 'big', snare: 'rim', sc: 0.25 } as const;
  const g = grooveFor(ctx, inTime(ctx, EMBER_TIMES));
  const full = { kick: 'big', snare: 'big', sc: 0.35 } as const;
  // the clean guitar that carries the piece: a delayed arpeggio, or tremolo-picked chord tones
  // the clean guitar that carries the piece, at the density the form asks for: space (quarters) in intros,
  // bridges and breaks, the arpeggio in verses, the full figure (tremolo, or the arpeggio in 16ths) in climaxes.
  // The move from picking to tremolo is post-rock's crescendo.
  const clean = (b: number, v: number, density: 0 | 1 | 2 = 1) => {
    if (density === 0) return pick(ctx, b, 'electric', [0, -1, 3, -1, 4, -1, 5, -1], 2, v, 52);
    if (density === 1) return pick(ctx, b, 'electric', [0, 3, 4, 5, 3, 4], 2, v, 52);
    // the climax: the arpeggio in 16ths across the chord (re-plucking one note on every 16th sounds like a
    // machine, not like tremolo picking)
    pick(ctx, b, 'electric', tremolo ? [3, 4, 5, 4, 3, 4, 5, 4] : [0, 3, 4, 5, 3, 4, 5, 3], 1, v * 0.8, 52);
  };
  // the wall of guitars: power chords strummed on beats 1 and 3 and left to ring, a wash under the melody
  // rather than a chug (under heavy drive a third or a tenth intermodulates into mud)
  const wall = (b: number, v: number) => {
    const r = ctx.root(ctx.chordAt(b));
    const low = r < 40 ? r + 12 : r;
    const ns = [low, low + 7, low + 12];
    for (const s of ctx.strongs) {
      for (const [k, n] of ns.entries()) {
        ctx.push({
          i: 'string',
          t: ctx.barAt(b, s) + 0.012 * k,
          n,
          v: v * (s ? 0.8 : 1),
          k: 'overdrive',
          d: ctx.s16 * (ctx.spb / ctx.strongs.length),
        });
      }
    }
  };

  switch (ctx.role) {
    case 'intro':
      padChords(ctx, 'warm', { cut: (slot) => runCut(ctx, slot, 800, 2600), g: 0.55 });
      for (let b = 0; b < bars; b++) clean(b, 0.35 + 0.25 * ctx.runAt(b / bars), ctx.runAt(b / bars) < 0.5 ? 0 : 1);
      introPreview(ctx, second, hook, { center: 4, lo: 0, hi: 12 });
      break;
    case 'verse':
      padChords(ctx, 'warm', { cut: () => [1200, 1600], g: 0.45 });
      for (let b = 0; b < bars; b++) {
        clean(b, 0.55);
        playGroove(ctx, g, b, { kit: rim, bass: 'round', bassGain: 0.7, gain: 0.85 });
      }
      if (verse === 'own') sing(ctx, lead, own, { center: 4, lo: 0, hi: 11 });
      else if (ctx.returning) sing(ctx, lead, hook, { center: 5, lo: 1, hi: 12, stretch: 2 });
      break;
    case 'build':
      // a build of several sections swells once: the wall of guitars arrives halfway through the whole build
      padChords(ctx, 'strings', { cut: (slot) => runCut(ctx, slot, 1500, 5200), g: 0.5 });
      sustainedBass(ctx, 'saw', 0.5);
      for (let b = 0; b < bars; b++) {
        clean(b, 0.6, ctx.runAt(b / bars) < 0.5 ? 1 : 2);
        const x = ctx.runAt(b / bars);
        drums(
          ctx,
          b,
          { kick: x < 0.5 ? 'x.......x.......' : 'x...x...x...x...', hat: 'x.x.x.x.x.x.x.x.' },
          full,
          0.6 + 0.4 * x,
        );
        if (x >= 0.5) wall(b, 0.4 + 0.5 * x);
      }
      runRoll(ctx, 0.3, 0.9, 'big');
      if (ctx.nextRole !== 'build') ctx.push({ i: 'rise', t: ctx.duration - 2 * ctx.bar, d: 2 * ctx.bar, k: 'cymbal' });
      // the moment before the wall of sound: everything stops, even the room
      if (ctx.nextRole === 'drop' || ctx.nextRole === 'chorus') {
        stopBefore(ctx, 3, false);
      }
      break;
    case 'chorus':
    case 'drop': {
      const big = ctx.role === 'drop';
      if (ctx.prevRole !== ctx.role) crash(ctx, 0, 1);
      padChords(ctx, 'strings', { cut: () => [2600, 3800], g: 0.5, transpose: 12 });
      if (big) choir(ctx, 'a', 0.55);
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, { kit: full, bass: 'saw', bassGain: 0.55 });
        if (big && b % 4 === 0 && b) crash(ctx, b, 0.6);
        wall(b, big ? 1 : 0.8);
        clean(b, 0.5, 2);
        if (b === last && ctx.nextRole !== ctx.role) tomFill(ctx, b, ctx.chordAt(b));
      }
      chorusMelody(ctx, lead, second, hook, { center: 4, lo: 0, hi: 12 });
      break;
    }
    case 'bridge':
      padChords(ctx, 'warm', { cut: () => [1400, 1800], g: 0.5 });
      sustainedBass(ctx, 'round', 0.6);
      for (let b = 0; b < bars; b++) {
        clean(b, 0.5, 0);
        drums(ctx, b, { kick: 'x...............', snare: '........x.......' }, rim, 0.8);
      }
      sing(ctx, second, hookB, { center: 4, lo: 0, hi: 11 });
      break;
    case 'break':
      padChords(ctx, 'warm', { cut: () => [900, 1300], g: 0.5 });
      for (let b = 0; b < bars; b++) clean(b, 0.4, 0);
      if (ctx.turn === 0) sing(ctx, second, hook, { center: 5, lo: 1, hi: 12, stretch: 2, velocity: 0.8 });
      break;
    case 'rest':
      break;
    case 'outro':
    default:
      padChords(ctx, 'strings', { cut: (slot) => runCut(ctx, slot, 2000, 900), g: 0.45, rel: 3 });
      sustainedBass(ctx, 'round', 0.5, 0, runHalf(ctx), 2);
      for (let b = 0; b < bars; b++) {
        if (ctx.runBar(b) < ctx.runBars - 1) {
          clean(b, 0.5 * (1 - ctx.runAt(b / bars)), ctx.runAt(b / bars) < 0.5 ? 1 : 0);
        }
      }
      if (ctx.inRun === 0 && ctx.prevRole !== 'outro') crash(ctx, 0, 0.7);
  }
  ringOut(ctx);
}
