// Rise (trance), Pulse (synthwave) and Acid (acid house).

import type { Ctx } from '../context.ts';
import { ACID, grooveFor, playGroove, PULSE, RISE } from '../grooves.ts';
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
  span,
  stopBefore,
  versePlan,
  type Voice,
  voiceFrom,
} from '../helpers.ts';
import {
  acidLine,
  acidPattern,
  arp,
  type ArpShape,
  bassFigure,
  crash,
  cymbalInto,
  drums,
  EIGHTHS,
  padChords,
  pick,
  roll,
  runRiser,
  runRoll,
  stab,
  sustainedBass,
  tomFill,
} from '../parts.ts';

// ------------------------------------------------------------------ rise: trance

export function rise(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const { a: hook, b: hookB, c: own } = motifs(ctx);
  const verse = versePlan(ctx, 'hook');
  const shape = mrng.fork('arp').pick<ArpShape>(['hemi', 'hemi', 'updown', 'broken']);
  const g = grooveFor(ctx, RISE);
  const verseKit = { kit: { kick: 'big', snare: 'clap', sc: 0.45 }, bass: 'saw', bassGain: 0.45 } as const;
  const dropKit = { kit: { kick: 'drop', snare: 'clap', sc: 0.72 }, bass: 'saw', bassGain: 1 } as const;
  const acidOn = mrng.fork('acid-on').chance(0.3);
  const pattern = acidPattern(mrng.fork('acid'));
  const first = ctx.chords[0];
  // the drops belong to the supersaw hook; one soft voice sings the breakdowns and the bridge
  const second = voiceFrom(ctx, ['bell', 'mallet:vibes', 'piano', 'wind:hum', 'mallet:kalimba']);

  switch (ctx.role) {
    case 'intro':
      // one arc across the whole run of intro sections: the filter keeps opening, parts keep arriving
      padChords(ctx, 'warm', { cut: (slot) => runCut(ctx, slot, 1100, 3200), g: 0.85 });
      sustainedBass(ctx, 'sub', 0.38);
      for (let b = 0; b < bars; b++) {
        const rb = ctx.runBar(b);
        drums(
          ctx,
          b,
          {
            kick: rb >= ctx.runBars / 2 && ctx.runBars > 8 ? 'x...x...x...x...' : 'x.........x.....',
            shaker: rb >= 2 ? '-o-o-o-o-o-o-o-o' : undefined,
            snare: rb >= ctx.runBars / 2 ? '........o.......' : undefined,
          },
          { kick: 'soft', snare: 'clap', sc: 0.22 },
          0.8,
        );
        if (rb >= 2) arp(ctx, b, shape, { v: 0.85, cut: (x) => 500 * 2 ** (2.5 * ctx.runAt(x)) });
      }
      break;
    case 'verse':
      padChords(ctx, 'wide', { cut: () => [2600, 4200], g: 0.62 });
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, verseKit);
        arp(ctx, b, shape, { v: 0.62, cut: () => 2400 });
      }
      if (ctx.returning) {
        sing(ctx, 'brass', verse === 'own' ? own : hook, { center: 1, lo: -3, hi: 6, transpose: -12, velocity: 0.8 }, {
          from: half,
          bars: half,
        });
      }
      break;
    case 'build':
      // a build of several sections is one build: one roll, one riser, one sweep, one arc
      padChords(ctx, 'wide', { cut: (slot) => runCut(ctx, slot, 2000, 5200), g: 0.6 });
      for (let b = 0; b < bars; b++) {
        const lastBar = ctx.runBar(b) === ctx.runBars - 1;
        drums(ctx, b, { kick: lastBar ? 'x.x.x.x.x.x.x.x.' : 'x...x...x...x...' }, { kick: 'big', sc: 0.45 });
        bassFigure(ctx, b, lastBar ? EIGHTHS : g.bassLight, 'saw', 0.38 + 0.1 * ctx.runAt(b / bars));
        arp(ctx, b, shape, { v: 0.7, cut: (x) => 700 * 2 ** (2.8 * ctx.runAt(x)) });
      }
      runRoll(ctx, 0.35, 0.85);
      runRiser(ctx, 'build', true);
      // the silence before the drop: a sixteenth of breath, or a whole beat with the room cut dead
      if (ctx.nextRole === 'drop') {
        if (mrng.fork('drop-gap').chance(0.5)) stopBefore(ctx, 1, false);
        else ctx.push({ i: 'breath', t: ctx.duration - ctx.s16, d: ctx.s16 });
      }
      break;
    case 'drop': {
      if (ctx.inRun === 0) {
        ctx.push({ i: 'impact', t: 0, k: 'drop', a: 1, n: stab(first) }, { i: 'snare', t: 0, v: 0.75, k: 'huge' });
        crash(ctx);
      }
      padChords(ctx, 'drop', { cut: () => [8000, 8000] });
      const fill = ctx.nextRole !== 'drop';
      for (let b = 0; b < bars; b++) {
        if (fill && b === last) {
          // the last beat drops out before the next part, the roll alone carries into it
          drums(ctx, b, { ...g.full, kick: 'x...x...x.......', snare: '....x...........' }, dropKit.kit);
          bassFigure(ctx, b, g.bassFull.filter(([s]) => s < 12), g.bassKind ?? 'saw', 1);
        } else playGroove(ctx, g, b, dropKit);
      }
      if (fill) roll(ctx, bars - 0.25, [[0.125, 2], [0.125, 4]], 0.5, 0.85);
      chorusMelody(ctx, 'hook', second, hook, { center: 3, lo: -1, hi: 10 });
      if (acidOn && ctx.peak) acidLine(ctx, pattern, 0, bars, [700, 1800], 0.75, 0.8, false);
      break;
    }
    case 'break':
      padChords(ctx, 'wide', { cut: () => [1800, 2600], g: 0.6 });
      choir(ctx, 'a', 0.5);
      sustainedBass(ctx, 'sub', 0.35);
      sing(ctx, second, hook, { center: 5, lo: 0, hi: 12, stretch: 2 });
      for (let b = runHalf(ctx); b < bars; b++) {
        arp(ctx, b, shape, { v: 0.45, cut: (x) => 600 * 2 ** (1.5 * ctx.runAt(x)) });
      }
      if (acidOn && runHalf(ctx) < bars) {
        const from = runHalf(ctx);
        acidLine(ctx, pattern, from, bars - from, span(ctx, 250, 900, from / bars), 0.85, 0.6, true);
      }
      break;
    case 'bridge':
      padChords(ctx, 'glass', { cut: () => [3000, 4500], g: 0.35, transpose: 12 });
      padChords(ctx, 'warm', { cut: () => [1600, 2200], g: 0.7 });
      sustainedBass(ctx, 'sub', 0.33);
      for (let b = 0; b < bars; b++) arp(ctx, b, 'broken', { v: 0.5, cut: () => 1800, rate: 2 });
      sing(ctx, second, hookB, { center: 4, lo: 0, hi: 11 });
      break;
    case 'rest':
      break;
    case 'outro':
    default:
      // the outro winds down once, across all of its sections
      padChords(ctx, 'warm', { cut: (slot) => runCut(ctx, slot, 3000, 1400), g: 0.8, rel: 2 });
      for (let b = 0; b < runHalf(ctx); b++) {
        playGroove(ctx, g, b, { ...verseKit, bassGain: 0.4 });
      }
      sustainedBass(ctx, 'sub', 0.35, runHalf(ctx), bars, 2);
      for (let b = 0; b < bars; b++) {
        if (ctx.runBar(b) < ctx.runBars - 2) {
          arp(ctx, b, shape, {
            v: 0.7 * (1 - ctx.runAt(b / bars)),
            cut: () => 1400,
          });
        }
      }
      if (ctx.mv.transition !== 'swell' && ctx.nextRole !== 'outro') {
        play(ctx, 'bell', [{ t: ctx.barAt(last), d: 1, n: ctx.tonicMid + 12, v: 1 }], 0.9, false);
      }
  }
  if ((ctx.nextRole === 'drop' || ctx.nextRole === 'chorus') && ctx.role !== 'build') cymbalInto(ctx);
  ringOut(ctx);
}

