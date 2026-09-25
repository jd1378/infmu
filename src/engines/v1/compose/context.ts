// Everything a part writer needs to know about the section it's writing: time grid (with swing), the chord
// under any bar, voice-led chord voicings, and the degree <-> pitch mapping that respects altered chords.

import { barSeconds, type Song } from '../plan.ts';
import { hash32, Rng } from '../rng.ts';
import { STYLES } from '../styles.ts';
import {
  chordName,
  chordPitchClasses,
  type ChordSpec,
  degreeToMidi,
  type Key,
  mod,
  MODES,
  pc,
  tonicNear,
  voiceLead,
} from '../theory.ts';
import type { ChordSpan, Ev, Movement, Role, SectionDef } from '../types.ts';

export interface ChordSlot {
  bar: number; // first bar (inside the section) this chord sounds on
  bars: number;
  spec: ChordSpec;
  pcs: number[];
  voicing: number[];
}

// A build leans on the chords that pull hardest towards the tonic of its mode.
const BUILD_DEGREES: Record<Key['mode'], number[]> = {
  aeolian: [5, 6],
  dorian: [3, 6],
  phrygian: [5, 1],
  harmonic: [3, 4],
  ionian: [3, 4],
  lydian: [1, 1],
  mixolydian: [6, 3],
};

export const PAD_LO = 50;
export const PAD_HI = 74;

export class Ctx {
  readonly song: Song;
  readonly mv: Movement;
  readonly sec: SectionDef;
  readonly local: number;
  readonly index: number;
  readonly key: Key;
  readonly beat: number;
  readonly bar: number;
  readonly s16: number;
  readonly bars: number;
  readonly duration: number;
  readonly rng: Rng;
  /** Stable per movement: motifs and patterns shared by all of its sections. */
  readonly mrng: Rng;
  readonly chords: ChordSlot[];
  readonly events: Ev[] = [];
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly prevRole: Role | null;
  readonly nextRole: Role | null;
  /** The movement after this one, planned only for the last section (transitions look ahead). */
  readonly nextMovement: Movement | null;
  /** 0 or 1: the second time a role occurs in the movement plays it bigger. */
  readonly repeat: number;
  /** MIDI of the tonic in the melody register, and in the bass register. */
  readonly tonicMid: number;
  readonly tonicLow: number;
  /** The note the kick settles on: the tonic or the fifth, whichever sits between E1 and B1. */
  readonly kickNote: number;

  constructor(song: Song, index: number) {
    const ref = song.section(index);
    this.song = song;
    this.mv = ref.movement;
    this.local = ref.local;
    this.index = index;
    this.sec = this.mv.sections[this.local];
    this.key = this.mv.key;
    this.beat = 60 / this.mv.bpm;
    this.bar = barSeconds(this.mv);
    this.s16 = this.beat / 4;
    this.bars = this.sec.bars;
    this.duration = this.bars * this.bar;
    this.rng = new Rng(hash32(this.mv.seed, this.local, 0x736563));
    this.mrng = new Rng(hash32(this.mv.seed, 0x6d6f74));
    this.isFirst = this.local === 0;
    this.isLast = this.local === this.mv.sections.length - 1;
    this.prevRole = this.isFirst ? null : this.mv.sections[this.local - 1].role;
    this.nextMovement = this.isLast ? song.movement(this.mv.index + 1) : null;
    this.nextRole = this.isLast ? this.nextMovement!.sections[0].role : this.mv.sections[this.local + 1].role;
    this.repeat = this.mv.sections.slice(0, this.local).filter((s) => s.role === this.sec.role).length > 0 ? 1 : 0;
    this.tonicMid = tonicNear(this.key, 72);
    this.tonicLow = tonicNear(this.key, 40);
    this.kickNote = [0, 7].map((iv) => 28 + mod(this.key.tonic + iv - 4, 12)).find((n) => n <= 35) ?? 33;
    this.chords = this.voicedChords();
  }

  get role(): Role {
    return this.sec.role;
  }

  get style() {
    return STYLES[this.mv.style];
  }

