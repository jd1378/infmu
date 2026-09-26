import type { Mood, Motion } from './moods.ts';
import type { ModeName } from './theory.ts';
import type {
  AmpTone,
  Arc,
  Conceit,
  Harmony,
  Meter,
  Role,
  Space,
  StyleId,
  Surprise,
  Transition,
  Tune,
} from './types.ts';

type Weighted<T> = readonly (readonly [T, number])[];
type Range = readonly [number, number];

export interface StyleDef {
  id: StyleId;
  name: string;
  genre: string;
  bpm: Range;
  /** The times a piece of the style may be in (see Meter): most are in four, some sway in three. */
  meters: Weighted<Meter>;
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
  /** Chance a bridge goes away to the subdominant's key (and the piece comes home after it). */
  away: number;
  next: Weighted<StyleId>;
  transitions: Weighted<Transition>;
  /** The arcs a piece of the style may tell (see Arc), equally likely. */
  arcs: readonly Arc[];
  /** The moods its pieces may be in (see moods.ts), equally likely among those its modes can carry. */
  moods: readonly Mood[];
  /** How busy its accompaniment may be; a dance style always drives. */
  motions: readonly Motion[];
  /** The harmonic languages it speaks (see Harmony), as its pieces' moods lean. */
  languages: readonly Harmony[];
  /** The tunes its pieces may have (see Tune), as their moods lean. */
  tunes: readonly Tune[];
  /** The rooms it is recorded in (see Space), closest first. */
  spaces: readonly Space[];
  /** The chance a piece leaves its chords to the band, with no pad bed under them (0: always a bed). */
  bare: number;
  /** The surprises its pieces may have (see Surprise), as their moods fit. */
  surprises: readonly Surprise[];
  /** The big ideas its pieces may be built on (see Conceit); none always may. */
  conceits: readonly Conceit[];
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
   * pair wider still); `amp` how an overdriven guitar's amp drives; `echo`, `hall` and `shimmer` the effects a guitar
   * rig brings; `bus` how it is mixed and mastered (see Mix).
   */
  record: {
    size: number;
    early: number;
    hiss: number | null;
    warmth: number;
    width: number;
    amp: AmpTone;
    echo?: 'tape';
    hall?: boolean;
    shimmer?: number;
    bus?: 'rock';
  };
  /**
   * How much longer than the listener's chosen length its pieces run: post-rock needs the time for its long
   * crescendos (1 for the rest).
   */
  stretch?: number;
  /** A piece that runs short grows its parts instead of going round again (post-rock's long waves). */
  grow?: boolean;
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
    meters: [['4/4', 5], ['3/4', 2], ['6/8', 2]],
    swing: [0, 0],
    modes: [['lydian', 3], ['ionian', 2], ['dorian', 2], ['aeolian', 1], ['mixolydian', 1]],
    forms: [
      'intro:4 verse:8 chorus:8 break:8 verse:8? chorus:8 bridge:8 chorus:8? outro:8',
      'intro:8 verse:8 verse:8? chorus:8 solo:8 bridge:8 chorus:8 chorus:8? outro:8',
      'intro:8 verse:8 verse:8 chorus:8 chorus:8 chorus:12? outro:8',
      'intro:6 verse:8 verse:8 bridge:8 bridge:8? verse:8 chorus:8 outro:8',
    ],
    dynamics: [-16, 12],
    balance: [-7, -4],
    chordSize: [[3, 2], [4, 3], [5, 1]],
    sus2: 0.3,
    barsPerChord: 2,
    lift: 0,
    away: 0.3,
    next: [['drift', 1], ['haze', 3], ['nocturne', 3], ['cathedral', 2], ['garden', 2], ['pulse', 1]],
    transitions: [['pause', 3], ['fade', 3], ['swell', 2]],
    arcs: ['climb', 'early', 'plateau', 'dissolve'],
    moods: ['wonder', 'transcendence', 'tenderness', 'nostalgia', 'peace', 'grief'],
    motions: ['still', 'flowing'],
    languages: ['loop', 'pedal', 'lament', 'vamp', 'colour'],
    tunes: ['song', 'lament', 'recitation', 'none', 'longLine'],
    spaces: ['hall', 'cathedral'],
    bare: 0,
    surprises: ['alone', 'keyJump'],
    conceits: ['phase'],
    reverb: [1.7, 2.1],
    delayBeats: [1.5, 0.75, 1],
    delayFeedback: [0.45, 0.6],
    delayWet: [0.5, 0.7],
    crackle: [0, 0],
    wow: [0, 0.4],
    tempo: { rubato: 0.04, push: 0, rit: 0.3 },
    record: { size: 1.3, early: 0.5, hiss: -72, warmth: 0, width: 0.6, amp: 'crunch' },
  },
  haze: {
    id: 'haze',
    name: 'Haze',
    genre: 'lo-fi',
    bpm: [72, 88],
    meters: [['4/4', 1]],
    swing: [0.12, 0.26],
    modes: [['dorian', 3], ['ionian', 2], ['aeolian', 2], ['mixolydian', 1]],
    forms: [
      'intro:4 verse:8 chorus:8 verse:8 prechorus:4? chorus:8 solo:8 bridge:8? chorus:8 chorus:8? outro:4',
      'intro:4 verse:8 verse:8? chorus:8 break:4 verse:8 chorus:8 solo:8? chorus:8 outro:8',
      'intro:4 verse:12 chorus:8 verse:12 chorus:8 solo:8? chorus:8 outro:4',
      'intro:8 verse:8 verse:8 bridge:8 verse:8 chorus:8 solo:8 chorus:12 outro:2',
    ],
    dynamics: [-13, 8],
    balance: [-2, -3],
    chordSize: [[4, 3], [5, 2]],
    sus2: 0,
    barsPerChord: 1,
    lift: 0.3,
    away: 0.25,
    next: [['haze', 1], ['drift', 3], ['garden', 3], ['nocturne', 2], ['pulse', 2], ['acid', 1]],
    transitions: [['pause', 3], ['fade', 3], ['stop', 2]],
    arcs: ['climb', 'early', 'plateau', 'cold'],
    moods: ['wonder', 'tenderness', 'nostalgia', 'peace', 'joy', 'grief'],
    motions: ['flowing', 'driving'],
    languages: ['loop', 'pedal', 'lament', 'vamp', 'colour'],
    tunes: ['song', 'lament', 'riff', 'recitation'],
    spaces: ['close', 'room'],
    bare: 0.35,
    surprises: ['subito', 'alone', 'halfTime', 'keyJump'],
    conceits: ['ostinato'],
    reverb: [1.1, 1.4],
    delayBeats: [0.75, 1.5],
    delayFeedback: [0.3, 0.45],
    delayWet: [0.25, 0.4],
    crackle: [0.5, 1],
    wow: [0.6, 1],
    tempo: { rubato: 0, push: 0, rit: 0 },
    record: { size: 0.6, early: 0.7, hiss: -60, warmth: 0.5, width: 0.6, amp: 'crunch' },
  },
  pulse: {
    id: 'pulse',
    name: 'Pulse',
    genre: 'synthwave',
    bpm: [96, 112],
    meters: [['4/4', 1]],
    swing: [0, 0],
    modes: [['aeolian', 4], ['dorian', 2], ['mixolydian', 1], ['ionian', 1]],
    forms: [
      'intro:8 verse:8 prechorus:4 chorus:8 verse:8 prechorus:4 chorus:8 solo:8 bridge:8 chorus:8 chorus:8? outro:8',
      'intro:8 verse:8 chorus:8 break:8 verse:8 chorus:8 solo:8? bridge:8 chorus:8 chorus:8? outro:4',
      'intro:4 verse:8 prechorus:4 chorus:8 bridge:8 verse:8 prechorus:4 chorus:8 solo:8? chorus:12 outro:4',
      'intro:8 verse:8 verse:8 prechorus:4 chorus:8 break:4 chorus:8 solo:8 bridge:8? chorus:8 outro:8',
    ],
    dynamics: [-11, 10],
    balance: [-3, -3],
    chordSize: [[3, 4], [4, 1]],
    sus2: 0.1,
    barsPerChord: 1,
    lift: 0.45,
    away: 0.3,
    next: [['pulse', 1], ['rise', 3], ['ember', 2], ['haze', 2], ['cathedral', 2], ['acid', 1]],
    transitions: [['pause', 3], ['fade', 2], ['swell', 2], ['stop', 1]],
    arcs: ['climb', 'early', 'plateau', 'cold', 'lastWord'],
    moods: ['wonder', 'tenderness', 'nostalgia', 'joy', 'power', 'unease', 'grief'],
    motions: ['flowing', 'driving'],
    languages: ['loop', 'pedal', 'lament', 'vamp', 'colour'],
    tunes: ['song', 'lament', 'riff', 'recitation', 'fanfare'],
    spaces: ['room', 'hall'],
    bare: 0.3,
    surprises: ['keyJump', 'subito', 'pause', 'halfTime', 'alone'],
    conceits: ['ostinato'],
    reverb: [1.4, 1.7],
    delayBeats: [0.75],
    delayFeedback: [0.4, 0.5],
    delayWet: [0.4, 0.55],
    crackle: [0, 0],
    wow: [0, 0.2],
    tempo: { rubato: 0, push: 0, rit: 0 },
    record: { size: 0.9, early: 0.3, hiss: null, warmth: 0.2, width: 0.6, amp: 'crunch' },
  },
  rise: {
    id: 'rise',
    name: 'Rise',
    genre: 'trance',
    bpm: [120, 128],
    meters: [['4/4', 1]],
    swing: [0, 0],
    modes: [['aeolian', 5], ['dorian', 1], ['phrygian', 1]],
    forms: [
      'intro:8 intro:8? verse:8 build:8 drop:8 drop:8 break:8 break:8? build:8 drop:8 drop:8 outro:8 outro:8?',
      'intro:8 verse:8 verse:8? build:4 drop:8 drop:8 break:8 bridge:8? build:8 drop:8 drop:8 outro:8',
      'intro:8 build:8 drop:8 break:8 bridge:8? build:8 drop:8 drop:8 outro:8',
      'intro:8 verse:8 build:4 drop:8 break:8 build:8 drop:12 outro:8',
    ],
    dynamics: [-10, 12],
    balance: [-2, -2],
    chordSize: [[3, 1]],
    sus2: 0,
    barsPerChord: 1,
    lift: 0.25,
    away: 0,
    next: [['rise', 1], ['acid', 3], ['pulse', 3], ['cathedral', 2], ['ember', 2], ['drift', 1]],
    transitions: [['swell', 3], ['pause', 2], ['stop', 2]],
    arcs: ['climb', 'plateau', 'cold', 'lastWord'],
    moods: ['wonder', 'transcendence', 'nostalgia', 'joy', 'power', 'unease', 'grief'],
    motions: ['driving'],
    languages: ['loop', 'pedal', 'vamp'],
    tunes: ['song', 'fanfare'],
    spaces: ['room', 'hall'],
    bare: 0,
    surprises: ['keyJump', 'subito', 'pause', 'halfTime'],
    conceits: [],
    reverb: [1.5, 1.7],
    delayBeats: [0.75],
    delayFeedback: [0.38, 0.46],
    delayWet: [0.45, 0.6],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0, push: 0, rit: 0 },
    record: { size: 1.0, early: 0.25, hiss: null, warmth: 0, width: 0.6, amp: 'crunch' },
  },
  cathedral: {
    id: 'cathedral',
    name: 'Cathedral',
    genre: 'cinematic',
    bpm: [68, 82],
    meters: [['4/4', 5], ['3/4', 2], ['6/8', 2]],
    swing: [0, 0],
    modes: [['aeolian', 3], ['harmonic', 2], ['dorian', 1]],
    forms: [
      'intro:4 verse:8 chorus:8 break:4 verse:8? chorus:8 bridge:8 build:4 drop:8 drop:8? outro:8',
      'intro:8 verse:8 chorus:8 bridge:8 break:4? build:4 drop:8 drop:8 outro:8',
      'intro:8 verse:8 verse:8 build:8 chorus:8 build:4 drop:8 drop:12? outro:8',
      'intro:6 verse:8 chorus:8 bridge:8 bridge:8? verse:8 chorus:8 drop:8 outro:6',
    ],
    dynamics: [-10, 18],
    balance: [-4, -4],
    chordSize: [[3, 1]],
    sus2: 0,
    barsPerChord: 1,
    lift: 0.3,
    away: 0.35,
    next: [['cathedral', 1], ['nocturne', 3], ['drift', 2], ['ember', 2], ['rise', 2]],
    transitions: [['pause', 2], ['fade', 2], ['swell', 3]],
    arcs: ['climb', 'early', 'dissolve', 'lastWord'],
    moods: ['wonder', 'transcendence', 'tenderness', 'nostalgia', 'peace', 'power', 'unease', 'grief'],
    motions: ['still', 'flowing', 'driving'],
    languages: ['loop', 'pedal', 'lament', 'vamp', 'colour'],
    tunes: ['song', 'lament', 'fanfare', 'longLine'],
    spaces: ['hall', 'cathedral'],
    bare: 0,
    surprises: ['keyJump', 'subito', 'pause', 'halfTime', 'alone'],
    conceits: ['ostinato', 'phase'],
    reverb: [1.7, 2],
    delayBeats: [0.75, 1.5],
    delayFeedback: [0.3, 0.4],
    delayWet: [0.2, 0.35],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0.05, push: 0.015, rit: 0.4 },
    record: { size: 1.6, early: 0.6, hiss: -70, warmth: 0, width: 0.8, amp: 'crunch' },
  },
  acid: {
    id: 'acid',
    name: 'Acid',
    genre: 'acid house',
    bpm: [122, 128],
    meters: [['4/4', 1]],
    swing: [0, 0.08],
    modes: [['aeolian', 3], ['phrygian', 2], ['dorian', 2]],
    forms: [
      'intro:8 verse:8 verse:8 build:8 drop:8 drop:8 break:8 build:4 drop:8 drop:8 drop:8? outro:8 outro:4?',
      'intro:8 intro:8? verse:8 build:4 drop:8 drop:8 solo:8 break:8 build:8 drop:8 drop:8 outro:8',
      'intro:8 verse:8 drop:8 break:8 build:8 drop:8 drop:8 solo:8? outro:8',
      'intro:8 intro:8? build:8 drop:8 solo:8 break:8 build:4 drop:12 outro:8',
    ],
    dynamics: [-10, 10],
    balance: [-2, -2],
    chordSize: [[3, 2], [4, 1]],
    sus2: 0,
    barsPerChord: 2,
    lift: 0,
    away: 0,
    next: [['acid', 1], ['rise', 3], ['pulse', 2], ['haze', 1], ['ember', 1]],
    transitions: [['stop', 2], ['pause', 2], ['swell', 1]],
    arcs: ['climb', 'plateau', 'cold', 'lastWord'],
    moods: ['transcendence', 'nostalgia', 'joy', 'power', 'unease'],
    motions: ['driving'],
    languages: ['loop', 'pedal', 'vamp'],
    tunes: ['song'],
    spaces: ['close', 'room'],
    bare: 0,
    surprises: ['subito', 'pause', 'halfTime'],
    conceits: [],
    reverb: [1.2, 1.5],
    delayBeats: [0.75, 0.5],
    delayFeedback: [0.35, 0.5],
    delayWet: [0.3, 0.45],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0, push: 0, rit: 0 },
    record: { size: 0.8, early: 0.25, hiss: null, warmth: 0.2, width: 0.6, amp: 'crunch' },
  },
  garden: {
    id: 'garden',
    name: 'Garden',
    genre: 'organic downtempo',
    bpm: [88, 104],
    meters: [['4/4', 6], ['6/8', 3]],
    swing: [0.06, 0.18],
    modes: [['dorian', 3], ['mixolydian', 2], ['ionian', 2], ['lydian', 1]],
    forms: [
      'intro:8 verse:8 chorus:8 verse:8 chorus:8 solo:8 break:8? bridge:8 chorus:8 chorus:8? outro:8',
      'intro:4 verse:8 verse:8? prechorus:4 chorus:8 break:8 solo:8 chorus:8 bridge:8? chorus:8 outro:8',
      'intro:6 verse:8 chorus:8 solo:8 verse:8 chorus:8 break:8? chorus:12 outro:4',
      'intro:4 verse:8 verse:8 bridge:8 verse:8 chorus:8 chorus:8? outro:8',
    ],
    dynamics: [-13, 9],
    balance: [-4, -4],
    chordSize: [[3, 2], [4, 2]],
    sus2: 0.2,
    barsPerChord: 1,
    lift: 0.2,
    away: 0.3,
    next: [['garden', 1], ['haze', 3], ['drift', 3], ['nocturne', 1], ['pulse', 1]],
    transitions: [['pause', 3], ['fade', 3], ['swell', 1]],
    arcs: ['climb', 'early', 'plateau', 'cold'],
    moods: ['wonder', 'transcendence', 'tenderness', 'nostalgia', 'peace', 'joy', 'grief'],
    motions: ['flowing', 'driving'],
    languages: ['loop', 'pedal', 'lament', 'vamp', 'colour'],
    tunes: ['song', 'riff', 'recitation'],
    spaces: ['close', 'room', 'hall'],
    bare: 0.3,
    surprises: ['subito', 'alone', 'keyJump'],
    conceits: ['ostinato', 'phase'],
    reverb: [1.2, 1.5],
    delayBeats: [0.75, 1],
    delayFeedback: [0.3, 0.45],
    delayWet: [0.25, 0.4],
    crackle: [0, 0],
    wow: [0, 0.2],
    tempo: { rubato: 0, push: 0.012, rit: 0.25 },
    record: { size: 0.8, early: 0.6, hiss: -68, warmth: 0.3, width: 0.6, amp: 'crunch' },
  },
  nocturne: {
    id: 'nocturne',
    name: 'Nocturne',
    genre: 'piano',
    bpm: [60, 78],
    meters: [['4/4', 5], ['3/4', 3], ['6/8', 2]],
    swing: [0, 0],
    modes: [['aeolian', 3], ['ionian', 2], ['dorian', 2], ['lydian', 1]],
    forms: [
      'intro:4 verse:8 verse:8? chorus:8 break:4 verse:8 bridge:8 chorus:8 chorus:8? outro:8',
      'intro:4 verse:8 chorus:8 verse:8 solo:8? chorus:8 bridge:8 chorus:8 outro:8',
      'intro:4 verse:8 verse:8 bridge:8 bridge:8? verse:8 chorus:8 outro:6',
      'intro:2 verse:8 chorus:8 verse:8 chorus:12 bridge:8 verse:8 chorus:8? outro:4',
    ],
    dynamics: [-16, 14],
    balance: [-9, -5],
    chordSize: [[3, 2], [4, 2]],
    sus2: 0.15,
    barsPerChord: 1,
    lift: 0.35,
    away: 0.4,
    next: [['nocturne', 1], ['drift', 3], ['cathedral', 2], ['haze', 2], ['garden', 1]],
    transitions: [['pause', 4], ['fade', 3]],
    arcs: ['climb', 'early', 'dissolve'],
    moods: ['wonder', 'transcendence', 'tenderness', 'nostalgia', 'peace', 'joy', 'grief'],
    motions: ['still', 'flowing', 'driving'],
    languages: ['loop', 'pedal', 'lament', 'vamp', 'colour'],
    tunes: ['song', 'lament', 'recitation', 'longLine'],
    spaces: ['close', 'room', 'hall'],
    bare: 0,
    surprises: ['alone', 'keyJump', 'pause'],
    conceits: ['ostinato', 'phase'],
    reverb: [1.5, 1.8],
    delayBeats: [1.5, 1],
    delayFeedback: [0.2, 0.3],
    delayWet: [0.08, 0.15],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0.16, push: 0.01, rit: 0.4 },
    record: { size: 0.9, early: 0.6, hiss: -70, warmth: 0, width: 0.85, amp: 'crunch' },
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    genre: 'post-rock',
    bpm: [96, 124],
    // rarely a waltz: in three, a steady pulse under a major key is a carousel
    meters: [['4/4', 7], ['6/8', 2], ['3/4', 0.5]],
    swing: [0, 0],
    modes: [['aeolian', 4], ['ionian', 2], ['dorian', 2], ['lydian', 1]],
    // waves, as the references build them: a quiet theme, a long crescendo, a climax held for a long time, a sudden
    // drop to almost nothing, and a second, bigger wave
    forms: [
      'intro:8 verse:16 build:16 drop:16 break:8 verse:8? build:16 drop:16 drop:8? outro:8',
      'intro:8 verse:16 verse:8? build:16 build:16 drop:16 drop:16 outro:8',
      'intro:16 verse:16 build:8 chorus:16 break:16 build:16 drop:16 drop:8? outro:8',
      'intro:8 build:16 build:16 drop:16 break:8 build:8 drop:16 outro:4',
    ],
    // mastered as the loud records are (out/research/proposals/sound-master.md): its climaxes 4 to 5 LU over the other
    // styles' loudest, its quiet parts as quiet as ever
    dynamics: [-7, 21.5],
    // a bass guitar carries more of its loudness in the mids than a synth: set higher to weigh the same low end
    balance: [-3, 3],
    chordSize: [[3, 2], [5, 2]],
    sus2: 0.35,
    barsPerChord: 2,
    lift: 0,
    away: 0.2,
    next: [['ember', 1], ['cathedral', 3], ['drift', 2], ['pulse', 2], ['rise', 1]],
    transitions: [['pause', 3], ['fade', 2], ['swell', 2]],
    arcs: ['climb', 'early', 'lastWord'],
    moods: ['wonder', 'transcendence', 'tenderness', 'nostalgia', 'power', 'unease', 'grief'],
    motions: ['still', 'flowing'],
    languages: ['loop', 'pedal', 'lament', 'vamp', 'colour'],
    tunes: ['song', 'lament', 'recitation', 'fanfare', 'none', 'longLine'],
    spaces: ['hall', 'cathedral'],
    bare: 0.25,
    surprises: ['keyJump', 'subito', 'pause', 'halfTime', 'alone'],
    conceits: ['ostinato'],
    reverb: [1.8, 2.2],
    delayBeats: [0.75],
    delayFeedback: [0.55, 0.65],
    delayWet: [0.5, 0.7],
    crackle: [0, 0],
    wow: [0, 0],
    tempo: { rubato: 0, push: 0.025, rit: 0.3 },
    record: {
      size: 1.1,
      early: 0.6,
      hiss: -72,
      warmth: 0.4,
      width: 0.65,
      amp: 'fuzz',
      echo: 'tape',
      hall: true,
      bus: 'rock',
    },
    stretch: 1.6,
    grow: true,
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

