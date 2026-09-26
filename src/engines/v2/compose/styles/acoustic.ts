// Haze (lo-fi), Garden (organic downtempo) and Nocturne (piano).

import type { BassKind } from '../../types.ts';
import type { Ctx } from '../context.ts';
import { GARDEN_TIMES, grooveFor, HAZE, inTime, playGroove } from '../grooves.ts';
import {
  breath,
  choir,
  chorusMelody,
  halves,
  introPreview,
  motifs,
  play,
  ringOut,
  sing,
  solo,
  stopBefore,
  stopTime,
  versePlan,
  type Voice,
  voiceFrom,
} from '../helpers.ts';
import { invert } from '../melody.ts';
import {
  arpNotes,
  bassFigure,
  comp,
  drums,
  guitarVoicing,
  padChords,
  percBar,
  pianoBar,
  type PianoFigure,
  pick,
  strumBar,
  sustainedBass,
} from '../parts.ts';

// ------------------------------------------------------------------ haze: lo-fi hip hop

const COMPS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 16]],
  [[0, 6], [6, 2], [10, 6]],
  [[0, 4], [8, 6]],
  [[0, 6], [6, 6], [12, 4]],
  [[0, 10], [14, 2]],
];

export function haze(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const { a: hook, b: hookB, c: own } = motifs(ctx);
  const verse = versePlan(ctx, 'none');
  const verseComp = mrng.fork('comp').pick(COMPS.slice(1));
  const chorusComp = mrng.fork('comp2').pick(COMPS.slice(1));
  const bassKind = mrng.fork('bass-kind').pick<BassKind>(['round', 'round', '808']);
  const piano = mrng.fork('piano').chance(0.35);
  const leads: Voice[] = [
    'flute',
    'wind:sax',
    'mallet:vibes',
    'wind:hum',
    'wind:flute',
    'piano',
    'string:electric',
    'string:guitar',
  ];
  const lead = voiceFrom(ctx, leads);
  const second = voiceFrom(ctx, ['wind:sax', 'mallet:vibes', 'string:electric', 'piano', 'string:guitar'], lead);
  const guitar = mrng.fork('guitar').chance(0.45);
  const kit = { kick: 'dusty', snare: 'dusty', hat: 'dusty', sc: 0.15 } as const;
  const g = grooveFor(ctx, HAZE);
  const band = { kit, bass: bassKind, bassGain: 0.9, perc: 0.5 } as const;
  const hat = g.light.hat ?? 'x.o.x.o.x.o.x.o.';
  const keys = (b: number, hits: readonly (readonly [number, number])[], v: number) => {
    if (!piano) return comp(ctx, b, hits, v);
    for (const [s, len] of hits) {
      ctx.push({
        i: 'piano',
        t: ctx.barAt(b, s),
        d: len * ctx.s16,
        n: ctx.chordAt(b).voicing,
        v: v * 0.9,
        strum: 0.02,
      });
    }
  };

  if (ctx.mv.tone.crackle > 0 && ctx.role !== 'rest') ctx.push({ i: 'vinyl', t: 0, d: ctx.duration });

  switch (ctx.role) {
    case 'intro':
      for (let b = 0; b < bars; b++) keys(b, COMPS[0], 0.55);
      if (guitar && ctx.bars >= 4) { for (let b = half; b < bars; b++) pick(ctx, b, 'guitar', [0, 3, 4, 5], 2, 0.5); }
      introPreview(ctx, second, hook, { center: 2, lo: -2, hi: 8 });
      break;
    case 'verse':
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, band);
        keys(b, verseComp, 0.7);
        if (guitar && ctx.returning) pick(ctx, b, 'guitar', [0, 4, 3, 5, 4, 3], 2, 0.4);
      }
      if (verse === 'own') sing(ctx, second, own, { center: 1, lo: -3, hi: 7, velocity: 0.85 });
      // stop-time: the band hits the downbeat together and leaves the rest of the bar empty
      if (bars >= 8 && mrng.fork('stop-time').chance(0.25)) stopTime(ctx, 7);
      break;
    case 'prechorus':
      for (let b = 0; b < bars; b++) {
        if (b < last) playGroove(ctx, g, b, { ...band, gain: 0.85, bassGain: 0.8 });
        else {
          drums(ctx, b, { hat, snare: '....x...x.x.xxxx' }, { ...kit, lag: g.lag }, 0.85);
          bassFigure(ctx, b, g.bassFull, bassKind, 0.8);
        }
        keys(b, chorusComp, 0.65);
      }
      // the band stops before the chorus now and then, not every time
      if (ctx.rng.fork('pre-stop').chance(0.35)) stopBefore(ctx, 1);
      break;
    case 'chorus':
      padChords(ctx, 'warm', { cut: () => [900, 1100], g: 0.3 });
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, band);
        keys(b, chorusComp, 0.62);
        if (guitar) pick(ctx, b, 'guitar', [3, 4, 5, 4], 2, 0.35);
      }
      chorusMelody(ctx, lead, second, hook, { center: 2, lo: -2, hi: 8, velocity: 0.9 });
      break;
    case 'solo':
      for (let b = 0; b < bars; b++) {
        playGroove(ctx, g, b, { ...band, bassGain: 0.85 });
        keys(b, verseComp, 0.55);
      }
      solo(ctx, second, hook, { center: second === 'string:electric' ? 0 : 2, lo: -3, hi: 9 });
      break;
    case 'bridge':
      for (let b = 0; b < bars; b++) {
        keys(b, COMPS[3], 0.6);
        drums(ctx, b, { hat }, kit, 0.7);
      }
      sustainedBass(ctx, bassKind === '808' ? '808' : 'round', 0.7);
      sing(ctx, second, hookB, { center: 2, lo: -2, hi: 8, velocity: 0.85 });
      break;
    case 'break':
      for (let b = 0; b < bars; b++) {
        keys(b, COMPS[0], 0.6);
        drums(ctx, b, { hat }, kit, 0.7);
      }
      sing(ctx, lead, hook, { center: 4, lo: 0, hi: 10, stretch: 2, velocity: 0.75 });
      break;
    case 'rest':
      break;
    case 'outro':
    default:
      for (let b = 0; b < bars; b++) keys(b, b < half ? verseComp : COMPS[0], 0.6);
      for (let b = 0; b < half; b++) {
        playGroove(ctx, g, b, { ...band, gain: 0.85, bassGain: 0.8 });
      }
  }
  ringOut(ctx);
}

