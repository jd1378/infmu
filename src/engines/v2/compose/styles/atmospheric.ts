// Drift (ambient), Cathedral (cinematic) and Ember (post-rock).

import type { BassKind } from '../../types.ts';
import type { ChordSlot, Ctx } from '../context.ts';
import { CATHEDRAL_TIMES, DRIFT_TIMES, EMBER_TIMES, grooveBar, grooveFor, inTime, playGroove } from '../grooves.ts';
import {
  choir,
  chorusMelody,
  halves,
  introPreview,
  leadIn,
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
  bassFigure,
  type BassHit,
  crash,
  droneVoicing,
  drums,
  EIGHTHS,
  organChords,
  padChords,
  pianoBar,
  pick,
  pickNotes,
  runRiser,
  runRoll,
  stab,
  sustainedBass,
  tomFill,
  tomRoll,
  tremolo,
} from '../parts.ts';
import { guitarist } from '../guitarist.ts';
import { phrase } from '../melody.ts';

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
      leadIn(ctx, { chance: 0.5, longest: 1.5, room: true });
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

// ------------------------------------------------------------------ ember: post-rock
//
// Written from the references (Explosions in the Sky, Mono, April Rain): a piece is one or two waves. A quiet theme
// on a clean guitar drenched in dotted-eighth delay, over chords swelled in with no attack and no drums at all; a
// long crescendo (the floor tom and the kick, the guitar's arpeggio thickening, the bass arriving, the fuzz wall
// halfway, a roll at the end); a climax held for a long time, the theme tremolo-picked and doubled an octave up over
// a double-tracked wall and crashes ridden like a ride; then a sudden drop to almost nothing, and the next wave.

