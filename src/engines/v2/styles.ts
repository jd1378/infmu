import type { ModeName } from './theory.ts';
import type { Role, StyleId, Transition } from './types.ts';

type Weighted<T> = readonly (readonly [T, number])[];
type Range = readonly [number, number];

export interface StyleDef {
  id: StyleId;
  name: string;
  genre: string;
  bpm: Range;
  swing: Range;
  modes: Weighted<ModeName>;
  /**
   * Song forms as "role:bars" steps; a trailing "?" marks a step that can be dropped to fit the movement's
   * target length (the planner removes optional steps from the end backwards).
   */
  forms: readonly string[];
  /**
   * Loudness of the movement's peak (LUFS) and how far below it its quietest part sits (LU): pieces build, as the
   * references do (a song's verses a few LU under its choruses, a cinematic piece rising from nearly nothing).
   */
  dynamics: readonly [peak: number, range: number];
  /** Loudness of the drums and of the bass against the bed of chords and textures, in LU. */
  balance: readonly [drums: number, bass: number];
  /** Stacked chord size (3 triad, 4 seventh, 5 ninth) and how often the third becomes a sus2. */
  chordSize: Weighted<3 | 4 | 5>;
  sus2: number;
  barsPerChord: 1 | 2;
  /** Chance the last chorus group lifts a key (up 1 or 2 semitones), the old pop move. */
  lift: number;
  next: Weighted<StyleId>;
  transitions: Weighted<Transition>;
  room: Range;
  reverb: Range;
  delayBeats: readonly number[];
  delayFeedback: Range;
  delayWet: Range;
  crackle: Range;
  wow: Range;
  /**
   * How a band's tempo breathes (see tempo.ts); all 0 for a sequencer's clock, which never moves. `rubato`: how
   * far a phrase presses on and relaxes in the calm parts (half that elsewhere); `push`: how much faster the
   * peak runs; `rit`: how far the tempo falls by the last beat of a piece that ends by stopping or fading.
   */
  tempo: { rubato: number; push: number; rit: number };
  /**
   * How it sounds recorded: `size` scales the room's early reflections (a small room at 0.6 to a hall at 1.6),
   * `early` is their level against the reverb send; `hiss` the noise floor in dBFS (null: a clean digital
   * production); `warmth` how hard the console and tape are driven (0: clean); `width` the side-to-mid ratio the
   * bed is opened up to (stereo-recorded instruments in a room sit around 0.5 to 0.7, a piano recorded by a spaced
   * pair wider still).
   */
  record: { size: number; early: number; hiss: number | null; warmth: number; width: number };
}