  /** Seconds for a 16th step counted from the section start; odd 16ths are pushed late by the swing. */
  at(step: number): number {
    const whole = Math.floor(step);
    const sw = whole % 2 === 1 ? this.mv.swing * this.s16 : 0;
    return step * this.s16 + sw;
  }

  barAt(bar: number, step = 0): number {
    return this.at(bar * 16 + step);
  }

  chordAt(bar: number): ChordSlot {
    let slot = this.chords[0];
    for (const c of this.chords) if (c.bar <= bar) slot = c;
    return slot;
  }

  /** The chord sounding at a 16th step (section-relative). */
  chordAtStep(step: number): ChordSlot {
    return this.chordAt(Math.floor(step / 16));
  }

  /** Bass-register root of a chord. */
  root(slot: ChordSlot): number {
    return this.tonicLow + mod(slot.pcs[0] - this.key.tonic, 12);
  }

  /** Degree -> MIDI in the melody register, bent onto an altered chord tone when the chord asks for it. */
  pitch(degree: number, slot: ChordSlot, tonic = this.tonicMid): number {
    const m = degreeToMidi(this.key, degree, tonic);
    const p = pc(m);
    if (slot.pcs.includes(p)) return m;
    const scale = MODES[this.key.mode].map((x) => (x + this.key.tonic) % 12);
    for (const d of [1, -1]) if (slot.pcs.includes(pc(m + d)) && !scale.includes(pc(m + d))) return m + d;
    return m;
  }

  isChordTone(degree: number, slot: ChordSlot): boolean {
    return slot.pcs.includes(pc(this.pitch(degree, slot)));
  }

  push(...e: Ev[]): void {
    this.events.push(...e);
  }

  chordSpans(): ChordSpan[] {
    return this.chords.map((c) => ({
      t: this.barAt(c.bar),
      d: c.bars * this.bar,
      name: chordName(this.key, c.spec),
      pcs: c.pcs,
    }));
  }

  // Voicings are led from the movement's first chord through every section before this one, so pads flow
  // across section boundaries exactly as they would if the whole movement were written in one pass.
  private voicedChords(): ChordSlot[] {
    let prev: number[] | null = null;
    let mine: ChordSlot[] = [];
    for (let s = 0; s <= this.local; s++) {
      const slots = sectionChords(this.mv, s);
      for (const slot of slots) {
        const voices = slot.pcs.length >= 4 ? slot.pcs.length : 4;
        slot.voicing = voiceLead(prev, slot.pcs, Math.min(voices, 5), PAD_LO, PAD_HI);
        prev = slot.voicing;
      }
      if (s === this.local) mine = slots;
    }
    return mine;
  }
}

/** The chord plan of one section: which progression its role uses, at the style's harmonic rhythm. */
export function sectionChords(mv: Movement, local: number): ChordSlot[] {
  const sec = mv.sections[local];
  const style = STYLES[mv.style];
  const per = style.barsPerChord;
  const size = mv.progressions.main[0].size;
  let prog: ChordSpec[];
  switch (sec.role) {
    case 'chorus':
    case 'drop':
      prog = mv.progressions.lift;
      break;
    case 'break':
      prog = mv.progressions.alt;
      break;
    case 'build':
      prog = BUILD_DEGREES[mv.key.mode].map((deg) => ({ deg, size: size === 5 ? 4 : size }));
      break;
    default:
      prog = mv.progressions.main;
  }
  const slots: ChordSlot[] = [];
  const perBuild = sec.role === 'build' ? Math.max(1, sec.bars / prog.length) : per;
  for (let bar = 0, k = 0; bar < sec.bars; bar += perBuild, k++) {
    let spec = prog[k % prog.length];
    // the very last bars of a movement come home to the tonic
    if (local === mv.sections.length - 1 && bar + perBuild >= sec.bars) spec = { deg: 0, size: spec.size };
    slots.push({
      bar,
      bars: Math.min(perBuild, sec.bars - bar),
      spec,
      pcs: chordPitchClasses(mv.key, spec),
      voicing: [],
    });
  }
  return slots;
}