// ------------------------------------------------------------------ progressions
// Chord roots as mode degrees (0 = tonic). `alt` makes a chord tone chromatic (index 1 = third), e.g. the
// major V of a minor key. Families are grouped by the mode's character.

export interface ProgChord {
  deg: number;
  alt?: readonly number[];
  /** Semitones the whole chord moves: a chord borrowed from outside the mode (see ChordSpec). */
  shift?: number;
  /** Semitones above the tonic the bass plays, when not the root (see ChordSpec). */
  bass?: number;
}

const P = (...degs: (number | ProgChord)[]): ProgChord[] => degs.map((d) => (typeof d === 'number' ? { deg: d } : d));
// in minor: the major V (harmonic minor's) and the major IV (dorian's, borrowed)
const MAJOR_V: ProgChord = { deg: 4, alt: [0, 1] };
const MAJOR_IV: ProgChord = { deg: 3, alt: [0, 1] };
// in major: the minor iv, and the tonic chord a whole step and a major third down (bVII, bVI), borrowed from minor
const MINOR_IV: ProgChord = { deg: 3, alt: [0, -1] };
const FLAT_VII: ProgChord = { deg: 0, shift: -2 };
const FLAT_VI: ProgChord = { deg: 0, shift: -4 };
// secondary dominants in major: the chords that lead to V and to vi
const V_OF_V: ProgChord = { deg: 1, alt: [0, 1] };
const V_OF_VI: ProgChord = { deg: 2, alt: [0, 1] };

