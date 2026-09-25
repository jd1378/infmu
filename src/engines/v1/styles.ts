import type { ModeName } from './theory.ts';
import type { Role, SectionDef, StyleId, Transition } from './types.ts';

type Weighted<T> = readonly (readonly [T, number])[];
type Range = readonly [number, number];

export interface StyleDef {
  id: StyleId;
  name: string;
  genre: string;
  bpm: Range;
  swing: Range;
  modes: Weighted<ModeName>;
  forms: readonly (readonly (readonly [Role, number])[])[];
  /** Energy multiplier on top of each role's base energy. */
  intensity: number;
  /** Stacked chord size (3 triad, 4 seventh, 5 ninth) and how often the third becomes a sus2. */
  chordSize: Weighted<3 | 4 | 5>;
  sus2: number;
  barsPerChord: 1 | 2;
  next: Weighted<StyleId>;
  transitions: Weighted<Transition>;
  room: Range;
  reverb: Range;
  delayBeats: readonly number[];
  delayFeedback: Range;
  delayWet: Range;
  crackle: Range;
  wow: Range;
}

const ROLE_ENERGY: Record<Role, number> = {
  intro: 0.35,
  verse: 0.6,
  chorus: 0.8,
  build: 0.75,
  drop: 1,
  break: 0.4,
  outro: 0.35,
};

