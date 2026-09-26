// A piece's mood and motion: the feeling it is written in, chosen before its key and tempo so that every cue points
// the same way. Emotion in music is heard from cues that add up (Juslin's lens model; Eerola, Friberg and Bresin
// 2013: mode, tempo, register, articulation and brightness together explain most of it), so cues drawn one by one
// around a style's centre cancel out into the same mild pleasantness, piece after piece. A mood moves them together:
// the part of the style's tempo range, the modes, the tune's register, how long notes are held, how fast the chords
// change, how bright the sound is, how big the room is and how wide the dynamics. The moods are the nine of the
// Geneva Emotional Music Scale (Zentner, Grandjean and Scherer 2008), the feelings listeners report to music.
//
// Motion is how busy the accompaniment is: still (nothing faster than quarter notes, drums only at the peak),
// flowing (eighths, lighter drums) or driving (as the style writes it). Busyness is a feeling too: a bright,
// bouncing, busy texture reads as a carousel (the post-rock lesson), so only joy may bounce.

import type { ModeName } from './theory.ts';
import type { Harmony, Surprise, Tune } from './types.ts';

export type Mood =
  | 'wonder'
  | 'transcendence'
  | 'tenderness'
  | 'nostalgia'
  | 'peace'
  | 'joy'
  | 'power'
  | 'unease'
  | 'grief';

export type Motion = 'still' | 'flowing' | 'driving';

export interface MoodDef {
  /** Where the tempo falls in the style's range (0 its slowest, 1 its fastest). */
  tempo: readonly [number, number];
  /** How much the mood leans on each mode, times the style's own weight (absent: not at all). */
  modes: Partial<Record<ModeName, number>>;
  /** Scale degrees the tune sits above (or below) where the style puts it. */
  register: number;
  /** How much of its written length a short note is held, against the player's usual (above 1 more legato). */
  legato: number;
  /** The chords' pace: 'slow' leans to two bars a chord, 'quick' to one. */
  pace?: 'slow' | 'quick';
  /** The harmonic languages it leans on (see Harmony). */
  languages: Partial<Record<Harmony, number>>;
  /** The chance it ends open, on a chord that doesn't come home. */
  open: number;
  /** The tunes it leans on (see Tune). */
  tunes: Partial<Record<Tune, number>>;
  /** The surprises that fit it (see Surprise). */
  surprises: Partial<Record<Surprise, number>>;
  /** The tone's brightness (filter cutoffs), low to high. */
  bright: readonly [number, number];
  /** The room it leans to: above 1 the biggest the style allows, below 1 the closest. */
  space: number;
  /** LU added to the style's loudest level, and to its range from quietest to loudest. */
  dynamics: readonly [number, number];
  /** How busy its accompaniment likes to be. */
  motion: Partial<Record<Motion, number>>;
}