/**
 * Progressions per mode: four-chord loops, and eight-chord phrases that move somewhere and cadence (a pass of
 * those is a whole section at a chord a bar).
 */
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
    // Andalusian: down by step to the major V
    P(0, 6, 5, MAJOR_V),
    P(0, 6, MAJOR_IV, 0),
    P(0, 5, 2, 6, 0, 5, 3, MAJOR_V),
    // round the circle of fifths and home
    P(0, 3, 6, 2, 5, 1, MAJOR_V, 0),
    P(0, 2, 6, 3, 0, 5, 6, MAJOR_V),
  ],
  dorian: [
    P(0, 3, 0, 3),
    P(0, 1, 2, 3),
    P(0, 6, 3, 0),
    P(0, 4, 3, 0),
    P(0, 2, 3, 0),
    P(0, 3, 6, 3),
    P(3, 2, 1, 0),
    P(0, 3, 0, 3, 6, 2, 3, 4),
    P(0, 6, 5, 3, 0, 6, 3, 3),
  ],
  phrygian: [P(0, 1, 0, 1), P(0, 1, 2, 1), P(0, 5, 6, 1), P(0, 2, 1, 0), P(0, 1, 2, 1, 0, 6, 5, 1)],
  harmonic: [P(0, 3, 4, 0), P(0, 5, 3, 4), P(0, 5, 1, 4), P(0, 3, 5, 4), P(0, 3, 6, 2, 5, 1, 4, 0)],
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
    P(0, FLAT_VII, 3, 0),
    P(0, 3, MINOR_IV, 0),
    // the bVI, bVII that lands home
    P(0, 3, FLAT_VI, FLAT_VII),
    P(0, 5, 3, 4, 0, 5, 1, 4),
    // a bass walking down: I, V, vi, iii, IV, I, IV, V
    P(0, 4, 5, 2, 3, 0, 3, 4),
    P(0, V_OF_VI, 5, 3, 0, 1, V_OF_V, 4),
    P(3, 4, 2, 5, 1, V_OF_V, 4, 4),
  ],
  lydian: [P(0, 1, 0, 1), P(0, 1, 5, 0), P(0, 6, 1, 0), P(0, 1, 2, 1), P(0, 2, 1, 5), P(0, 1, 0, 1, 5, 1, 2, 0)],
  mixolydian: [P(0, 6, 3, 0), P(0, 4, 6, 3), P(0, 6, 0, 3), P(3, 6, 0, 0), P(0, 3, 6, 4), P(0, 6, 3, 0, 0, 6, 3, 4)],
};

