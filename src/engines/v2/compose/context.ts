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

// The chord that leads each mode home, as a seventh: a section handing over to one that starts on the tonic
// often ends on it, so the next part arrives instead of just starting.
const TURNS: Record<Key['mode'], Omit<ChordSpec, 'size'>[]> = {
  aeolian: [{ deg: 4, alt: [0, 1] }, { deg: 6 }],
  dorian: [{ deg: 3 }, { deg: 6 }],
  phrygian: [{ deg: 1 }],
  harmonic: [{ deg: 4 }],
  ionian: [{ deg: 4 }],
  lydian: [{ deg: 1 }],
  mixolydian: [{ deg: 6 }, { deg: 3 }],
};
const TURNING: ReadonlySet<Role> = new Set(['intro', 'verse', 'chorus', 'bridge', 'break', 'solo']);

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
  readonly role: Role;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly prevRole: Role | null;
  readonly nextRole: Role | null;
  /** The movement after this one, planned only for the last section (transitions look ahead). */
  readonly nextMovement: Movement | null;
  /** 0 or 1: the second time a role occurs in the movement plays it bigger. */
  readonly repeat: number;
  /** How many times this role came before in the movement (0 the first time). */
  readonly occ: number;
  /** No later section of the movement has this role. */
  readonly lastOfRole: boolean;
  /**
   * Sections of the same role in a row form one part (an intro of two sections is one long intro): the bars of
   * the whole run, and how many of them come before this section.
   */
  readonly runBars: number;
  readonly runStartBar: number;
  /** Which time this part comes round: a chorus:8 chorus:8 is one chorus (turn 0), not two. */
  readonly turn: number;
  /** This section's place in its run: 0 for the first 8 bars of a 16-bar chorus, 1 for the second. */
  readonly inRun: number;
  /** The run ends with this section. */
  readonly runEnd: boolean;
  /** No later run of this role: the last chorus, the final drop. */
  readonly finalTurn: boolean;
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
    this.role = this.sec.role;
    this.key = sectionKey(this.mv, this.local);
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
    this.occ = this.mv.sections.slice(0, this.local).filter((s) => s.role === this.sec.role).length;
    this.repeat = this.occ > 0 ? 1 : 0;
    this.lastOfRole = !this.mv.sections.slice(this.local + 1).some((s) => s.role === this.sec.role);
    let first = this.local;
    while (first > 0 && this.mv.sections[first - 1].role === this.sec.role) first--;
    let end = this.local;
    while (end + 1 < this.mv.sections.length && this.mv.sections[end + 1].role === this.sec.role) end++;
    const barsOf = (a: number, b: number) => this.mv.sections.slice(a, b).reduce((n, x) => n + x.bars, 0);
    this.runStartBar = barsOf(first, this.local);
    this.runBars = barsOf(first, end + 1);
    const secs = this.mv.sections;
    this.inRun = this.local - first;
    this.runEnd = this.local === end;
    this.turn = secs.slice(0, first).filter((s, k) => s.role === this.sec.role && secs[k + 1].role !== s.role).length;
    this.finalTurn = !secs.slice(end + 1).some((s) => s.role === this.sec.role);
    this.tonicMid = tonicNear(this.key, 72);
    this.tonicLow = tonicNear(this.key, 40);
    this.kickNote = [0, 7].map((iv) => 28 + mod(this.key.tonic + iv - 4, 12)).find((n) => n <= 35) ?? 33;
    this.chords = this.voicedChords();
  }

  /**
   * The peak of a part: its final turn, from its second time round (or, for a part that comes only once, its
   * second 8 bars). Where a returning part is at its biggest.
   */
  get peak(): boolean {
    return this.finalTurn && (this.turn >= 1 || this.inRun >= 1);
  }

  /** A part heard before: a later turn, or the second half of a long one. */
  get returning(): boolean {
    return this.turn > 0 || this.inRun > 0;
  }

  /** Progress 0..1 through the whole run of this role, at progress `x` through this section. */
  runAt(x: number): number {
    return (this.runStartBar + x * this.bars) / this.runBars;
  }

  /** The bar number counted from the start of the run. */
  runBar(bar: number): number {
    return this.runStartBar + bar;
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

  /** The chord's root as a degree of the key (0..6). */
  rootDegree(slot: ChordSlot): number {
    for (let d = 0; d < 7; d++) if (pc(this.pitch(d, slot)) === slot.pcs[0]) return d;
    return 0;
  }

  isChordTone(degree: number, slot: ChordSlot): boolean {
    return slot.pcs.includes(pc(this.pitch(degree, slot)));
  }

  push(...e: Ev[]): void {
    this.events.push(...e);
  }

  /** Windows where nothing new starts (see hush and clear). */
  readonly silences: { t0: number; t1: number }[] = [];

  /** Nothing new starts from `t0` to `t1`, but what's already sounding rings on: an ending that breathes. */
  clear(t0: number, t1: number): void {
    if (t1 > t0) this.silences.push({ t0, t1 });
  }

  /**
   * A written silence from `t0` to `t1` seconds: nothing new starts, everything sounding is cut, and the
   * room rings on (or, with room false, falls silent too). Silence is part of the music, not a gap in it.
   */
  hush(t0: number, t1: number, room = true): void {
    if (t1 <= t0) return;
    this.silences.push({ t0, t1 });
    this.events.push({ i: 'gap', t: t0, d: t1 - t0, room });
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

/** The key a section plays in: the movement's, or above it after a lift. */
export function sectionKey(mv: Movement, local: number): Key {
  const shift = mv.sections[local].shift;
  return shift ? { tonic: (mv.key.tonic + shift) % 12, mode: mv.key.mode } : mv.key;
}

/** The progression a section's role uses. */
function progression(mv: Movement, role: Role): ChordSpec[] {
  const size = mv.progressions.main[0].size;
  switch (role) {
    case 'chorus':
    case 'drop':
    case 'solo':
      return mv.progressions.lift;
    case 'break':
      return mv.progressions.alt;
    case 'bridge':
      return mv.progressions.bridge;
    case 'build':
    case 'prechorus':
      return BUILD_DEGREES[mv.key.mode].map((deg) => ({ deg, size: size === 5 ? 4 : size }));
    case 'rest':
      return [{ deg: 0, size }];
    default:
      return mv.progressions.main;
  }
}

/**
 * The chord a section may end on to lead into the next one (in the next one's key, after a lift), if any.
 * Never the chord before it (`before`, a root): that would only hold it.
 */
function turnaround(mv: Movement, local: number, key: Key, before: number): ChordSpec | null {
  const sec = mv.sections[local];
  const next = mv.sections[local + 1];
  if (!next || !TURNING.has(sec.role) || ['rest', 'build', 'prechorus'].includes(next.role)) return null;
  const first = progression(mv, next.role)[0];
  if (first.deg !== 0 || first.alt || first.shift) return null;
  const rng = new Rng(hash32(mv.seed, local, 0x7a2d));
  if (!rng.chance(0.65)) return null;
  const size = mv.progressions.main[0].size;
  const shift = mod(next.shift - sec.shift, 12) || undefined;
  const options = TURNS[mv.key.mode]
    .map((t): ChordSpec => ({ ...t, size: size === 3 ? 4 : size, shift }))
    .filter((c) => chordPitchClasses(key, c)[0] !== before);
  return options.length ? rng.pick(options) : null;
}

/** The chord plan of one section: which progression its role uses, at the style's harmonic rhythm. */
export function sectionChords(mv: Movement, local: number): ChordSlot[] {
  const sec = mv.sections[local];
  const style = STYLES[mv.style];
  const per = style.barsPerChord;
  const prog = progression(mv, sec.role);
  const key = sectionKey(mv, local);
  const leading = sec.role === 'build' || sec.role === 'prechorus';
  // the movement's last sounding bars come home to the tonic (a rest after them is silence)
  let lastSounding = mv.sections.length - 1;
  if (mv.sections[lastSounding].role === 'rest') lastSounding--;
  const slots: ChordSlot[] = [];
  const step = leading ? Math.max(1, sec.bars / prog.length) : sec.role === 'rest' ? sec.bars : per;
  for (let bar = 0, k = 0; bar < sec.bars; bar += step, k++) {
    let spec = prog[k % prog.length];
    if (local === lastSounding && bar + step >= sec.bars) spec = { deg: 0, size: spec.size };
    slots.push({
      bar,
      bars: Math.min(step, sec.bars - bar),
      spec,
      pcs: chordPitchClasses(key, spec),
      voicing: [],
    });
  }
  const turn = slots.length > 1 ? turnaround(mv, local, key, slots[slots.length - 2].pcs[0]) : null;
  if (turn) {
    const last = slots[slots.length - 1];
    last.spec = turn;
    last.pcs = chordPitchClasses(key, turn);
  }
  return slots;
}