// ------------------------------------------------------------------ garden: organic downtempo

// a marimba figure that repeats every three sixteenths against the four-beat bar: the lilt of the style
const OSTINATOS: readonly (readonly number[])[] = [[0, 2, 1], [0, 1, 2, 3], [0, 2, 3, 1, 2]];

export function garden(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const { a: hook, b: hookB, c: own } = motifs(ctx);
  const verse = versePlan(ctx, 'none');
  const leads: Voice[] = ['mallet:kalimba', 'wind:flute', 'wind:hum', 'mallet:vibes', 'string:guitar', 'wind:sax'];
  const lead = voiceFrom(ctx, leads);
  const second = voiceFrom(ctx, ['mallet:kalimba', 'wind:flute', 'string:guitar', 'mallet:vibes'], lead);
  const ost = mrng.fork('ostinato').pick(OSTINATOS);
  const every = mrng.fork('ost-rate').pick([1, 2] as const);
  const strumming = mrng.fork('guitar').chance(0.5);
  const bassKind = mrng.fork('bass').pick<BassKind>(['round', '808', 'round']);
  const g = grooveFor(ctx, inTime(ctx, GARDEN_TIMES));
  const band = { kit: { kick: 'soft', snare: 'rim', sc: 0.15 }, bass: bassKind, bassGain: 0.7, perc: 0.8 } as const;

  const marimba = (b: number, v: number) => {
    const ns = arpNotes(ctx.chordAt(b), 60);
    for (let s = 0, j = b * ctx.spb; s < ctx.spb; s += every, j += every) {
      ctx.push({
        i: 'mallet',
        t: ctx.barAt(b, s),
        n: ns[ost[(j / every) % ost.length] % ns.length],
        v: v * (ctx.onBeat(s) ? 1 : 0.75),
        k: 'marimba',
      });
    }
  };
  const guitar = (b: number, v: number) => {
    if (strumming) {
      strumBar(ctx, b, guitarVoicing(ctx.chordAt(b)), 'guitar', v);
    } else pick(ctx, b, 'guitar', [0, 3, 2, 4, 1, 3, 2, 5], 2, v);
  };

  switch (ctx.role) {
    case 'intro':
      padChords(ctx, 'warm', { cut: (_, i) => [900 + 200 * i, 1300 + 200 * i], g: 0.6 });
      for (let b = 0; b < bars; b++) {
        marimba(b, 0.7);
        if (b >= half) drums(ctx, b, { shaker: '-o-o-o-o-o-o-o-o' }, {}, 0.6);
      }
      introPreview(ctx, second, hook, { center: 2, lo: -2, hi: 9 });
      break;
    case 'verse':
      padChords(ctx, 'warm', { cut: () => [1200, 1600], g: 0.45 });
      for (let b = 0; b < bars; b++) {
        marimba(b, 0.65);
        guitar(b, 0.55);
        playGroove(ctx, g, b, band);
      }
      if (verse === 'own') sing(ctx, second, own, { center: 1, lo: -3, hi: 8, velocity: 0.85 });
      break;
    case 'prechorus':
      padChords(ctx, 'warm', { cut: (_, i) => [1200 + 500 * i, 1800 + 600 * i], g: 0.5 });
      for (let b = 0; b < bars; b++) {
        guitar(b, 0.6);
        playGroove(ctx, g, b, band);
      }
      // the band stops before the chorus now and then, not every time
      if (ctx.rng.fork('pre-stop').chance(0.35)) stopBefore(ctx, 1);
      break;
    case 'chorus':
      padChords(ctx, 'warm', { cut: () => [1600, 2200], g: 0.5 });
      for (let b = 0; b < bars; b++) {
        marimba(b, 0.55);
        guitar(b, 0.6);
        playGroove(ctx, g, b, { ...band, bassGain: 0.8 });
      }
      chorusMelody(ctx, lead, second, hook, { center: 2, lo: -2, hi: 9 });
      break;
    case 'solo':
      padChords(ctx, 'warm', { cut: () => [1400, 1800], g: 0.45 });
      for (let b = 0; b < bars; b++) {
        guitar(b, 0.5);
        playGroove(ctx, g, b, { ...band, bassGain: 0.75 });
      }
      solo(ctx, second, hook, { center: 2, lo: -2, hi: 10 });
      break;
    case 'bridge':
      padChords(ctx, 'strings', { cut: () => [2000, 2800], g: 0.45 });
      for (let b = 0; b < bars; b++) {
        guitar(b, 0.5);
        percBar(ctx, b, { conga: 'x.......x.......' }, 0.6);
      }
      sing(ctx, second, hookB, { center: 1, lo: -3, hi: 7 });
      break;
    case 'break':
      padChords(ctx, 'warm', { cut: () => [1000, 1400], g: 0.55 });
      for (let b = 0; b < bars; b++) {
        pick(ctx, b, 'guitar', [0, 3, 2, 4, 1, 3, 2, 5], 2, 0.5);
        drums(ctx, b, { shaker: '-.-.-.-.-.-.-.-.' }, {}, 0.5);
      }
      sing(ctx, lead, invert(hook), { center: 3, lo: 0, hi: 10, stretch: 2, velocity: 0.8 });
      break;
    case 'rest':
      break;
    case 'outro':
    default:
      padChords(ctx, 'warm', { cut: (_, i) => [1400 - 100 * i, 900 - 60 * i], g: 0.55, rel: 2.5 });
      sustainedBass(ctx, bassKind, 0.6, 0, bars, 2);
      for (let b = 0; b < bars; b++) {
        marimba(b, 0.6 * (1 - b / bars));
        if (b < half) playGroove(ctx, g, b, { ...band, withBass: false, gain: 0.8 });
        if (b < last) guitar(b, 0.45);
      }
  }
  ringOut(ctx);
}

