import type { Mood, Motion } from './moods.ts';
import type { ChordSpec, Key } from './theory.ts';

export type StyleId = 'drift' | 'haze' | 'pulse' | 'rise' | 'cathedral' | 'acid' | 'garden' | 'nocturne' | 'ember';

export type Role =
  | 'intro'
  | 'verse'
  | 'prechorus'
  | 'chorus'
  | 'bridge'
  | 'build'
  | 'drop'
  | 'break'
  | 'solo'
  | 'rest'
  | 'outro';

/** How a movement hands over to the next one. */
export type Transition = 'fade' | 'swell' | 'stop' | 'pause';

/**
 * The story a movement's loudness and fullness tell (see arcs.ts): `climb`, quiet to a peak near the end; `early`,
 * a peak near the middle and an afterglow; `plateau`, up soon and held, with no single climax; `cold`, opening on
 * its big part; `dissolve`, starting full and letting go; `lastWord`, ending on its peak with no outro.
 */
export type Arc = 'climb' | 'early' | 'plateau' | 'cold' | 'dissolve' | 'lastWord';

/**
 * A movement's harmonic language: `loop`, its style's progressions; `pedal`, the bass holding the tonic under them
 * (the fifth under a build); `lament`, a bass walking down by step; `vamp`, the mode's own one or two chords;
 * `colour`, one chord from outside the mode as its signature.
 */
export type Harmony = 'loop' | 'pedal' | 'lament' | 'vamp' | 'colour';

/**
 * What a movement's tune is: `song`, a hook built round one climax (the style's own); `lament`, lines that fall from
 * a high note; `riff`, a figure restated as the chords move under it; `recitation`, a reciting tone and its
 * neighbours, the interest in the rhythm; `fanfare`, a call of fourths, fifths and octaves; `none`, no tune at all
 * (the band and its colour are the piece).
 */
export type Tune = 'song' | 'lament' | 'riff' | 'recitation' | 'fanfare' | 'none';

/**
 * The one moment a movement is remembered by (see surprises.ts): `keyJump`, its last choruses up a major third;
 * `subito`, a returning chorus suddenly hushed before the last; `alone`, a verse or bridge left to the tune over
 * the bed; `pause`, the band stopping for a bar in a chorus; `halfTime`, its peak's drums in half time.
 */
export type Surprise = 'keyJump' | 'subito' | 'alone' | 'pause' | 'halfTime';

/** The room a movement is recorded in: close and dry (under a second), a room, a hall, a cathedral (six seconds). */
export type Space = 'close' | 'room' | 'hall' | 'cathedral';

/**
 * How fully a section is played, beyond its role: `hushed`, without the rhythm section (drums, bass, risers, the
 * overdriven wall); `bare`, only the tune over its sustained bed. Absent, the full band.
 */
export type Treatment = 'hushed' | 'bare';

/**
 * A movement's time: four beats, a waltz's three, or two lilting beats of three eighths each. Both triple times
 * have twelve 16ths in a bar; the movement's bpm counts quarter notes in all three.
 */
export type Meter = '4/4' | '3/4' | '6/8';

/** 16ths in a bar of `meter`. */
export const stepsPerBar = (meter: Meter): 12 | 16 => (meter === '4/4' ? 16 : 12);

export interface SectionDef {
  role: Role;
  bars: number;
  /** 0..1, drives arrangement density and the loudness target. */
  energy: number;
  /** Semitones above the movement's key: the lifted final choruses. */
  shift: number;
  treatment?: Treatment;
  /** A surprise played inside the section: the band stopping for a bar, or its drums in half time. */
  surprise?: 'pause' | 'halfTime';
  /** How long the bars last as the band plays them (see tempo.ts): what the section's clock makes of them. */
  seconds: number;
}

/** Per-movement timbre variation, so two seeds in the same style still sound like different records. */
export interface Tone {
  bright: number; // filter cutoffs, ~0.75..1.3
  detune: number; // supersaw spread, ~0.7..1.4
  fmRatio: number; // bell modulator ratio
  vibrato: number; // lead vibrato depth multiplier
  crackle: number; // vinyl texture, 0 = none
  wow: number; // tape-style pitch drift, 0 = none
}