export function ember(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { a: theme, b: themeB } = motifs(ctx);
  const glock = mrng.fork('glock').chance(0.5);
  const piano = mrng.fork('piano').chance(0.35);
  const g = grooveFor(ctx, inTime(ctx, EMBER_TIMES));
  // a drummer on an acoustic kit in a big room; post-rock records don't pump
  const heavy = {
    kit: { kick: 'acoustic', snare: 'acoustic', acoustic: true, sc: 0.05 },
    bass: 'saw',
    bassGain: 0,
    withBass: false,
  } as const;
  const x = (b: number) => ctx.runAt(b / bars);
  const swellRng = ctx.rng.fork('swells');
  // the lead guitarist's tuning rings in every guitar's chords; their tremolo picking is theirs
  const { hands, open } = guitarist(ctx);
  const drone = (slot: ChordSlot) => droneVoicing(ctx, slot, open);

  // chords swelled in on the clean guitar, one swell a chord, ringing on into the delay: the drone voicing's upper
  // notes, so the open strings on top never change
  const swells = (v: number, from = 0, to = bars) => {
    for (const slot of ctx.chords) {
      if (slot.bar < from || slot.bar >= to) continue;
      drone(slot).slice(1).forEach((n, k) =>
        ctx.push({
          i: 'string',
          t: ctx.barAt(slot.bar) + 0.04 * k,
          n,
          v: v * (1 - 0.08 * k),
          k: 'clean',
          d: Math.min(slot.bars, to - slot.bar) * ctx.bar,
          swell: swellRng.range(0.5, 1.1),
          p: [-0.35, 0.35, -0.15, 0.15, 0][k % 5],
        })
      );
    }
  };
  // two clean guitars that interlock through the dotted-eighth delay: the first picks eighths through the chord
  // (a few notes a bar when quiet), the second rings the drones on a dotted grid against it, three against four.
  // Each piece has its own figures, kept as a guitarist keeps a riff: the chords move them (figures that change
  // every bar, or climb and fall a note at a time, go round like a music box)
  const figures = mrng.fork('figures');
  const quietFigure = figures.pick([[0, -1, 3, -1], [0, -1, -1, 3, -1, -1, 2, -1], [0, -1, 2, -1, 3, -1, -1, -1]]);
  const denseFigure = figures.pick([[0, 2, 3, 4, 3, 2], [0, 3, 2, 4, 3, 2], [0, 2, 4, 3, 2, 3]]);
  const droneFigure = figures.pick([[2, 1, 0, 1], [2, 0, 1, 0]]);
  const shimmer = (b: number, v: number, dense = false) => {
    const ns = drone(ctx.chordAt(b));
    if (dense) pickNotes(ctx, b, 'clean', ns, denseFigure, 2, v, -0.4);
    else pickNotes(ctx, b, 'clean', ns, quietFigure, 4, v, -0.4);
  };
  const interlock = (b: number, v: number) => {
    const top = drone(ctx.chordAt(b)).slice(-3);
    pickNotes(ctx, b, 'clean', top, droneFigure, ctx.mv.meter === '4/4' ? 6 : 4, v, 0.45);
  };
  // the wall: power chords held through each chord, a guitarist each side
  const wall = (v: number, from = 0, to = bars) => {
    for (const slot of ctx.chords) {
      if (slot.bar + slot.bars <= from || slot.bar >= to) continue;
      const at = Math.max(from, slot.bar);
      const r = ctx.root(slot);
      const low = r < 40 ? r + 12 : r;
      for (const side of [-0.9, 0.9]) {
        [low, low + 7, low + 12].forEach((n, k) =>
          ctx.push({
            i: 'string',
            t: ctx.barAt(at) + 0.012 * k + (side > 0 ? 0.009 : 0),
            n,
            v,
            k: 'overdrive',
            d: (Math.min(slot.bar + slot.bars, to) - at) * ctx.bar,
            p: side,
          })
        );
      }
    }
  };
  // the bass guitar, re-picked as a bassist plays (a real string dies away; it isn't a pad): fingered on the strong
  // beats in the quiet, picked on the beats as a build starts, driving picked eighths into and through a climax
  const onStrongs: BassHit[] = ctx.strongs.map((s, i, all) => [s, (all[i + 1] ?? ctx.spb) - s, 0, i ? 0.85 : 1]);
  // on the root throughout, moving with the chords: a bass that bounces to the fifth and the octave is a polka, or a
  // carousel in three
  const onBeats: BassHit[] = [...Array(ctx.spb).keys()].filter((s) => ctx.onBeat(s))
    .map((s) => [s, ctx.mv.meter === '6/8' ? 6 : 4, 0, ctx.strong(s) ? 1 : 0.8]);
  const eighths: BassHit[] = EIGHTHS.filter(([s]) => s < ctx.spb);
  const bassline = (hits: readonly BassHit[], k: BassKind, v: (b: number) => number, from = 0, to = bars) => {
    for (let b = from; b < to; b++) bassFigure(ctx, b, hits, k, v(b));
  };
  // the theme, slow, on the delay guitar (a glockenspiel an octave up, sometimes)
  const line = () => phrase(ctx, theme, 0, bars, { center: 4, lo: 0, hi: 11, stretch: 2 }, 'period');
  const stateTheme = (gain: number) => {
    const ns = line();
    play(ctx, 'string:clean', ns, gain);
    if (glock) play(ctx, 'bell', ns.map((n) => ({ ...n, n: n.n + 12 })), gain * 0.35, false);
  };
  // the theme at a climax, as slow and wide as in the quiet: its notes of a bar or more tremolo-picked on the lead
  // guitar, the rest picked once and sung with vibrato (a whole theme tremolo-picked is one note hammered for bars);
  // an octave up on the clean guitar, tremolo there only at the final climax
  const soar = (v: number) => {
    const ns = line();
    const long = ns.filter((n) => n.d >= ctx.bar);
    const short = ns.filter((n) => n.d < ctx.bar);
    // picked softly: a tremolo is a shimmer inside the wall, not a row of hard attacks on top of it
    tremolo(ctx, long, 'clean', v * 0.65, { lead: true, fast: hands.fast });
    play(ctx, 'string:clean', short, v * 0.75);
    const up = ns.map((n) => ({ ...n, n: n.n + 12 }));
    if (ctx.finalTurn) tremolo(ctx, up, 'clean', v * 0.3, { p: 0.3 });
    else play(ctx, 'string:clean', up, v * 0.3, false);
  };

  switch (ctx.role) {
    case 'intro':
      padChords(ctx, 'warm', { cut: (slot) => runCut(ctx, slot, 500, 1200), g: 0.4 });
      swells(0.45);
      for (let b = Math.floor(bars / 2); b < bars; b++) shimmer(b, 0.3 + 0.2 * x(b));
      if (piano) play(ctx, 'piano', line().filter((n) => n.t >= ctx.barAt(Math.floor(bars / 2))), 0.5, false);
      break;
    case 'verse':
      padChords(ctx, 'warm', { cut: () => [700, 1000], g: 0.35 });
      swells(0.35);
      for (let b = 0; b < bars; b++) {
        shimmer(b, 0.4);
        // the second guitar joins once the theme has been heard
        if (ctx.returning || ctx.runBar(b) >= 8) interlock(b, 0.3);
      }
      if (ctx.returning || ctx.runBar(0) >= 8) bassline(onStrongs, 'finger', () => 0.45);
      stateTheme(0.9);
      break;
    case 'build': {
      // one crescendo across the whole run of build sections
      padChords(ctx, 'strings', { cut: (slot) => runCut(ctx, slot, 900, 4200), g: 0.45 });
      // the bass holds the chords until the drums drive, then plays eighths (below)
      const drive = Math.max(0, Math.min(bars, Math.ceil(ctx.runBars / 2 - ctx.runStartBar)));
      if (ctx.runAt(1) > 0.25 && drive > 0) bassline(onBeats, 'pick', (b) => 0.5 + 0.1 * x(b), 0, drive);
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, { ...heavy, gain: 0.35 + 0.65 * x(b) });
        if (x(b) < 0.5) {
          shimmer(b, 0.45 + 0.2 * x(b), x(b) >= 0.25);
          interlock(b, 0.35 + 0.2 * x(b));
        } else {
          // the bass drives eighths into the climax
          bassFigure(ctx, b, eighths, 'pick', 0.55 + 0.3 * x(b));
        }
      }
      // past halfway the guitar tremolos the chord tones and the wall comes in
      const half = Math.max(0, Math.min(bars, Math.ceil(ctx.runBars / 2 - ctx.runStartBar)));
      if (half < bars) {
        // one chord tone a chord, higher in the chord as the run goes on, so the line climbs with the crescendo
        const climb = ctx.chords.filter((c) => c.bar + c.bars > half).map((c) => {
          const at = Math.max(half, c.bar);
          const ns = drone(c).slice(1);
          const n = ns[Math.min(ns.length - 1, Math.floor(Math.max(0, 2 * x(at) - 1) * ns.length))];
          return { t: ctx.barAt(at), d: (c.bar + c.bars - at) * ctx.bar, n, v: 0.8 };
        });
        tremolo(ctx, climb, 'clean', 0.5);
        wall(0.55, half, bars);
      }
      if (ctx.runAt(1) >= 0.75) runRoll(ctx, 0.3, 0.9, 'acoustic');
      // the drummer takes the last two bars round the toms
      if (ctx.nextRole === 'drop' || ctx.nextRole === 'chorus') tomRoll(ctx, Math.min(2, bars), 0.45, 1, 'acoustic');
      if (ctx.nextRole !== 'build') {
        ctx.push({ i: 'rise', t: ctx.duration - 2 * ctx.bar, d: 2 * ctx.bar, k: 'cymbal' });
        // the band stops, the room rings, the wall comes in: only sometimes, and only before the last climax
        leadIn(ctx, { chance: 0.5, longest: 1, room: true });
      }
      break;
    }
    case 'chorus':
    case 'drop': {
      const final = ctx.finalTurn;
      if (ctx.prevRole !== ctx.role) crash(ctx, 0, 1, true);
      padChords(ctx, 'strings', { cut: () => [1600, 2400], g: 0.5 });
      if (final) choir(ctx, 'a', 0.45);
      bassline(eighths, 'pick', () => 0.85);
      wall(final ? 1 : 0.85);
      for (let b = 0; b < bars; b++) playGroove(ctx, g, b, heavy);
      soar(final ? 0.9 : 0.8);
      if (ctx.nextRole !== ctx.role && ctx.nextRole !== 'outro') {
        tomFill(ctx, bars - 1, ctx.chordAt(bars - 1), 0.8, 'acoustic');
      }
      break;
    }
    case 'break':
    case 'bridge':
      // the drop to almost nothing: a swell, a few echoes, the room
      swells(0.3);
      for (let b = 0; b < bars; b += 2) shimmer(b, 0.25);
      if (piano) {
        play(ctx, 'piano', phrase(ctx, themeB, 0, bars, { center: 3, lo: -1, hi: 10, stretch: 2 }), 0.5, false);
      } else sing(ctx, 'string:clean', themeB, { center: 3, lo: -1, hi: 10, stretch: 2, velocity: 0.7 });
      break;
    case 'rest':
      break;
    case 'outro':
    default:
      padChords(ctx, 'warm', { cut: (slot) => runCut(ctx, slot, 1400, 500), g: 0.4, rel: 3 });
      swells(0.4 * (1 - ctx.runAt(0)));
      bassline(onStrongs, 'finger', (b) => 0.45 * (1 - x(b)), 0, runHalf(ctx));
      for (let b = 0; b < bars; b++) if (ctx.runBar(b) < ctx.runBars - 1) shimmer(b, 0.35 * (1 - x(b)));
      if (glock) {
        play(
          ctx,
          'bell',
          line().filter((n) => n.t < ctx.barAt(4)).map((n) => ({ ...n, n: n.n + 12 })),
          0.3,
          false,
        );
      }
      if (ctx.inRun === 0 && ctx.prevRole !== 'outro') crash(ctx, 0, 0.6, true);
  }
  ringOut(ctx);
}
