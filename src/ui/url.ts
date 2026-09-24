// Everything needed to hear the same music again lives in the URL fragment:
//   #seed=amber-quiet-harbor&m=3&t=42&styles=drift,haze
// m is the movement (1-based), t seconds into it. styles is omitted when all are on.
// Reaching movement m means planning the m before it (microseconds each), so m is capped to keep that instant.

export const MAX_MOVEMENT = 10_000;

import { normalizeSeed } from '../core/seed.ts';
import { STYLE_IDS } from '../core/styles.ts';
import type { StyleId } from '../core/types.ts';

export interface Place {
  seed: string;
  styles: StyleId[];
  movement: number; // 0-based
  time: number;
}

export function readHash(hash = location.hash): Partial<Place> {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Partial<Place> = {};
  const seed = normalizeSeed(p.get('seed') ?? '');
  if (seed) out.seed = seed;
  const m = Number(p.get('m'));
  if (Number.isInteger(m) && m >= 1 && m <= MAX_MOVEMENT) out.movement = m - 1;
  const t = Number(p.get('t'));
  if (Number.isFinite(t) && t > 0) out.time = t;
  const styles = (p.get('styles') ?? '').split(',').filter((s): s is StyleId => (STYLE_IDS as string[]).includes(s));
  if (styles.length) out.styles = styles;
  return out;
}

export function hashFor(p: Partial<Place> & { seed: string }): string {
  const q = new URLSearchParams({ seed: p.seed });
  if (p.movement) q.set('m', String(p.movement + 1));
  if (p.time && p.time >= 1) q.set('t', String(Math.floor(p.time)));
  if (p.styles && p.styles.length && p.styles.length < STYLE_IDS.length) q.set('styles', p.styles.join(','));
  return `#${q.toString()}`;
}