// ------------------------------------------------------------------ harmonic languages (see Harmony)

/**
 * Laments: the bass walks down by step, the chords over it (slash chords where the bass isn't the root). The minor
 * one falls from the tonic to the dominant (i, i/b7, VI, V: the descending tetrachord of centuries of laments), or
 * chromatically (the passus duriusculus: i, V/7, i/b7, IV/6, VI, V); the major one walks down an octave.
 */
export const LAMENTS: Partial<Record<ModeName, ProgChord[][]>> = {
  aeolian: [
    P(0, { deg: 0, bass: 10 }, 5, MAJOR_V),
    P(0, { ...MAJOR_V, bass: 11 }, { deg: 0, bass: 10 }, { ...MAJOR_IV, bass: 9 }, 5, MAJOR_V, 0, MAJOR_V),
  ],
  harmonic: [
    P(0, { deg: 0, bass: 10 }, 5, 4),
    P(0, { deg: 4, bass: 11 }, { deg: 0, bass: 10 }, { ...MAJOR_IV, bass: 9 }, 5, 4, 0, 4),
  ],
  dorian: [P(0, { deg: 0, bass: 10 }, { deg: 3, bass: 9 }, 4)],
  ionian: [
    P(0, { deg: 4, bass: 11 }, 5, 3),
    P(0, { deg: 4, bass: 11 }, 5, { deg: 5, bass: 7 }, 3, { deg: 0, bass: 4 }, 1, 4),
  ],
};