export interface Mix {
  room: number; // reverb feedback 0..1
  reverb: number; // reverb return gain
  delayBeats: number; // echo time in beats
  delayFeedback: number;
  delayWet: number;
  peak: number; // LUFS of the movement's loudest part
  range: number; // LU from its quietest part to its loudest
  drums: number; // LU of the drums against the bed (chords and textures)
  bass: number; // LU of the bass against the bed
  size: number; // the room's early reflections: time scale (1 = a mid-sized room)
  early: number; // their level against the reverb send
  hiss: number | null; // noise floor, dBFS; null for none
  warmth: number; // console and tape drive, 0 = clean
  width: number; // side-to-mid ratio the bed is opened up to
  amp: AmpTone; // how the amp drives an overdriven guitar
  /** The echo: a clean digital ping-pong, or a tape echo whose repeats sway, darken and saturate as they go round. */
  echo?: 'tape';
  /** The room: the plain reverb, or a modulated hall (its decay from `room` all the same). */
  hall?: boolean;
  /** Share of the hall's tail fed back an octave up (0 or absent: none). */
  shimmer?: number;
  /**
   * How it is mixed and mastered: absent, the gentle glue of the rest; 'rock', a rock record's buses (a compressed drum
   * bus with a crushed copy under it, the band glued by a bus compressor, printed to tape, a loud master).
   */
  bus?: 'rock';
}

/** An amp's voice: a crunchy rock amp, or a Big Muff into a big amp and a 4x12 (post-rock's wall). */
export type AmpTone = 'crunch' | 'fuzz';

export interface Movement {
  index: number;
  seed: number;
  title: string;
  style: StyleId;
  key: Key;
  bpm: number;
  meter: Meter;
  swing: number; // 0 = straight; delays every other 16th by this fraction of a 16th
  sections: SectionDef[];
  /** Global index of this movement's first section. */
  firstSection: number;
  /** Seconds from the start of the song. */
  startTime: number;
  duration: number;
  progressions: Record<'main' | 'lift' | 'alt' | 'bridge', ChordSpec[]>;
  /** Bars each chord of a progression lasts. */
  barsPerChord: 1 | 2;
  tone: Tone;
  mix: Mix;
  transition: Transition;
  arc: Arc;
  /** The feeling it is written in and how busy its accompaniment is (see moods.ts). */
  mood: Mood;
  motion: Motion;
  harmony: Harmony;
  /** Whether it comes home at its end, to the tonic, or ends open, on a chord that doesn't resolve. */
  ending: 'home' | 'open';
  tune: Tune;
  space: Space;
  /** Whether its chords are held under it by a bed (pads), or left to the band to imply. */
  texture: 'bed' | 'bare';
  surprise: Surprise | null;
}

// ------------------------------------------------------------------ score events
// Times are seconds from the start of the section. Pitches are MIDI numbers.

// `acoustic` kinds are a real kit recorded in a room, fitted to recordings (see synth/instruments.ts). They are
// played: give their hits a `take`, or every stroke is the full-force one, only quieter.
export type KickKind = 'soft' | 'big' | 'drop' | 'dusty' | 'punch' | 'acoustic';
export type SnareKind = 'roll' | 'big' | 'huge' | 'clap' | 'dusty' | 'gated' | 'rim' | 'acoustic';
/** A tom without a kind is the synth tom. */
export type TomKind = 'acoustic';
export type HatKind = 'closed' | 'open' | 'shaker' | 'dusty';
/**
 * Synth basses, and two bass guitars (a string model fitted to recorded basses, see synth/strings.ts): `pick`, a
 * Precision played with a pick into a driven Ampeg-style amp and a DI (post-rock's and rock's bass: a click on every
 * note, the frets buzzing when it is dug in, the amp's growl), and `finger`, the same bass fingered, rounder and
 * cleaner. For the guitars `v` is how hard the string is played (brightness, buzz, drive, not only level), `d` how
 * long the fretting hand holds the note (then it mutes the string) and `rel` how long the muted string takes to die
 * (default 0.1 s: a longer one lets the last note ring out).
 */
