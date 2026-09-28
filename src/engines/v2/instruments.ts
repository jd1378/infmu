// Every instrument v2 can synthesize, playable a note at a time (see Engine.instruments). A note is rendered as a
// one-event section of a piece in the style the instrument belongs to, so it goes through that style's room, amp
// and master and sounds as it does in the music.

import type { InstrumentInfo } from '../../core/engine.ts';
import { Song } from './plan.ts';
import { hash32 } from './rng.ts';
import type { Ev, Movement, Score, StyleId } from './types.ts';

interface Instrument extends InstrumentInfo {
  /** The style whose mix it is heard in. */
  style: StyleId;
  /** A pitched instrument's note. */
  note?: (n: number) => Ev;
  /** An unpitched one's sounds, by hit id. */
  sound?: Record<string, () => Ev>;
}

const V = 0.8;

const pitched = (
  id: string,
  name: string,
  family: InstrumentInfo['family'],
  range: readonly [number, number],
  style: StyleId,
  about: string,
  note: (n: number) => Ev,
): Instrument => ({ id, name, family, range, style, about, note });

const struck = (
  id: string,
  name: string,
  family: InstrumentInfo['family'],
  style: StyleId,
  about: string,
  list: readonly (readonly [string, string, () => Ev])[],
): Instrument => ({
  id,
  name,
  family,
  style,
  about,
  hits: list.map(([hit, label]) => ({ id: hit, name: label })),
  sound: Object.fromEntries(list.map(([hit, , make]) => [hit, make])),
});

const pad = (k: Extract<Ev, { i: 'pad' }>['k'], name: string, style: StyleId, about: string) =>
  pitched(`pad:${k}`, name, 'pads', [36, 84], style, about, (n) => ({
    i: 'pad',
    t: 0,
    d: 2.6,
    n: [n],
    k,
    cut: [1400, 2600],
  }));
const synthBass = (k: Extract<Ev, { i: 'bass' }>['k'], name: string, style: StyleId, about: string) =>
  pitched(`bass:${k}`, name, 'synth bass', [24, 55], style, about, (n) => ({ i: 'bass', t: 0, d: 0.9, n, v: V, k }));
const lead = (
  k: Extract<Ev, { i: 'lead' }>['k'],
  name: string,
  range: readonly [number, number],
  style: StyleId,
  about: string,
) =>
  pitched(`lead:${k}`, name, 'synths', range, style, about, (n) => ({
    i: 'lead',
    t: 0,
    k,
    ns: [{ t: 0, d: 1.1, n, v: V }],
    lead: true,
  }));
const choir = (vowel: Extract<Ev, { i: 'choir' }>['vowel'], name: string) =>
  pitched(
    `choir:${vowel}`,
    name,
    'voices',
    [48, 79],
    'cathedral',
    'A choir of many voices, each its own singer.',
    (n) => ({
      i: 'choir',
      t: 0,
      d: 2,
      n: [n],
      vowel,
    }),
  );

