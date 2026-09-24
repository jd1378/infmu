import type { ChordSpec, Key } from './theory.ts';

export type StyleId = 'drift' | 'haze' | 'pulse' | 'rise' | 'cathedral';

export type Role = 'intro' | 'verse' | 'chorus' | 'build' | 'drop' | 'break' | 'outro';

/** How a movement hands over to the next one. */
export type Transition = 'fade' | 'swell' | 'stop';

export interface SectionDef {
  role: Role;
  bars: number;
  /** 0..1, drives arrangement density and the loudness target. */
  energy: number;
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
}

export interface Movement {
  index: number;
  seed: number;
  title: string;
  style: StyleId;
  key: Key;
  bpm: number;
  swing: number; // 0 = straight; delays every other 16th by this fraction of a 16th
  sections: SectionDef[];
  /** Global index of this movement's first section. */
  firstSection: number;
  /** Seconds from the start of the song. */
  startTime: number;
  duration: number;
  progressions: Record<'main' | 'lift' | 'alt', ChordSpec[]>;
  tone: Tone;
  mix: Mix;
  transition: Transition;
}

// ------------------------------------------------------------------ score events
// Times are seconds from the start of the section. Pitches are MIDI numbers.

export type KickKind = 'soft' | 'big' | 'drop' | 'dusty' | 'punch';
export type SnareKind = 'roll' | 'big' | 'huge' | 'clap' | 'dusty' | 'gated' | 'rim';
export type HatKind = 'closed' | 'open' | 'shaker' | 'dusty';
export type BassKind = 'heart' | 'sub' | 'saw' | 'roll' | 'round' | 'pulse';
export type PadKind = 'warm' | 'wide' | 'drop' | 'stab' | 'bloom' | 'glass' | 'strings';
export type LeadKind = 'hook' | 'hook2' | 'brass' | 'flute' | 'saw';
export type ImpactKind = 'ping' | 'hit' | 'soft' | 'drop' | 'cosmic' | 'final';
export type RiseKind = 'swell' | 'sweep' | 'build' | 'cymbal';

export interface Note {
  t: number;
  d: number;
  n: number;
  v: number;
}

export type Ev =
  | { i: 'kick'; t: number; v: number; k: KickKind; sc: number; n: number }
  | { i: 'snare'; t: number; v: number; k: SnareKind }
  | { i: 'tom'; t: number; v: number; n: number }
  | { i: 'hat'; t: number; v: number; k: HatKind; p?: number }
  | { i: 'bass'; t: number; d: number; n: number; v: number; k: BassKind; rel?: number }
  | { i: 'pad'; t: number; d: number; n: number[]; k: PadKind; cut: [number, number]; g?: number; rel?: number }
  | { i: 'keys'; t: number; d: number; n: number[]; v: number }
  | { i: 'pluck'; t: number; n: number; v: number; cut: number; p: number; dec?: number }
  | { i: 'lead'; t: number; k: LeadKind; ns: Note[]; oct?: number }
  | { i: 'bell'; t: number; n: number[]; v: number }
  | { i: 'organ'; t: number; d: number; n: number; att: number; rel?: number; g?: number; swell?: number }
  | { i: 'impact'; t: number; k: ImpactKind; a: number; n?: number[] }
  | { i: 'rise'; t: number; d: number; k: RiseKind; n?: number[] }
  | { i: 'drone'; t: number; d: number; n: number }
  | { i: 'vinyl'; t: number; d: number }
  | { i: 'breath'; t: number; d: number }
  | { i: 'sweep'; t: number; d: number }
  | { i: 'stop'; t: number; d: number };

export type Instrument = Ev['i'];

export interface ChordSpan {
  t: number;
  d: number;
  name: string;
  pcs: number[];
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
  events: Ev[];
  chords: ChordSpan[];
  /** Seeds the synth's noise, so the audio of a section is as reproducible as its notes. */
  noiseSeed: number;
}
