// The page takes its colour from the music: the key's place on the circle of fifths sets the hue, the mode
// sets how bright and saturated it is. A modulation recolours everything.

import type { KeyInfo } from '../core/engine.ts';

const MODE_LIGHT: Record<string, [l: number, c: number]> = {
  lydian: [0.86, 0.13],
  ionian: [0.84, 0.12],
  mixolydian: [0.82, 0.12],
  dorian: [0.8, 0.12],
  aeolian: [0.78, 0.11],
  harmonic: [0.76, 0.12],
  phrygian: [0.74, 0.1],
};

export interface Tint {
  h: number;
  l: number;
  c: number;
}

/** Position of a pitch class on the circle of fifths: C 0, G 1, D 2 ... F 11. */
export const fifths = (pc: number) => (pc * 7) % 12;

export function tintFor(key: KeyInfo): Tint {
  const [l, c] = MODE_LIGHT[key.mode] ?? [0.8, 0.12];
  return { h: (fifths(key.tonic) * 30 + 285) % 360, l, c };
}

export function applyTint(t: Tint): void {
  const s = document.documentElement.style;
  s.setProperty('--h', t.h.toFixed(1));
  s.setProperty('--l', String(t.l));
  s.setProperty('--c', String(t.c));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `oklch(0.155 0.03 ${t.h.toFixed(1)})`);
}
