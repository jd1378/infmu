// Haze (lo-fi), Garden (organic downtempo) and Nocturne (piano).

import type { BassKind } from '../../types.ts';
import type { Ctx } from '../context.ts';
import {
  breath,
  choir,
  chorusMelody,
  halves,
  motifs,
  play,
  ringOut,
  sing,
  solo,
  stopBefore,
  stopTime,
  type Voice,
  voiceFrom,
} from '../helpers.ts';
import { invert } from '../melody.ts';
import {
  arpNotes,
  bassFigure,
  type BassHit,
  comp,
  drums,
  guitarVoicing,
  padChords,
  percBar,
  pianoBar,
  type PianoFigure,
  pick,
  strum,
  sustainedBass,
} from '../parts.ts';

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

export function haze(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const { a: hook, b: hookB } = motifs(ctx, 0.45);
  const kick = mrng.fork('kick').pick(HAZE_KICKS);
  const hat = mrng.fork('hat').pick(HAZE_HATS);
  const verseComp = mrng.fork('comp').pick(COMPS.slice(1));
  const chorusComp = mrng.fork('comp2').pick(COMPS.slice(1));
  const bassKind = mrng.fork('bass-kind').pick<BassKind>(['round', 'round', '808']);
  const bass = bassFromKick(kick);
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
  const snap = mrng.fork('snap').chance(0.4);
  const kit = { kick: 'dusty', snare: 'dusty', hat: 'dusty', sc: 0.15 } as const;
  const snare = mrng.fork('snare').chance(0.5) ? '....x.......x..-' : '....x.......x...';
  const fill = mrng.fork('fill').pick(['....x.......x-o-', '....x.....-.x.-o', '....x...-...x-x-']);
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
  const beat = (b: number, extra = {}) => {
    drums(ctx, b, { kick, snare: b === ctx.bars - 1 ? fill : snare, hat, ...extra }, kit);
    if (snap) percBar(ctx, b, { snap: '....x.......x...' }, 0.5);
  };

  if (ctx.mv.tone.crackle > 0 && ctx.role !== 'rest') ctx.push({ i: 'vinyl', t: 0, d: ctx.duration });

  switch (ctx.role) {
    case 'intro':
      for (let b = 0; b < bars; b++) keys(b, COMPS[0], 0.55);
      if (guitar && ctx.bars >= 4) { for (let b = half; b < bars; b++) pick(ctx, b, 'guitar', [0, 3, 4, 5], 2, 0.5); }
      break;
    case 'verse':
      for (let b = 0; b < bars; b++) {
        beat(b);
        bassFigure(ctx, b, bass, bassKind, 0.9);
        keys(b, verseComp, 0.7);
        if (guitar && ctx.occ) pick(ctx, b, 'guitar', [0, 4, 3, 5, 4, 3], 2, 0.4);
      }
      // stop-time: the band hits the downbeat together and leaves the rest of the bar empty
      if (bars >= 8 && mrng.fork('stop-time').chance(0.4)) stopTime(ctx, 7);
      break;
    case 'prechorus':
      for (let b = 0; b < bars; b++) {
        drums(ctx, b, { hat, snare: b === last ? '....x...x.x.xxxx' : snare }, kit, 0.85);
        bassFigure(ctx, b, bass, bassKind, 0.8);
        keys(b, chorusComp, 0.65);
      }
      stopBefore(ctx, 1);
      break;
    case 'chorus':
      padChords(ctx, 'warm', { cut: () => [900, 1100], g: 0.3 });
      for (let b = 0; b < bars; b++) {
        beat(b, { shaker: '..-...-...-...-.' });
        bassFigure(ctx, b, bass, bassKind, 0.9);
        keys(b, chorusComp, 0.62);
        if (guitar) pick(ctx, b, 'guitar', [3, 4, 5, 4], 2, 0.35);
      }
      chorusMelody(ctx, lead, second, hook, { center: 2, lo: -2, hi: 8, velocity: 0.9 });
      break;
    case 'solo':
      for (let b = 0; b < bars; b++) {
        beat(b);
        bassFigure(ctx, b, bass, bassKind, 0.85);
        keys(b, verseComp, 0.55);
      }
      solo(ctx, second, { center: second === 'string:electric' ? 0 : 2, lo: -3, hi: 9 }, 0.7);
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
        drums(ctx, b, { kick, snare }, kit, 0.85);
        bassFigure(ctx, b, bass, bassKind, 0.8);
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
  const { a: hook, b: hookB } = motifs(ctx, 0.5);
  const leads: Voice[] = ['mallet:kalimba', 'wind:flute', 'wind:hum', 'mallet:vibes', 'string:guitar', 'wind:sax'];
  const lead = voiceFrom(ctx, leads);
  const second = voiceFrom(ctx, ['mallet:kalimba', 'wind:flute', 'string:guitar', 'mallet:vibes'], lead);
  const ost = mrng.fork('ostinato').pick(OSTINATOS);
  const every = mrng.fork('ost-rate').pick([1, 2] as const);
  const strumming = mrng.fork('guitar').chance(0.5);
  const bassKind = mrng.fork('bass').pick<BassKind>(['round', '808', 'round']);
  const conga = mrng.fork('conga').pick(['x..o..x.x..o....', 'x.o...o.x.o...o.', 'o..x..o.o..x..x.']);
  const bongo = mrng.fork('bongo').pick(['..x-..x-..x-..x-', '.x...x.x.x...x..']);

  const marimba = (b: number, v: number) => {
    const ns = arpNotes(ctx.chordAt(b), 60);
    for (let s = 0, j = b * 16; s < 16; s += every, j += every) {
      ctx.push({
        i: 'mallet',
        t: ctx.barAt(b, s),
        n: ns[ost[(j / every) % ost.length] % ns.length],
        v: v * (s % 4 ? 0.75 : 1),
        k: 'marimba',
      });
    }
  };
  const guitar = (b: number, v: number) => {
    if (strumming) {
      const ns = guitarVoicing(ctx.chordAt(b));
      strum(ctx, ctx.barAt(b, 0), ns, 'guitar', v);
      strum(ctx, ctx.barAt(b, 6), ns.slice(2), 'guitar', v * 0.7, undefined, true);
      strum(ctx, ctx.barAt(b, 10), ns, 'guitar', v * 0.85);
    } else pick(ctx, b, 'guitar', [0, 3, 2, 4, 1, 3, 2, 5], 2, v);
  };
  const hands = (b: number, full: boolean) =>
    percBar(ctx, b, { conga, congaHi: full ? '......x.......x.' : undefined, bongo: full ? bongo : undefined }, 0.8);

  if (ctx.isFirst) ctx.push({ i: 'impact', t: 0, k: 'ping', a: 0.5 });

  switch (ctx.role) {
    case 'intro':
      padChords(ctx, 'warm', { cut: (_, i) => [900 + 200 * i, 1300 + 200 * i], g: 0.6 });
      for (let b = 0; b < bars; b++) {
        marimba(b, 0.7);
        if (b >= half) drums(ctx, b, { shaker: '-o-o-o-o-o-o-o-o' }, {}, 0.6);
      }
      break;
    case 'verse':
      padChords(ctx, 'warm', { cut: () => [1200, 1600], g: 0.45 });
      sustainedBass(ctx, bassKind, 0.7);
      for (let b = 0; b < bars; b++) {
        marimba(b, 0.65);
        guitar(b, 0.55);
        hands(b, ctx.occ > 0);
        drums(ctx, b, { shaker: '-o-o-o-o-o-o-o-o' }, {}, 0.6);
      }
      break;
    case 'prechorus':
      padChords(ctx, 'warm', { cut: (_, i) => [1200 + 500 * i, 1800 + 600 * i], g: 0.5 });
      sustainedBass(ctx, bassKind, 0.7);
      for (let b = 0; b < bars; b++) {
        guitar(b, 0.6);
        hands(b, true);
      }
      stopBefore(ctx, 1);
      break;
    case 'chorus':
      padChords(ctx, 'warm', { cut: () => [1600, 2200], g: 0.5 });
      sustainedBass(ctx, bassKind, 0.8);
      for (let b = 0; b < bars; b++) {
        marimba(b, 0.55);
        guitar(b, 0.6);
        hands(b, true);
        drums(ctx, b, { kick: 'x.........x.....', snare: '........x.......', shaker: '-o-o-o-o-o-o-o-o' }, {
          kick: 'soft',
          snare: 'rim',
          sc: 0.15,
        }, 0.8);
      }
      chorusMelody(ctx, lead, second, hook, { center: 2, lo: -2, hi: 9 });
      break;
    case 'solo':
      padChords(ctx, 'warm', { cut: () => [1400, 1800], g: 0.45 });
      sustainedBass(ctx, bassKind, 0.75);
      for (let b = 0; b < bars; b++) {
        guitar(b, 0.5);
        hands(b, true);
      }
      solo(ctx, second, { center: 2, lo: -2, hi: 10 }, 0.75);
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
        if (b < half) hands(b, false);
        if (b < last) guitar(b, 0.45);
      }
  }
  ringOut(ctx);
}