// ------------------------------------------------------------------ nocturne: piano

export function nocturne(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const { a: hook, b: hookB, c: own } = motifs(ctx);
  const verse = versePlan(ctx, 'hook');
  const figure = mrng.fork('figure').pick<PianoFigure>(['broken', 'alberti', 'rolling', 'broken', 'block']);
  const chorusFigure: PianoFigure = figure === 'block' ? 'broken' : 'rolling';
  const hum = mrng.fork('hum').chance(0.5);
  const second = voiceFrom(ctx, ['wind:hum', 'wind:flute', 'string:harp', 'mallet:vibes']);
  const lh = (from: number, to: number, fig: PianoFigure, v: number) => {
    for (let b = from; b < to; b++) pianoBar(ctx, b, fig, v);
  };
  // a fermata: the music holds its breath on the last beat of a phrase, then goes on
  const breathe = () => {
    if (bars >= 8 && ctx.rng.fork('fermata').chance(0.12)) {
      ctx.hush(ctx.barAt(4) - breath(ctx, 1) * ctx.beat, ctx.barAt(4), true);
    }
  };

  switch (ctx.role) {
    case 'intro':
      lh(0, bars, figure === 'rolling' ? 'broken' : figure, 0.55);
      introPreview(ctx, second, hook, { center: 4, lo: 0, hi: 11 });
      if (mrng.fork('intro-rest').chance(0.3)) stopBefore(ctx, 1);
      break;
    case 'verse':
      lh(0, bars, figure, 0.55);
      sing(ctx, 'piano', verse === 'own' ? own : hook, { center: 4, lo: 0, hi: 11, velocity: 0.8 });
      if (ctx.returning) padChords(ctx, 'strings', { cut: () => [1800, 2400], g: 0.35 });
      breathe();
      break;
    case 'chorus':
      lh(0, bars, chorusFigure, 0.6);
      padChords(ctx, 'strings', { cut: () => [2200, 3200], g: 0.45 });
      if (hum) choir(ctx, 'm', 0.7);
      chorusMelody(ctx, 'piano', second, hook, { center: 5, lo: 1, hi: 12 });
      breathe();
      break;
    case 'solo':
      lh(0, bars, figure, 0.5);
      padChords(ctx, 'strings', { cut: () => [1800, 2400], g: 0.3 });
      solo(ctx, 'piano', hook, { center: 5, lo: 1, hi: 13 });
      break;
    case 'bridge':
      lh(0, bars, 'block', 0.5);
      padChords(ctx, 'strings', { cut: () => [2000, 3000], g: 0.5 });
      sing(ctx, second, hookB, { center: 2, lo: -2, hi: 9 });
      break;
    case 'break':
      for (let b = 0; b < bars; b += 2) {
        const slot = ctx.chordAt(b);
        ctx.push({ i: 'piano', t: ctx.barAt(b), d: ctx.bar * 1.8, n: slot.voicing, v: 0.45, strum: 0.05 });
      }
      play(ctx, 'piano', [{ t: ctx.barAt(half, 8), d: ctx.bar, n: ctx.tonicMid + 7, v: 0.6 }], 1, false);
      if (ctx.rng.fork('break-stop').chance(0.5)) stopBefore(ctx, 1);
      break;
    case 'rest':
      break;
    case 'outro':
    default:
      lh(0, Math.max(1, half), figure, 0.45);
      lh(half, last, 'block', 0.4);
      padChords(ctx, 'strings', { cut: (_, i) => [1800 - 100 * i, 1200 - 80 * i], g: 0.4, rel: 3 });
      sing(ctx, 'piano', hook, { center: 4, lo: 0, hi: 11, velocity: 0.7 }, { bars: half, form: 'period' });
      ctx.push({
        i: 'piano',
        t: ctx.barAt(last),
        d: ctx.bar * 2,
        n: [...ctx.chords[ctx.chords.length - 1].voicing, ctx.tonicMid + 12],
        v: 0.5,
        strum: 0.04,
      });
  }
  ringOut(ctx);
}