export type BassKind = 'heart' | 'sub' | 'saw' | 'roll' | 'round' | 'pulse' | '808' | 'pick' | 'finger';
export type PadKind = 'warm' | 'wide' | 'drop' | 'stab' | 'bloom' | 'glass' | 'strings';
export type LeadKind = 'hook' | 'hook2' | 'brass' | 'flute' | 'saw';
export type ImpactKind = 'ping' | 'hit' | 'soft' | 'drop' | 'cosmic' | 'final';
export type RiseKind = 'swell' | 'sweep' | 'build' | 'cymbal';
/**
 * `clean` is post-rock's clean electric: a warm neck pickup played into long delays and a big reverb. `overdrive`
 * goes through the amp (see Mix.amp).
 */
export type StringKind = 'guitar' | 'harp' | 'electric' | 'clean' | 'overdrive';
/** Breath-driven solo voices: two instruments and a hummed voice. */
export type WindKind = 'flute' | 'sax' | 'hum';
export type MalletKind = 'marimba' | 'vibes' | 'kalimba';
/** `acousticRide` and `acousticCrash` are the acoustic kit's cymbals. */
export type PercKind =
  | 'conga'
  | 'congaHi'
  | 'bongo'
  | 'cowbell'
  | 'ride'
  | 'crash'
  | 'snap'
  | 'acousticRide'
  | 'acousticCrash';
/** Sung vowels for the choir; 'm' is a closed-mouth hum. */
export type Vowel = 'a' | 'o' | 'u' | 'm';

/** A note of an acid line: accents hit harder and open the filter, slides glide into the next note. */
export interface AcidNote extends Note {
  accent: boolean;
  slide: boolean;
}

export interface Note {
  t: number;
  d: number;
  n: number;
  v: number;
}

/** How many takes of each stroke a drummer's kit has (see `take`). */
export const TAKES = 4;

/**
 * `lead` marks the section's melody, which the mix sets on top of everything else. `take` marks a drum hit
 * played by a person: which of the stroke's takes sounds (0 to TAKES - 1). A machine's hits have none and all
 * sound alike.
 */