// ------------------------------------------------------------------ pulse: synthwave

const PULSE_LEADS: Voice[] = ['saw', 'wind:sax', 'string:electric', 'hook', 'bell'];

export function pulse(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const { a: hook, b: hookB } = motifs(ctx);
  const counter = motifs(ctx).b;
  const shape = mrng.fork('arp').pick<ArpShape>(['up', 'updown', 'broken']);
  const kit = { kick: 'punch', snare: 'gated', sc: 0.35, hats: 0.65 } as const;
  const g = grooveFor(ctx, PULSE);
  const band = { kit, bass: 'pulse', bassGain: 0.5 } as const;
  const lead = voiceFrom(ctx, PULSE_LEADS);
  const second = voiceFrom(ctx, ['wind:sax', 'saw', 'string:overdrive', 'string:electric', 'bell'], lead);
  const guitar = mrng.fork('guitar').chance(0.5);
  const arps = (from: number, to: number, v: (b: number) => number, cut: (x: number) => number) => {
    for (let b = from; b < to; b++) arp(ctx, b, shape, { v: v(b), cut, from: 57, dec: 0.75 });
  };
  // the chorus groove; a last bar before a new part hands over to a tom fill
  const chorusBar = (b: number, f: boolean, bassGain: number) => {
    if (!f) return playGroove(ctx, g, b, { ...band, bassGain });
    drums(ctx, b, { ...g.full, snare: '....x...........' }, { ...kit, ...g.kit });
    tomFill(ctx, b, ctx.chordAt(b));
    bassFigure(ctx, b, g.bassFull.filter(([s]) => s < 12), g.bassKind ?? 'pulse', bassGain);
  };

  switch (ctx.role) {
    case 'intro':
      padChords(ctx, 'warm', { cut: (_, i) => [900 + 250 * i, 1200 + 300 * i], g: 0.8 });
      sustainedBass(ctx, 'sub', 0.36);
      arps(0, bars, () => 0.7, (x) => 600 * 2 ** (1.8 * x));
      for (let b = half; b < bars; b++) drums(ctx, b, { hat: g.light.hat ?? 'x.o.x.o.x.o.x.o.' }, kit, 0.6);
      introPreview(ctx, second, hook, { center: 2, lo: -2, hi: 9 });
      break;
    case 'verse':
      padChords(ctx, 'wide', { cut: () => [1800, 2400], g: 0.45 });
      arps(0, bars, () => 0.6, () => 1600);
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, band);
        if (guitar && ctx.returning) pick(ctx, b, 'electric', [3, 4, 5, 4], 2, 0.5, 52);
      }
      if (bars >= 8) {
        sing(ctx, 'brass', counter, { center: 1, lo: -3, hi: 6, transpose: -12, velocity: 0.8 }, {
          from: half,
          bars: half,
        });
      }
      break;
    case 'prechorus':
      padChords(ctx, 'wide', { cut: (_, i) => [1600 + 900 * i, 2400 + 1200 * i], g: 0.5 });
      arps(0, bars, (b) => 0.5 + 0.1 * b, (x) => 1200 * 2 ** x);
      for (let b = 0; b < bars; b++) {
        if (b < last) playGroove(ctx, g, b, band);
        else {
          drums(ctx, b, { kick: 'x...............', hat: g.light.hat }, kit);
          bassFigure(ctx, b, g.bassFull, 'pulse', 0.5);
        }
      }
      roll(ctx, last, [[1, 8]], 0.4, 0.8, 'gated');
      if (mrng.fork('pre-stop').chance(0.6)) stopBefore(ctx, 1);
      break;
    case 'chorus':
      if (ctx.prevRole !== 'chorus') crash(ctx);
      padChords(ctx, 'wide', { cut: () => [2800, 4200], g: 0.55 });
      arps(0, bars, () => 0.5, () => 2400);
      for (let b = 0; b < bars; b++) {
        chorusBar(b, b === last && bars >= 8, 0.55);
        if (guitar) pick(ctx, b, 'electric', [2, 3, 4, 5, 4, 3], 2, 0.45, 52);
      }
      chorusMelody(ctx, lead, second, hook, { center: 2, lo: -2, hi: 9 });
      break;
    case 'solo':
      padChords(ctx, 'wide', { cut: () => [2400, 3600], g: 0.5 });
      arps(0, bars, () => 0.4, () => 2000);
      for (let b = 0; b < bars; b++) {
        chorusBar(b, b === last, 0.5);
      }
      solo(ctx, second, hook, { center: second === 'string:overdrive' ? -2 : 1, lo: -5, hi: 9 });
      break;
    case 'bridge':
      padChords(ctx, 'glass', { cut: () => [3000, 4000], g: 0.3, transpose: 12 });
      choir(ctx, 'a', 0.6);
      sustainedBass(ctx, 'sub', 0.34);
      for (let b = 0; b < bars; b++) drums(ctx, b, { kick: 'x...............', snare: '........x.......' }, kit, 0.8);
      sing(ctx, lead, hookB, { center: 3, lo: 0, hi: 10 });
      break;
    case 'break':
      padChords(ctx, 'warm', { cut: () => [1400, 1800], g: 0.6 });
      padChords(ctx, 'glass', { cut: () => [3000, 4000], g: 0.3, transpose: 12 });
      sustainedBass(ctx, 'sub', 0.34);
      sing(ctx, lead, hook, {
        center: 4,
        lo: 0,
        hi: 11,
        stretch: 2,
      });
      arps(half, bars, () => 0.4, (x) => 700 * 2 ** x);
      break;
    case 'rest':
      break;
    case 'outro':
    default:
      padChords(ctx, 'warm', { cut: (_, i) => [2200 - 200 * i, 1600 - 150 * i], g: 0.8, rel: 2 });
      arps(0, bars - 1, (b) => 0.6 * (1 - b / bars), () => 1400);
      for (let b = 0; b < half; b++) {
        playGroove(ctx, g, b, { ...band, gain: 0.85, bassGain: 0.45 });
      }
      sustainedBass(ctx, 'sub', 0.34, half, bars, 2);
  }
  if (ctx.nextRole === 'chorus' && ctx.role !== 'prechorus') cymbalInto(ctx);
  ringOut(ctx);
}