export const ROLE_ENERGY: Record<Role, number> = {
  intro: 0.15,
  verse: 0.4,
  prechorus: 0.5,
  chorus: 0.7,
  bridge: 0.35,
  build: 0.55,
  drop: 0.85,
  break: 0.2,
  solo: 0.6,
  rest: 0,
  outro: 0.2,
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
      'intro:4 verse:8 chorus:8 break:8 verse:8? chorus:8 bridge:8 chorus:8? outro:8',
      'intro:8 verse:8 verse:8? chorus:8 solo:8 bridge:8 chorus:8 chorus:8? outro:8',
    ],
    dynamics: [-16, 12],
    balance: [-7, -4],
    chordSize: [[3, 2], [4, 3], [5, 1]],
    sus2: 0.3,
    barsPerChord: 2,
    lift: 0,
    next: [['drift', 1], ['haze', 3], ['nocturne', 3], ['cathedral', 2], ['garden', 2], ['pulse', 1]],
    transitions: [['pause', 4], ['fade', 2], ['swell', 2]],
    room: [0.9, 0.97],
    reverb: [1.7, 2.1],
    delayBeats: [1.5, 0.75, 1],
    delayFeedback: [0.45, 0.6],
    delayWet: [0.5, 0.7],
    crackle: [0, 0],
    wow: [0, 0.4],
    tempo: { rubato: 0.04, push: 0, rit: 0.3 },
    record: { size: 1.3, early: 0.5, hiss: -72, warmth: 0, width: 0.6 },
  },
  haze: {
    id: 'haze',
    name: 'Haze',
    genre: 'lo-fi',
    bpm: [72, 88],
    swing: [0.12, 0.26],
    modes: [['dorian', 3], ['ionian', 2], ['aeolian', 2], ['mixolydian', 1]],
    forms: [
      'intro:4 verse:8 chorus:8 verse:8 prechorus:4? chorus:8 solo:8 bridge:8? chorus:8 chorus:8? outro:4',
      'intro:4 verse:8 verse:8? chorus:8 break:4 verse:8 chorus:8 solo:8? chorus:8 outro:8',
    ],
    dynamics: [-13, 8],
    balance: [-2, -3],
    chordSize: [[4, 3], [5, 2]],
    sus2: 0,
    barsPerChord: 1,
    lift: 0.3,
    next: [['haze', 1], ['drift', 3], ['garden', 3], ['nocturne', 2], ['pulse', 2], ['acid', 1]],
    transitions: [['pause', 4], ['fade', 2], ['stop', 2]],
    room: [0.78, 0.86],
    reverb: [1.1, 1.4],
    delayBeats: [0.75, 1.5],
    delayFeedback: [0.3, 0.45],
    delayWet: [0.25, 0.4],
    crackle: [0.5, 1],
    wow: [0.6, 1],
    tempo: { rubato: 0, push: 0, rit: 0 },
    record: { size: 0.6, early: 0.7, hiss: -60, warmth: 0.5, width: 0.6 },
  },
  pulse: {
    id: 'pulse',
    name: 'Pulse',
    genre: 'synthwave',
    bpm: [96, 112],
    swing: [0, 0],
    modes: [['aeolian', 4], ['dorian', 2], ['mixolydian', 1], ['ionian', 1]],
    forms: [
      'intro:8 verse:8 prechorus:4 chorus:8 verse:8 prechorus:4 chorus:8 solo:8 bridge:8 chorus:8 chorus:8? outro:8',
      'intro:8 verse:8 chorus:8 break:8 verse:8 chorus:8 solo:8? bridge:8 chorus:8 chorus:8? outro:4',
    ],
    dynamics: [-11, 10],
    balance: [-3, -3],
    chordSize: [[3, 4], [4, 1]],
    sus2: 0.1,
    barsPerChord: 1,
    lift: 0.45,
    next: [['pulse', 1], ['rise', 3], ['ember', 2], ['haze', 2], ['cathedral', 2], ['acid', 1]],
    transitions: [['pause', 3], ['fade', 2], ['swell', 2], ['stop', 1]],
    room: [0.84, 0.9],
    reverb: [1.4, 1.7],
    delayBeats: [0.75],
    delayFeedback: [0.4, 0.5],
    delayWet: [0.4, 0.55],
    crackle: [0, 0],
    wow: [0, 0.2],
    tempo: { rubato: 0, push: 0, rit: 0 },
    record: { size: 0.9, early: 0.3, hiss: null, warmth: 0.2, width: 0.6 },
  },
  rise: {
    id: 'rise',
    name: 'Rise',
    genre: 'trance',
    bpm: [120, 128],
    swing: [0, 0],
    modes: [['aeolian', 5], ['dorian', 1], ['phrygian', 1]],
    forms: [
      'intro:8 intro:8? verse:8 build:8 drop:8 drop:8 break:8 break:8? build:8 drop:8 drop:8 outro:8 outro:8?',
      'intro:8 verse:8 verse:8? build:4 drop:8 drop:8 break:8 bridge:8? build:8 drop:8 drop:8 outro:8',
    ],
    dynamics: [-10, 12],
    balance: [-2, -2],
    chordSize: [[3, 1]],
    sus2: 0,
    barsPerChord: 1,
    lift: 0.25,
    next: [['rise', 1], ['acid', 3], ['pulse', 3], ['cathedral', 2], ['ember', 2], ['drift', 1]],
    transitions: [['swell', 3], ['pause', 2], ['stop', 2]],
    room: [0.82, 0.88],
    reverb: [1.5, 1.7],
    delayBeats: [0.75],
    delayFeedback: [0.38, 0.46],
    delayWet: [0.45, 0.6],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0, push: 0, rit: 0 },
    record: { size: 1.0, early: 0.25, hiss: null, warmth: 0, width: 0.6 },
  },
  cathedral: {
    id: 'cathedral',
    name: 'Cathedral',
    genre: 'cinematic',
    bpm: [68, 82],
    swing: [0, 0],
    modes: [['aeolian', 3], ['harmonic', 2], ['dorian', 1]],
    forms: [
      'intro:4 verse:8 chorus:8 break:4 verse:8? chorus:8 bridge:8 build:4 drop:8 drop:8? outro:8',
      'intro:8 verse:8 chorus:8 bridge:8 break:4? build:4 drop:8 drop:8 outro:8',
    ],
    dynamics: [-10, 18],
    balance: [-4, -4],
    chordSize: [[3, 1]],
    sus2: 0,
    barsPerChord: 1,
    lift: 0.3,
    next: [['cathedral', 1], ['nocturne', 3], ['drift', 2], ['ember', 2], ['rise', 2]],
    transitions: [['pause', 3], ['fade', 2], ['swell', 2]],
    room: [0.92, 0.96],
    reverb: [1.7, 2],
    delayBeats: [0.75, 1.5],
    delayFeedback: [0.3, 0.4],
    delayWet: [0.2, 0.35],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0.05, push: 0.015, rit: 0.4 },
    record: { size: 1.6, early: 0.6, hiss: -70, warmth: 0, width: 0.8 },
  },
  acid: {
    id: 'acid',
    name: 'Acid',
    genre: 'acid house',
    bpm: [122, 128],
    swing: [0, 0.08],
    modes: [['aeolian', 3], ['phrygian', 2], ['dorian', 2]],
    forms: [
      'intro:8 verse:8 verse:8 build:8 drop:8 drop:8 break:8 build:4 drop:8 drop:8 drop:8? outro:8 outro:4?',
      'intro:8 intro:8? verse:8 build:4 drop:8 drop:8 solo:8 break:8 build:8 drop:8 drop:8 outro:8',
    ],
    dynamics: [-10, 10],
    balance: [-2, -2],
    chordSize: [[3, 2], [4, 1]],
    sus2: 0,
    barsPerChord: 2,
    lift: 0,
    next: [['acid', 1], ['rise', 3], ['pulse', 2], ['haze', 1], ['ember', 1]],
    transitions: [['stop', 2], ['pause', 2], ['swell', 1]],
    room: [0.8, 0.86],
    reverb: [1.2, 1.5],
    delayBeats: [0.75, 0.5],
    delayFeedback: [0.35, 0.5],
    delayWet: [0.3, 0.45],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0, push: 0, rit: 0 },
    record: { size: 0.8, early: 0.25, hiss: null, warmth: 0.2, width: 0.6 },
  },
  garden: {
    id: 'garden',
    name: 'Garden',
    genre: 'organic downtempo',
    bpm: [88, 104],
    swing: [0.06, 0.18],
    modes: [['dorian', 3], ['mixolydian', 2], ['ionian', 2], ['lydian', 1]],
    forms: [
      'intro:8 verse:8 chorus:8 verse:8 chorus:8 solo:8 break:8? bridge:8 chorus:8 chorus:8? outro:8',
      'intro:4 verse:8 verse:8? prechorus:4 chorus:8 break:8 solo:8 chorus:8 bridge:8? chorus:8 outro:8',
    ],
    dynamics: [-13, 9],
    balance: [-4, -4],
    chordSize: [[3, 2], [4, 2]],
    sus2: 0.2,
    barsPerChord: 1,
    lift: 0.2,
    next: [['garden', 1], ['haze', 3], ['drift', 3], ['nocturne', 1], ['pulse', 1]],
    transitions: [['pause', 4], ['fade', 3]],
    room: [0.8, 0.88],
    reverb: [1.2, 1.5],
    delayBeats: [0.75, 1],
    delayFeedback: [0.3, 0.45],
    delayWet: [0.25, 0.4],
    crackle: [0, 0],
    wow: [0, 0.2],
    tempo: { rubato: 0, push: 0.012, rit: 0.25 },
    record: { size: 0.8, early: 0.6, hiss: -68, warmth: 0.3, width: 0.6 },
  },
  nocturne: {
    id: 'nocturne',
    name: 'Nocturne',
    genre: 'piano',
    bpm: [60, 78],
    swing: [0, 0],
    modes: [['aeolian', 3], ['ionian', 2], ['dorian', 2], ['lydian', 1]],
    forms: [
      'intro:4 verse:8 verse:8? chorus:8 break:4 verse:8 bridge:8 chorus:8 chorus:8? outro:8',
      'intro:4 verse:8 chorus:8 verse:8 solo:8? chorus:8 bridge:8 chorus:8 outro:8',
    ],
    dynamics: [-16, 14],
    balance: [-9, -5],
    chordSize: [[3, 2], [4, 2]],
    sus2: 0.15,
    barsPerChord: 1,
    lift: 0.35,
    next: [['nocturne', 1], ['drift', 3], ['cathedral', 2], ['haze', 2], ['garden', 1]],
    transitions: [['pause', 5], ['fade', 2]],
    room: [0.88, 0.94],
    reverb: [1.5, 1.8],
    delayBeats: [1.5, 1],
    delayFeedback: [0.2, 0.3],
    delayWet: [0.08, 0.15],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0.16, push: 0.01, rit: 0.4 },
    record: { size: 0.9, early: 0.6, hiss: -70, warmth: 0, width: 0.85 },
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    genre: 'post-rock',
    bpm: [96, 124],
    swing: [0, 0],
    modes: [['aeolian', 3], ['ionian', 2], ['lydian', 2], ['dorian', 1]],
    forms: [
      'intro:8 verse:8 verse:8 build:8 chorus:8 chorus:8 break:8 break:8? build:8 build:8? drop:8 drop:8 outro:8 outro:8?',
      'intro:8 verse:8 build:8 chorus:8 bridge:8 break:8 build:8 drop:8 drop:8 drop:8? outro:8',
    ],
    dynamics: [-10, 16],
    balance: [-3, -4],
    chordSize: [[3, 3], [5, 1]],
    sus2: 0.25,
    barsPerChord: 1,
    lift: 0,
    next: [['ember', 1], ['cathedral', 3], ['drift', 2], ['pulse', 2], ['rise', 1]],
    transitions: [['pause', 4], ['fade', 2], ['swell', 1]],
    room: [0.86, 0.92],
    reverb: [1.5, 1.8],
    delayBeats: [0.75],
    delayFeedback: [0.45, 0.58],
    delayWet: [0.45, 0.65],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0, push: 0.025, rit: 0.3 },
    record: { size: 1.1, early: 0.6, hiss: -66, warmth: 0.4, width: 0.6 },
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

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
    P(3, 5, 6, 0),
    P(0, 4, 5, 3),
  ],
  dorian: [P(0, 3, 0, 3), P(0, 1, 2, 3), P(0, 6, 3, 0), P(0, 4, 3, 0), P(0, 2, 3, 0), P(0, 3, 6, 3), P(3, 2, 1, 0)],
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
    P(0, 2, 5, 3),
  ],
  lydian: [P(0, 1, 0, 1), P(0, 1, 5, 0), P(0, 6, 1, 0), P(0, 1, 2, 1), P(0, 2, 1, 5)],
  mixolydian: [P(0, 6, 3, 0), P(0, 4, 6, 3), P(0, 6, 0, 3), P(3, 6, 0, 0), P(0, 3, 6, 4)],
};