export type Ev =
  | { i: 'kick'; t: number; v: number; k: KickKind; sc: number; n: number; take?: number }
  | { i: 'snare'; t: number; v: number; k: SnareKind; take?: number }
  | { i: 'tom'; t: number; v: number; n: number; k?: TomKind; take?: number }
  | { i: 'hat'; t: number; v: number; k: HatKind; p?: number; take?: number }
  | { i: 'bass'; t: number; d: number; n: number; v: number; k: BassKind; rel?: number }
  | { i: 'pad'; t: number; d: number; n: number[]; k: PadKind; cut: [number, number]; g?: number; rel?: number }
  | { i: 'keys'; t: number; d: number; n: number[]; v: number }
  | { i: 'pluck'; t: number; n: number; v: number; cut: number; p: number; dec?: number }
  | { i: 'lead'; t: number; k: LeadKind; ns: Note[]; oct?: number; lead?: boolean }
  | { i: 'bell'; t: number; n: number[]; v: number; lead?: boolean }
  | { i: 'organ'; t: number; d: number; n: number; att: number; rel?: number; g?: number; swell?: number }
  | { i: 'impact'; t: number; k: ImpactKind; a: number; n?: number[] }
  /** x0..x1: the part of the riser's arc this event plays (a build of several sections splits one riser). */
  | { i: 'rise'; t: number; d: number; k: RiseKind; n?: number[]; x0?: number; x1?: number }
  | { i: 'drone'; t: number; d: number; n: number }
  | { i: 'vinyl'; t: number; d: number }
  | { i: 'breath'; t: number; d: number }
  | { i: 'sweep'; t: number; d: number; x0?: number; x1?: number }
  | { i: 'stop'; t: number; d: number }
  /**
   * A plucked note. The fretting hand's techniques: `slur`, hammered on or pulled off from the note before
   * rather than picked (with a `slide`, slid to from it along the still ringing string); `slide`, slid or bent into
   * from this many semitones away, over `glide` seconds (absent, a quick slide along the frets: 0.04 s and 0.03 s
   * more a semitone; a bend or a bottleneck takes longer); `squeak`, how loud the hand squeaks
   * along a wound string as it shifts to the note (0 to 1); `swell`, seconds a note takes to swell in with no
   * attack at all (a volume pedal, an EBow).
   *
   * `vib`: how wide the fretting finger's vibrato is on a note held for `d` seconds, as a multiple of the player's
   * usual (on an electric a sine of about ±22 cents, ±13 on the acoustic `guitar`, varying note to note; never on the
   * harp; it comes in 0.1 to 0.3 s after the pick, at 4.5 to 5.9 Hz or about `vibRate`, and widens as the note is
   * held): 0 for none, 1 the usual, 2 wide. Absent, a held note of a line (`lead` set, true or false, `d` at least
   * `VIB_HELD` s, not a `swell`) gets 1, and a chord's or an arpeggio's note (no `lead`) none.
   * `feedback`: on a held `overdrive` note, how loud the amp's feedback blooms: one of the string's harmonics (between
   * 320 and 900 Hz) swells in over one to two seconds from about half a second after the pick and sings over the
   * chord until the note stops (0 none, 1 the usual, 2 it takes the note over). Absent, the first note of 2 s or more
   * that finds its amp (its guitarist) not already feeding back blooms, six times in ten.
   */
  | {
    i: 'string';
    t: number;
    n: number;
    v: number;
    k: StringKind;
    d?: number;
    p?: number;
    lead?: boolean;
    slur?: boolean;
    slide?: number;
    glide?: number;
    squeak?: number;
    swell?: number;
    vib?: number;
    vibRate?: number;
    feedback?: number;
  }
  | { i: 'mallet'; t: number; n: number; v: number; k: MalletKind; p?: number; lead?: boolean }
  /** `pedal`: the sustain pedal is down while it sounds, so the undamped strings answer it. */
  | { i: 'piano'; t: number; d: number; n: number[]; v: number; strum?: number; lead?: boolean; pedal?: boolean }
  | { i: 'choir'; t: number; d: number; n: number[]; vowel: Vowel; g?: number }
  | { i: 'wind'; t: number; k: WindKind; ns: Note[]; lead?: boolean }
  | { i: 'acid'; t: number; ns: AcidNote[]; cut: [number, number]; res: number; env: number; square?: boolean }
  | { i: 'perc'; t: number; v: number; k: PercKind; n?: number; p?: number; take?: number }
  /** Silence: every dry part and send stops for d seconds; with `room` false the reverb stops too. */
  | { i: 'gap'; t: number; d: number; room: boolean };

export const isMelody = (e: Ev): boolean => 'lead' in e && e.lead === true;

/** A plucked note held this long (s) in a line is sung: the fretting finger's vibrato comes in. */
export const VIB_HELD = 0.35;

export type Instrument = Ev['i'];

export interface ChordSpan {
  t: number;
  d: number;
  name: string;
  pcs: number[];
  /** The pitch class the bass plays: the root, or a slash chord's or a pedal's bass. */
  bass: number;
}

export interface Score {
  /** Global section index. */
  index: number;
  movement: Movement;
  section: SectionDef;
  /** Local index of the section inside its movement. */
  local: number;
  /** Seconds from the start of the movement. */
  offset: number;
  duration: number;
  /** Audio rendered past `duration` for reverb and echo tails; overlaps the next section. */
  tail: number;
  bpm: number;
  /** Seconds from the section start of each bar line, the end included: the tempo may move (see tempo.ts). */
  bars: number[];
  events: Ev[];
  chords: ChordSpan[];
  /** Seeds the synth's noise, so the audio of a section is as reproducible as its notes. */
  noiseSeed: number;
}