// ------------------------------------------------------------------ acid: acid house

export function acid(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half } = halves(ctx);
  // the groove fixes the 303's rhythm (notes, accents, slides, octave jumps); the pitches are the movement's own
  const g = grooveFor(ctx, ACID);
  const pattern = acidPattern(mrng.fork('acid'), g.acid);
  const square = mrng.fork('square').chance(0.35);
  const stabs = mrng.fork('stabs').chance(0.55);
  const kit = { kick: 'drop', snare: 'clap', sc: 0.55 } as const;
  // the 303 opens up over the movement: each return of a section is a little brighter and wetter
  const open = Math.min(1, ctx.local / Math.max(1, ctx.mv.sections.length - 2));
  const line = (from: number, n: number, c0: number, c1: number, res: number, env: number) =>
    acidLine(ctx, pattern, from, n, [c0 * (1 + open), c1 * (1 + 0.6 * open)], res, env, square);
  const band = { kit, bass: 'sub', bassGain: 0.5 } as const;

  switch (ctx.role) {
    case 'intro': {
      // a DJ-friendly start: a low filtered chord and a gentler kick from the first bar, then the full kick, the
      // hats and the 303 creeping in across the whole intro (a bare heavy kick alone sounds like a thumping door;
      // the sine-only soft kick, on small speakers, like a bell)
      padChords(ctx, 'warm', { cut: (slot) => runCut(ctx, slot, 350, 1400), g: 0.55 });
      for (let b = 0; b < bars; b++) {
        const rb = ctx.runBar(b);
        const soft = rb < 2;
        drums(
          ctx,
          b,
          { kick: 'x...x...x...x...', open: soft ? undefined : '..o...o...o...o.' },
          soft ? { kick: 'big', sc: 0.2 } : kit,
          soft ? 0.6 : 0.8,
        );
      }
      const from = Math.min(bars, Math.max(0, 2 - ctx.runStartBar));
      if (from < bars) line(from, bars - from, ...span(ctx, 200, 700, from / bars), 0.55, 0.5);
      break;
    }
    case 'verse':
      for (let b = 0; b < bars; b++) playGroove(ctx, g, b, band);
      line(0, bars, 320, 900, 0.7, 0.75);
      break;
    case 'build':
      padChords(ctx, 'wide', { cut: (slot) => runCut(ctx, slot, 1500, 5000), g: 0.45 });
      for (let b = 0; b < bars; b++) {
        drums(ctx, b, { kick: ctx.runBar(b) === ctx.runBars - 1 ? 'x.x.x.x.x.x.x.x.' : 'x...x...x...x...' }, kit);
      }
      line(0, bars, ...span(ctx, 500, 3800), 0.9, 1);
      runRoll(ctx, 0.3, 0.85);
      runRiser(ctx, 'sweep', false);
      if (ctx.nextRole === 'drop') stopBefore(ctx, 2, false);
      break;
    case 'drop':
      if (ctx.prevRole !== 'drop') {
        ctx.push({ i: 'impact', t: 0, k: 'drop', a: 0.9 });
        crash(ctx);
      }
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, band);
        if (stabs) {
          for (const s of [2, 6, 10, 14]) {
            ctx.push({
              i: 'pad',
              t: ctx.barAt(b, s),
              d: ctx.s16 * 1.2,
              n: ctx.chordAt(b).voicing.map((n) => n + 12),
              k: 'stab',
              cut: [4000, 1500],
              g: 0.5,
            });
          }
        }
      }
      // the 303 opens across the whole drop run, not again every 8 bars
      line(0, bars, ...span(ctx, 800, 2400), 0.85, 1.1);
      if (ctx.nextRole !== 'drop') roll(ctx, bars - 0.25, [[0.125, 2], [0.125, 4]], 0.5, 0.85, 'clap');
      break;
    case 'solo':
      for (let b = 0; b < bars; b++) playGroove(ctx, g, b, band);
      line(0, bars, 600, 5200, 0.95, 1.3);
      break;
    case 'break':
      padChords(ctx, 'warm', { cut: () => [1200, 1800], g: 0.7 });
      sustainedBass(ctx, 'sub', 0.3);
      for (let b = half; b < bars; b++) drums(ctx, b, { open: '..o...o...o...o.' }, kit, 0.6);
      line(0, bars, 180, 700, 0.9, 0.9);
      break;
    case 'rest':
      break;
    case 'outro':
    default:
      for (let b = 0; b < bars; b++) {
        const lastBar = ctx.runBar(b) === ctx.runBars - 1;
        drums(
          ctx,
          b,
          {
            kick: lastBar ? 'x...............' : 'x...x...x...x...',
            open: b < runHalf(ctx) ? '..o...o...o...o.' : undefined,
          },
          kit,
          0.85,
        );
      }
      line(0, ctx.nextRole === 'outro' ? bars : Math.max(1, bars - 1), ...span(ctx, 900, 220), 0.7, 0.6);
  }
  ringOut(ctx);
}