export const INSTRUMENTS: readonly Instrument[] = [
  // keyboards
  pitched(
    'piano',
    'Grand piano',
    'piano',
    [36, 96],
    'nocturne',
    "Modal synthesis of a grand: stretched, beating partials, hammers and a sustain pedal's sympathetic strings.",
    (n) => ({ i: 'piano', t: 0, d: 1.6, n: [n], v: V }),
  ),
  pitched(
    'keys',
    'Electric piano',
    'keys',
    [40, 88],
    'haze',
    'A tine electric piano, bell-like when played hard, warm when soft.',
    (n) => ({ i: 'keys', t: 0, d: 1.4, n: [n], v: V }),
  ),
  pitched(
    'organ',
    'Organ',
    'organ',
    [36, 84],
    'cathedral',
    'A pipe organ in a stone room.',
    (n) => ({ i: 'organ', t: 0, d: 1.8, n, att: 0.04, rel: 0.5 }),
  ),
  // mallets and bells
  pitched(
    'mallet:marimba',
    'Marimba',
    'mallets',
    [45, 96],
    'garden',
    'Rosewood bars over resonator tubes.',
    (n) => ({ i: 'mallet', t: 0, n, v: V, k: 'marimba' }),
  ),
  pitched(
    'mallet:vibes',
    'Vibraphone',
    'mallets',
    [53, 89],
    'garden',
    'Metal bars with a motor turning in their resonators.',
    (n) => ({ i: 'mallet', t: 0, n, v: V, k: 'vibes' }),
  ),
  pitched(
    'mallet:kalimba',
    'Kalimba',
    'kalimba',
    [60, 88],
    'garden',
    'Steel tines on a wooden box, plucked by the thumbs.',
    (n) => ({ i: 'mallet', t: 0, n, v: V, k: 'kalimba' }),
  ),
  pitched(
    'bell',
    'Bells',
    'bells',
    [60, 96],
    'drift',
    'An FM bell, glassy and long.',
    (n) => ({ i: 'bell', t: 0, n: [n], v: V }),
  ),
  // strings
  pitched(
    'string:guitar',
    'Acoustic guitar',
    'guitar',
    [40, 86],
    'garden',
    'A steel-string acoustic: a waveguide string, the body and the fingers on the frets.',
    (n) => ({ i: 'string', t: 0, n, v: V, k: 'guitar', d: 1.4 }),
  ),
  pitched(
    'string:electric',
    'Electric guitar',
    'guitar',
    [40, 88],
    'pulse',
    'A clean electric with a chorus.',
    (n) => ({ i: 'string', t: 0, n, v: V, k: 'electric', d: 1.4 }),
  ),
  pitched(
    'string:clean',
    'Clean guitar',
    'guitar',
    [40, 88],
    'ember',
    "Post-rock's clean electric, drenched in dotted-eighth delay and a hall.",
    (n) => ({ i: 'string', t: 0, n, v: V, k: 'clean', d: 1.6 }),
  ),
  pitched(
    'string:overdrive',
    'Overdriven guitar',
    'guitar',
    [40, 76],
    'ember',
    'A guitar through a driven amp and cabinet, double-tracked.',
    (n) => ({ i: 'string', t: 0, n, v: V, k: 'overdrive', d: 1.6, p: -0.6 }),
  ),
  pitched(
    'string:harp',
    'Harp',
    'harp',
    [36, 96],
    'nocturne',
    'A concert harp, plucked.',
    (n) => ({ i: 'string', t: 0, n, v: V, k: 'harp' }),
  ),
  // basses
  pitched(
    'bass:pick',
    'Bass guitar, picked',
    'bass',
    [28, 60],
    'ember',
    'A Precision bass played with a pick into a driven amp: a click on every note.',
    (n) => ({ i: 'bass', t: 0, d: 1, n, v: V, k: 'pick' }),
  ),
  pitched(
    'bass:finger',
    'Bass guitar, fingered',
    'bass',
    [28, 60],
    'garden',
    'The same bass played with the fingers, rounder and cleaner.',
    (n) => ({ i: 'bass', t: 0, d: 1, n, v: V, k: 'finger' }),
  ),
  synthBass('sub', 'Sub bass', 'pulse', 'A sine and its octave, soft at the start: felt more than heard.'),
  synthBass('saw', 'Saw bass', 'pulse', 'A driven saw through a low-pass.'),
  synthBass('roll', 'Rolling bass', 'rise', "Trance's bass between the kicks, a resonant saw."),
  synthBass('pulse', 'Pulse bass', 'pulse', "Synthwave's resonant bass."),
  synthBass('round', 'Round bass', 'garden', 'A warm, rounded bass for downtempo.'),
  synthBass('808', '808 bass', 'haze', "The drum machine's long, pitched kick used as a bass."),
  // winds and voices
  pitched(
    'wind:flute',
    'Flute',
    'winds',
    [60, 96],
    'garden',
    'A breath-driven flute: the air in the tone, a vibrato that comes in late.',
    (n) => ({ i: 'wind', t: 0, k: 'flute', ns: [{ t: 0, d: 1.3, n, v: V }], lead: true }),
  ),
  pitched(
    'wind:sax',
    'Saxophone',
    'winds',
    [49, 81],
    'haze',
    'A tenor saxophone, breathy and reedy.',
    (n) => ({ i: 'wind', t: 0, k: 'sax', ns: [{ t: 0, d: 1.3, n, v: V }], lead: true }),
  ),
  pitched(
    'wind:hum',
    'Hummed voice',
    'voices',
    [45, 79],
    'drift',
    'A voice humming with the mouth closed.',
    (n) => ({ i: 'wind', t: 0, k: 'hum', ns: [{ t: 0, d: 1.5, n, v: V }], lead: true }),
  ),
  choir('a', 'Choir, ah'),
  choir('o', 'Choir, oh'),
  choir('u', 'Choir, oo'),
  choir('m', 'Choir, humming'),
  // synths
  lead('hook', 'Hook lead', [57, 88], 'rise', "Trance's supersaw lead."),
  lead('hook2', 'Hook lead, second', [57, 88], 'rise', "The supersaw lead's brighter twin."),
  lead('saw', 'Saw lead', [57, 88], 'pulse', 'A single saw lead with glide and vibrato.'),
  lead('flute', 'Synth flute', [60, 96], 'drift', 'A soft sine-and-noise lead.'),
  lead('brass', 'Brass', [48, 82], 'cathedral', 'A section of horns, swelling.'),
  pitched(
    'pluck',
    'Pluck',
    'synths',
    [48, 84],
    'rise',
    'A short, bright synth pluck for arpeggios.',
    (n) => ({ i: 'pluck', t: 0, n, v: V, cut: 2400, p: 0 }),
  ),
  pitched(
    'acid',
    'Acid 303',
    'synths',
    [24, 55],
    'acid',
    'The bass line machine: a squelching resonant filter.',
    (n) => ({
      i: 'acid',
      t: 0,
      ns: [{ t: 0, d: 0.35, n, v: V, accent: true, slide: false }],
      cut: [300, 2600],
      res: 0.75,
      env: 0.7,
    }),
  ),
  pitched(
    'drone',
    'Drone',
    'synths',
    [28, 60],
    'drift',
    'A low, slowly moving drone.',
    (n) => ({ i: 'drone', t: 0, d: 3, n }),
  ),
  // pads
  pad('warm', 'Warm pad', 'drift', 'A slow, warm pad.'),
  pad('wide', 'Wide pad', 'rise', 'A wide, detuned supersaw pad.'),
  pad('glass', 'Glass pad', 'drift', 'A thin, glassy pad high above the band.'),
  pad('bloom', 'Bloom pad', 'drift', 'A pad that opens as it is held.'),
  pad('drop', 'Drop pad', 'rise', 'The big chord of a trance drop.'),
  pad('stab', 'Stab', 'rise', 'A short chord stab.'),
  pad('strings', 'String section', 'cathedral', 'Five players a note, each bowing with their own vibrato.'),
  // drums
  struck(
    'kit:acoustic',
    'Acoustic drum kit',
    'drums',
    'ember',
    'A real kit in a room, fitted to recordings: every stroke a different take.',
    [
      ['kick', 'Kick', () => ({ i: 'kick', t: 0, v: V, k: 'acoustic', sc: 0, n: 33 })],
      ['snare', 'Snare', () => ({ i: 'snare', t: 0, v: V, k: 'acoustic' })],
      ['hat', 'Hi-hat', () => ({ i: 'hat', t: 0, v: V, k: 'closed' })],
      ['open', 'Open hi-hat', () => ({ i: 'hat', t: 0, v: V, k: 'open' })],
      ['tomHi', 'High tom', () => ({ i: 'tom', t: 0, v: V, n: 52, k: 'acoustic' })],
      ['tomMid', 'Middle tom', () => ({ i: 'tom', t: 0, v: V, n: 47, k: 'acoustic' })],
      ['tomLo', 'Floor tom', () => ({ i: 'tom', t: 0, v: V, n: 42, k: 'acoustic' })],
      ['ride', 'Ride', () => ({ i: 'perc', t: 0, v: V, k: 'acousticRide' })],
      ['crash', 'Crash', () => ({ i: 'perc', t: 0, v: V, k: 'acousticCrash' })],
    ],
  ),
  struck(
    'kit:dance',
    'Electronic drum kit',
    'drums',
    'rise',
    "Dance music's drum machine: kicks, claps, snares and hats.",
    [
      ['kick', 'Big kick', () => ({ i: 'kick', t: 0, v: V, k: 'big', sc: 0, n: 33 })],
      ['snare', 'Snare', () => ({ i: 'snare', t: 0, v: V, k: 'big' })],
      ['hat', 'Closed hat', () => ({ i: 'hat', t: 0, v: V, k: 'closed' })],
      ['open', 'Open hat', () => ({ i: 'hat', t: 0, v: V, k: 'open' })],
      ['clap', 'Clap', () => ({ i: 'snare', t: 0, v: V, k: 'clap' })],
      ['drop', 'Drop kick', () => ({ i: 'kick', t: 0, v: V, k: 'drop', sc: 0, n: 33 })],
      ['punch', 'Punchy kick', () => ({ i: 'kick', t: 0, v: V, k: 'punch', sc: 0, n: 33 })],
      ['huge', 'Huge snare', () => ({ i: 'snare', t: 0, v: V, k: 'huge' })],
      ['gated', 'Gated snare', () => ({ i: 'snare', t: 0, v: V, k: 'gated' })],
      ['roll', 'Roll snare', () => ({ i: 'snare', t: 0, v: V, k: 'roll' })],
      ['tom', 'Synth tom', () => ({ i: 'tom', t: 0, v: V, n: 45 })],
      ['crash', 'Crash', () => ({ i: 'perc', t: 0, v: V, k: 'crash' })],
      ['ride', 'Ride', () => ({ i: 'perc', t: 0, v: V, k: 'ride' })],
    ],
  ),
  struck('kit:lofi', 'Lo-fi drum kit', 'drums', 'haze', 'A dusty, sampled-sounding kit.', [
    ['kick', 'Dusty kick', () => ({ i: 'kick', t: 0, v: V, k: 'dusty', sc: 0, n: 33 })],
    ['snare', 'Dusty snare', () => ({ i: 'snare', t: 0, v: V, k: 'dusty' })],
    ['hat', 'Dusty hat', () => ({ i: 'hat', t: 0, v: V, k: 'dusty' })],
    ['rim', 'Rim', () => ({ i: 'snare', t: 0, v: V, k: 'rim' })],
    ['soft', 'Soft kick', () => ({ i: 'kick', t: 0, v: V, k: 'soft', sc: 0, n: 33 })],
    ['snap', 'Snap', () => ({ i: 'perc', t: 0, v: V, k: 'snap' })],
  ]),
  struck('percussion', 'Hand percussion', 'percussion', 'garden', 'Congas, a bongo, a cowbell and a shaker.', [
    ['conga', 'Low conga', () => ({ i: 'perc', t: 0, v: V, k: 'conga' })],
    ['congaHi', 'High conga', () => ({ i: 'perc', t: 0, v: V, k: 'congaHi' })],
    ['bongo', 'Bongo', () => ({ i: 'perc', t: 0, v: V, k: 'bongo' })],
    ['cowbell', 'Cowbell', () => ({ i: 'perc', t: 0, v: V, k: 'cowbell' })],
    ['shaker', 'Shaker', () => ({ i: 'hat', t: 0, v: V, k: 'shaker' })],
  ]),
  // effects
  struck('impacts', 'Impacts', 'effects', 'rise', 'The hits that land a drop: a boom, a crash and a chord stab.', [
    ['hit', 'Hit', () => ({ i: 'impact', t: 0, k: 'hit', a: 0.9, n: [60, 64, 67] })],
    ['drop', 'Drop', () => ({ i: 'impact', t: 0, k: 'drop', a: 0.9, n: [57, 60, 64] })],
    ['cosmic', 'Cosmic', () => ({ i: 'impact', t: 0, k: 'cosmic', a: 0.9, n: [62, 65, 69] })],
    ['final', 'Final', () => ({ i: 'impact', t: 0, k: 'final', a: 0.9, n: [55, 59, 62] })],
    ['soft', 'Soft', () => ({ i: 'impact', t: 0, k: 'soft', a: 0.9 })],
    ['ping', 'Ping', () => ({ i: 'impact', t: 0, k: 'ping', a: 0.9 })],
    ['heart', 'Heartbeat', () => ({ i: 'bass', t: 0, d: 0.4, n: 33, v: V, k: 'heart' })],
  ]),
  struck(
    'risers',
    'Risers',
    'effects',
    'rise',
    'What leads into a big part: a riser, a reversed cymbal, a chord swelling backwards.',
    [
      ['build', 'Riser', () => ({ i: 'rise', t: 0, d: 3, k: 'build' })],
      ['cymbal', 'Reverse cymbal', () => ({ i: 'rise', t: 0, d: 2.5, k: 'cymbal' })],
      ['swell', 'Reverse swell', () => ({ i: 'rise', t: 0, d: 2.5, k: 'swell', n: [57, 60, 64, 69] })],
    ],
  ),
];