export const STYLES: Record<StyleId, StyleDef> = {
  drift: {
    id: 'drift',
    name: 'Drift',
    genre: 'ambient',
    bpm: [60, 74],
    swing: [0, 0],
    modes: [['lydian', 3], ['ionian', 2], ['dorian', 2], ['aeolian', 1], ['mixolydian', 1]],
    forms: [
      [['intro', 4], ['verse', 8], ['chorus', 8], ['break', 4], ['chorus', 8], ['outro', 4]],
      [['intro', 4], ['verse', 8], ['break', 8], ['chorus', 8], ['outro', 4]],
    ],
    intensity: 0.5,
    chordSize: [[3, 2], [4, 3], [5, 1]],
    sus2: 0.3,
    barsPerChord: 2,
    next: [['drift', 1], ['haze', 3], ['cathedral', 2], ['pulse', 2], ['rise', 1]],
    transitions: [['fade', 3], ['swell', 2]],
    room: [0.9, 0.97],
    reverb: [1.7, 2.1],
    delayBeats: [1.5, 0.75, 1],
    delayFeedback: [0.45, 0.6],
    delayWet: [0.5, 0.7],
    crackle: [0, 0],
    wow: [0, 0.4],
  },
  haze: {
    id: 'haze',
    name: 'Haze',
    genre: 'lo-fi',
    bpm: [72, 88],
    swing: [0.12, 0.26],
    modes: [['dorian', 3], ['ionian', 2], ['aeolian', 2], ['mixolydian', 1]],
    forms: [
      [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['break', 4], ['chorus', 8], ['outro', 4]],
      [['intro', 4], ['verse', 8], ['chorus', 8], ['break', 4], ['chorus', 8], ['outro', 4]],
    ],
    intensity: 0.7,
    chordSize: [[4, 3], [5, 2]],
    sus2: 0,
    barsPerChord: 1,
    next: [['haze', 1], ['drift', 3], ['pulse', 3], ['rise', 1], ['cathedral', 1]],
    transitions: [['fade', 3], ['stop', 2]],
    room: [0.78, 0.86],
    reverb: [1.1, 1.4],
    delayBeats: [0.75, 1.5],
    delayFeedback: [0.3, 0.45],
    delayWet: [0.25, 0.4],
    crackle: [0.5, 1],
    wow: [0.6, 1],
  },
  pulse: {
    id: 'pulse',
    name: 'Pulse',
    genre: 'synthwave',
    bpm: [96, 112],
    swing: [0, 0],
    modes: [['aeolian', 4], ['dorian', 2], ['mixolydian', 1], ['ionian', 1]],
    forms: [
      [['intro', 8], ['verse', 8], ['chorus', 8], ['break', 8], ['chorus', 8], ['outro', 4]],
      [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['outro', 4]],
    ],
    intensity: 0.88,
    chordSize: [[3, 4], [4, 1]],
    sus2: 0.1,
    barsPerChord: 1,
    next: [['pulse', 1], ['rise', 3], ['haze', 2], ['cathedral', 2], ['drift', 1]],
    transitions: [['fade', 2], ['swell', 2], ['stop', 1]],
    room: [0.84, 0.9],
    reverb: [1.4, 1.7],
    delayBeats: [0.75],
    delayFeedback: [0.4, 0.5],
    delayWet: [0.4, 0.55],
    crackle: [0, 0],
    wow: [0, 0.2],
  },
  rise: {
    id: 'rise',
    name: 'Rise',
    genre: 'trance',
    bpm: [120, 128],
    swing: [0, 0],
    modes: [['aeolian', 5], ['dorian', 1], ['phrygian', 1]],
    forms: [
      [['intro', 8], ['verse', 8], ['build', 4], ['drop', 8], ['break', 8], ['build', 4], ['drop', 8], ['outro', 8]],
      [['intro', 8], ['build', 4], ['drop', 8], ['break', 8], ['build', 4], ['drop', 8], ['outro', 4]],
    ],
    intensity: 1,
    chordSize: [[3, 1]],
    sus2: 0,
    barsPerChord: 1,
    next: [['rise', 1], ['pulse', 3], ['cathedral', 2], ['drift', 2], ['haze', 1]],
    transitions: [['swell', 2], ['stop', 2], ['fade', 1]],
    room: [0.82, 0.88],
    reverb: [1.5, 1.7],
    delayBeats: [0.75],
    delayFeedback: [0.38, 0.46],
    delayWet: [0.45, 0.6],
    crackle: [0, 0],
    wow: [0, 0],
  },
  cathedral: {
    id: 'cathedral',
    name: 'Cathedral',
    genre: 'cinematic',
    bpm: [68, 82],
    swing: [0, 0],
    modes: [['aeolian', 3], ['harmonic', 2], ['dorian', 1]],
    forms: [
      [['intro', 4], ['verse', 8], ['chorus', 8], ['build', 4], ['drop', 8], ['outro', 4]],
      [['intro', 4], ['verse', 8], ['break', 4], ['build', 4], ['drop', 8], ['outro', 4]],
    ],
    intensity: 0.9,
    chordSize: [[3, 1]],
    sus2: 0,
    barsPerChord: 1,
    next: [['cathedral', 1], ['drift', 3], ['rise', 2], ['pulse', 2], ['haze', 1]],
    transitions: [['fade', 2], ['swell', 2]],
    room: [0.92, 0.96],
    reverb: [1.7, 2],
    delayBeats: [0.75, 1.5],
    delayFeedback: [0.3, 0.4],
    delayWet: [0.2, 0.35],
    crackle: [0, 0],
    wow: [0, 0],
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

export function sectionsFor(style: StyleDef, form: readonly (readonly [Role, number])[]): SectionDef[] {
  return form.map(([role, bars]) => ({ role, bars, energy: Math.min(1, ROLE_ENERGY[role] * style.intensity) }));
}

// ------------------------------------------------------------------ progressions
// Chord roots as mode degrees (0 = tonic). `alt` makes a chord tone chromatic (index 1 = third), e.g. the
// major V of a minor key. Families are grouped by the mode's character.

export interface ProgChord {
  deg: number;
  alt?: readonly number[];
}

const P = (...degs: (number | ProgChord)[]): ProgChord[] => degs.map((d) => (typeof d === 'number' ? { deg: d } : d));
const MAJOR_V: ProgChord = { deg: 4, alt: [0, 1] };
const MINOR_IV: ProgChord = { deg: 3, alt: [0, -1] };

export const PROGRESSIONS: Record<ModeName, ProgChord[][]> = {
  aeolian: [
    P(0, 5, 2, 6),
    P(0, 6, 5, 6),
    P(0, 3, 5, MAJOR_V),
    P(5, 6, 0, 0),
    P(0, 5, 3, MAJOR_V),
    P(0, 2, 6, 3),
    P(0, 3, 6, 2),
    P(5, 2, 6, 0),
    P(0, 5, 3, 6),
  ],
  dorian: [P(0, 3, 0, 3), P(0, 1, 2, 3), P(0, 6, 3, 0), P(0, 4, 3, 0), P(0, 2, 3, 0), P(0, 3, 6, 3)],
  phrygian: [P(0, 1, 0, 1), P(0, 1, 2, 1), P(0, 5, 6, 1), P(0, 2, 1, 0)],
  harmonic: [P(0, 3, 4, 0), P(0, 5, 3, 4), P(0, 5, 1, 4), P(0, 3, 5, 4)],
  ionian: [
    P(0, 4, 5, 3),
    P(5, 3, 0, 4),
    P(0, 5, 3, 4),
    P(3, 0, 4, 5),
    P(0, 3, 5, 4),
    P(3, 4, 2, 5),
    P(1, 4, 0, 0),
    P(3, 2, 1, 0),
    P(0, 2, 3, MINOR_IV),
  ],
  lydian: [P(0, 1, 0, 1), P(0, 1, 5, 0), P(0, 6, 1, 0), P(0, 1, 2, 1)],
  mixolydian: [P(0, 6, 3, 0), P(0, 4, 6, 3), P(0, 6, 0, 3), P(3, 6, 0, 0)],
};
