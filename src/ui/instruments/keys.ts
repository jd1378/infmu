// The computer keyboard as a musical one, by physical key (KeyboardEvent.code), so every layout plays the same
// places. Pitched instruments use the tracker layout: the bottom two rows are one octave (Z is C, the row above its
// sharps), the top two the next (Q is C again), so two and a half octaves are under the hands. Unpitched ones
// (a kit, the effects) lay their sounds along the bottom rows, then the top.

import type { InstrumentInfo } from '../../core/engine.ts';

/** [code, semitones above the window's C]. */
export const NOTE_KEYS: readonly (readonly [string, number])[] = [
  ['KeyZ', 0],
  ['KeyS', 1],
  ['KeyX', 2],
  ['KeyD', 3],
  ['KeyC', 4],
  ['KeyV', 5],
  ['KeyG', 6],
  ['KeyB', 7],
  ['KeyH', 8],
  ['KeyN', 9],
  ['KeyJ', 10],
  ['KeyM', 11],
  ['Comma', 12],
  ['KeyL', 13],
  ['Period', 14],
  ['Semicolon', 15],
  ['Slash', 16],
  ['KeyQ', 12],
  ['Digit2', 13],
  ['KeyW', 14],
  ['Digit3', 15],
  ['KeyE', 16],
  ['KeyR', 17],
  ['Digit5', 18],
  ['KeyT', 19],
  ['Digit6', 20],
  ['KeyY', 21],
  ['Digit7', 22],
  ['KeyU', 23],
  ['KeyI', 24],
  ['Digit9', 25],
  ['KeyO', 26],
  ['Digit0', 27],
  ['KeyP', 28],
];

/** Where an unpitched instrument's sounds go, in order. */
export const HIT_KEYS: readonly string[] = [
  'KeyZ',
  'KeyX',
  'KeyC',
  'KeyV',
  'KeyB',
  'KeyN',
  'KeyM',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyJ',
  'KeyK',
  'KeyQ',
  'KeyW',
  'KeyE',
  'KeyR',
  'KeyT',
];

/** Semitones the window spans: C to the E two octaves up. */
export const SPAN = 28;

/** The C that starts the window, one octave (`shift`) up or down from where an instrument starts. */
export function windowBase(range: readonly [number, number], shift = 0): number {
  const [lo, hi] = range;
  // a C just under the middle of the range, so the window sits across it
  let base = 12 * Math.floor(((lo + hi) / 2 - SPAN / 2 + 6) / 12);
  base += 12 * shift;
  // (never so far that less than an octave of the window is in the range)
  const least = 12 * Math.floor(lo / 12);
  const most = 12 * Math.floor((hi - 11) / 12);
  return Math.max(least, Math.min(most, base));
}

/** How far an instrument's window can shift from where it starts, in octaves. */
export function shifts(range: readonly [number, number]): readonly [down: number, up: number] {
  const start = windowBase(range);
  return [(windowBase(range, -99) - start) / 12, (windowBase(range, 99) - start) / 12];
}

/** What a key plays: a note (in the instrument's range) or a hit, or nothing. */
export type Played = { note: number } | { hit: string; name: string };

/** Every key that plays something, for an instrument at a window's base. */
export function keymap(inst: InstrumentInfo, base: number): Map<string, Played> {
  const out = new Map<string, Played>();
  if (inst.range) {
    const [lo, hi] = inst.range;
    for (const [code, semis] of NOTE_KEYS) {
      const note = base + semis;
      if (note >= lo && note <= hi) out.set(code, { note });
    }
  } else {
    (inst.hits ?? []).forEach((h, i) => {
      if (i < HIT_KEYS.length) out.set(HIT_KEYS[i], { hit: h.id, name: h.name });
    });
  }
  return out;
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** A MIDI note's name, middle C being C4. */
export const noteName = (n: number) => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
/** Whether a MIDI note is a black key. */
export const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);