/** Vamps: the mode's own two chords, two bars each (the Dorian i to IV, the Lydian I to II, the Phrygian i to bII). */
export const VAMPS: Record<ModeName, ProgChord[][]> = {
  aeolian: [P(0, 0, 5, 5), P(0, 0, 3, 3)],
  dorian: [P(0, 0, 3, 3)],
  phrygian: [P(0, 0, 1, 1)],
  harmonic: [P(0, 0, MAJOR_V, MAJOR_V)],
  ionian: [P(0, 0, 3, 3)],
  lydian: [P(0, 0, 1, 1)],
  mixolydian: [P(0, 0, 6, 6)],
};

/**
 * A colour: one chord from outside the mode that the piece keeps coming back to (the minor iv or the bVI in major,
 * the major IV in minor, the bVI in Dorian). The modal modes already have theirs (Lydian's II, Mixolydian's bVII).
 */
export const COLOURS: Partial<Record<ModeName, readonly ProgChord[]>> = {
  ionian: [MINOR_IV, FLAT_VI],
  aeolian: [MAJOR_IV],
  harmonic: [MAJOR_IV],
  dorian: [{ deg: 0, shift: -4, alt: [0, 1] }],
};

/** The chord an open ending stops on: the mode's plagal or deceptive colour, never home. */
export const OPEN_ENDS: Record<ModeName, ProgChord> = {
  ionian: { deg: 3 },
  lydian: { deg: 1 },
  mixolydian: { deg: 6 },
  dorian: { deg: 3 },
  aeolian: { deg: 5 },
  harmonic: { deg: 5 },
  phrygian: { deg: 1 },
};

/**
 * The rooms, as the reverb's decay (its feedback: 0.35 to 0.5 is under a second, 0.95 six seconds, measured by
 * out/research/novelty/rt60.ts), how loud its return is against the style's, how much of the echo is heard, and how
 * strong the early reflections are (a close room's walls are near).
 */
export const SPACES: Record<Space, { room: readonly [number, number]; reverb: number; echo: number; early: number }> = {
  close: { room: [0.35, 0.5], reverb: 0.6, echo: 0.5, early: 1.4 },
  room: { room: [0.65, 0.75], reverb: 0.85, echo: 0.8, early: 1.15 },
  hall: { room: [0.84, 0.9], reverb: 1, echo: 1, early: 1 },
  cathedral: { room: [0.93, 0.97], reverb: 1.15, echo: 1, early: 0.85 },
};