/** Starting points from the research (out/research/proposals/novelty-character.md, 12.2), to tune by ear. */
export const MOODS: Record<Mood, MoodDef> = {
  wonder: {
    tempo: [0.35, 0.65],
    modes: { lydian: 4, ionian: 2, mixolydian: 1, dorian: 0.5 },
    register: 2,
    legato: 1,
    bright: [1.1, 1.25],
    space: 1.25,
    dynamics: [0, 2],
    languages: { loop: 2, colour: 2, vamp: 2, pedal: 1 },
    open: 0.2,
    tunes: { song: 2, fanfare: 1, longLine: 1 },
    surprises: { keyJump: 2, alone: 1, pause: 1 },
    motion: { still: 1, flowing: 2 },
  },
  transcendence: {
    tempo: [0, 0.3],
    modes: { lydian: 2, aeolian: 2, dorian: 2, ionian: 1, mixolydian: 1 },
    register: 1,
    legato: 1.15,
    pace: 'slow',
    bright: [0.85, 1],
    space: 1.35,
    dynamics: [0, 3],
    languages: { loop: 1, pedal: 2, vamp: 2 },
    open: 0.25,
    tunes: { song: 1, recitation: 1, none: 1, longLine: 1 },
    surprises: { keyJump: 1, alone: 1, halfTime: 1 },
    motion: { still: 2, flowing: 1 },
  },
  tenderness: {
    tempo: [0.1, 0.4],
    modes: { ionian: 3, lydian: 1, dorian: 1, mixolydian: 1, aeolian: 0.5 },
    register: -1,
    legato: 1.1,
    bright: [0.8, 0.95],
    space: 0.85,
    dynamics: [-2, -3],
    languages: { loop: 2, colour: 2, lament: 1 },
    open: 0,
    tunes: { song: 3, lament: 1, longLine: 1 },
    surprises: { alone: 2, subito: 1 },
    motion: { still: 1, flowing: 2 },
  },
  nostalgia: {
    tempo: [0.2, 0.55],
    modes: { dorian: 2, ionian: 2, mixolydian: 1, aeolian: 1 },
    register: 0,
    legato: 1,
    bright: [0.75, 0.9],
    space: 1,
    dynamics: [0, 0],
    languages: { loop: 2, colour: 2, lament: 1 },
    open: 0.15,
    tunes: { song: 2, lament: 1, recitation: 1, riff: 1, longLine: 1 },
    surprises: { alone: 1, subito: 1, keyJump: 1 },
    motion: { still: 1, flowing: 2, driving: 1 },
  },
  peace: {
    tempo: [0, 0.35],
    modes: { lydian: 2, ionian: 2, mixolydian: 1, dorian: 0.5 },
    register: 1,
    legato: 1.15,
    pace: 'slow',
    bright: [0.9, 1.05],
    space: 1.15,
    dynamics: [-2, -4],
    languages: { loop: 1, vamp: 2, pedal: 2 },
    open: 0.1,
    tunes: { song: 2, recitation: 1, none: 1 },
    surprises: { alone: 1 },
    motion: { still: 2, flowing: 1 },
  },
  joy: {
    tempo: [0.55, 1],
    modes: { ionian: 3, mixolydian: 2, lydian: 1, dorian: 1 },
    register: 1,
    legato: 0.85,
    pace: 'quick',
    bright: [1.1, 1.3],
    space: 0.85,
    dynamics: [0, 0],
    languages: { loop: 3, colour: 1, vamp: 1 },
    open: 0,
    tunes: { song: 2, riff: 1, fanfare: 1 },
    surprises: { keyJump: 2, subito: 1 },
    motion: { flowing: 1, driving: 3 },
  },
  power: {
    tempo: [0.3, 0.7],
    modes: { aeolian: 3, phrygian: 2, dorian: 1, harmonic: 1, mixolydian: 0.5 },
    register: -2,
    legato: 0.9,
    bright: [1, 1.2],
    space: 1.1,
    dynamics: [1, 2],
    languages: { loop: 1, pedal: 2, vamp: 2 },
    open: 0,
    tunes: { song: 1, fanfare: 2, riff: 2 },
    surprises: { keyJump: 1, pause: 1, halfTime: 2, subito: 1 },
    motion: { flowing: 1, driving: 3 },
  },
  unease: {
    tempo: [0, 0.25],
    modes: { phrygian: 3, harmonic: 2, aeolian: 1 },
    register: -1,
    legato: 1,
    bright: [0.7, 0.85],
    space: 1.2,
    dynamics: [-2, 4],
    languages: { pedal: 3, vamp: 1, lament: 1 },
    open: 0.35,
    tunes: { song: 1, recitation: 2, lament: 1, none: 1 },
    surprises: { pause: 2, subito: 1, halfTime: 1 },
    motion: { still: 2, flowing: 1 },
  },
  grief: {
    tempo: [0, 0.25],
    modes: { aeolian: 3, harmonic: 2, dorian: 1 },
    register: -2,
    legato: 1.15,
    pace: 'slow',
    bright: [0.7, 0.85],
    space: 1.15,
    dynamics: [0, 2],
    languages: { loop: 1, lament: 3, pedal: 1 },
    open: 0,
    tunes: { song: 1, lament: 3, recitation: 1, longLine: 1 },
    surprises: { alone: 2, pause: 1, halfTime: 1 },
    motion: { still: 2, flowing: 1 },
  },
};

/** The style's modes, leaned on as the mood leans; empty when the style has none of the mood's modes. */
export function moodModes(styleModes: readonly (readonly [ModeName, number])[], mood: Mood): [ModeName, number][] {
  const lean = MOODS[mood].modes;
  return styleModes.map(([m, w]): [ModeName, number] => [m, w * (lean[m] ?? 0)]).filter(([, w]) => w > 0);
}

/** Only joy bounces: a bright, busy, bouncing accompaniment reads as a carousel in any other mood. */
export const bounces = (mood: Mood) => mood === 'joy';