// ------------------------------------------------------------------ nocturne: piano

export function nocturne(ctx: Ctx): void {
  const { bars, mrng } = ctx;
  const { half, last } = halves(ctx);
  const { a: hook, b: hookB } = motifs(ctx, 0.4);
  const figure = mrng.fork('figure').pick<PianoFigure>(['broken', 'alberti', 'rolling', 'broken', 'block']);
  const chorusFigure: PianoFigure = figure === 'block' ? 'broken' : 'rolling';
  const hum = mrng.fork('hum').chance(0.5);
  const second = voiceFrom(ctx, ['wind:hum', 'wind:flute', 'string:harp', 'mallet:vibes', 'wind:sax', 'string:guitar']);
  const lh = (from: number, to: number, fig: PianoFigure, v: number) => {
    for (let b = from; b < to; b++) pianoBar(ctx, b, fig, v);
  };
  // a fermata: the music holds its breath on the last beat of a phrase, then goes on
  const breathe = () => {
    if (bars >= 8 && mrng.fork('fermata', ctx.role).chance(0.45)) {
      ctx.hush(ctx.barAt(4) - breath(ctx, 1) * ctx.beat, ctx.barAt(4), true);
    }
  };

  switch (ctx.role) {
    case 'intro':
      lh(0, bars, figure === 'rolling' ? 'broken' : figure, 0.55);
      if (mrng.fork('intro-rest').chance(0.5)) stopBefore(ctx, 1);
      break;
    case 'verse':
      lh(0, bars, figure, 0.55);
      sing(ctx, 'piano', hook, { center: 4, lo: 0, hi: 11, velocity: 0.8 });
      if (ctx.occ) padChords(ctx, 'strings', { cut: () => [1800, 2400], g: 0.35 });
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
      solo(ctx, 'piano', { center: 5, lo: 1, hi: 13 }, 0.65);
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
      stopBefore(ctx, 1);
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