const BY_ID = new Map(INSTRUMENTS.map((x) => [x.id, x]));

/** The pieces the instruments are heard in: one per style, planned once. */
const HOMES = new Map<StyleId, Movement>();
const home = (style: StyleId): Movement => {
  if (!HOMES.has(style)) HOMES.set(style, new Song(`instruments-${style}`, [style]).movement(0));
  return HOMES.get(style)!;
};

/** How long a note's section lasts: until its event ends, and at least a second. */
const lengthOf = (e: Ev): number => {
  const d = 'd' in e && typeof e.d === 'number' ? e.d : 'ns' in e ? Math.max(...e.ns.map((n) => n.t + n.d)) : 0.5;
  return Math.max(1, d + 0.2);
};

/**
 * A one-note section: `note` is a MIDI note (clamped to the instrument's range) for a pitched instrument, a hit id
 * for an unpitched one. Played at the energy of a chorus, in its style's mix.
 */
export function noteScore(id: string, note: number | string): Score {
  const x = BY_ID.get(id);
  if (!x) throw new RangeError(`unknown instrument ${id}`);
  let ev: Ev;
  if (x.note && x.range) {
    if (typeof note !== 'number' || !Number.isFinite(note)) throw new RangeError(`${id} plays notes`);
    ev = x.note(Math.max(x.range[0], Math.min(x.range[1], Math.round(note))));
  } else {
    const make = typeof note === 'string' ? x.sound?.[note] : undefined;
    if (!make) throw new RangeError(`${id} has no sound ${String(note)}`);
    ev = make();
  }
  const mv = home(x.style);
  const duration = lengthOf(ev);
  return {
    index: 0,
    movement: mv,
    section: { role: 'chorus', bars: 1, energy: 0.75, shift: 0, seconds: duration },
    local: 0,
    offset: 0,
    duration,
    tail: 2.5,
    bpm: mv.bpm,
    bars: [0, duration],
    events: [ev],
    chords: [],
    noiseSeed: hash32(id.length, typeof note === 'number' ? note : note.length, 0x696e73),
  };
}
