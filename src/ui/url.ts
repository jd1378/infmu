// Everything needed to hear the same music again lives in the URL fragment:
//   #seed=amber-quiet-harbor&v=2&len=long&char=steady&m=3&t=42&styles=drift,haze
// v is the composer version (links without one predate versions and mean v1), len the movement length
// (omitted when standard), char how far the music ranges (omitted when adventurous), m the movement (1-based),
// t seconds into it. styles is omitted when all of the version's styles are on.
// Reaching movement m means planning the m before it (microseconds each), so m is capped to keep that instant.

import { normalizeSeed } from '../core/seed.ts';

export const MAX_MOVEMENT = 10_000;

export interface Place {
  seed: string;
  version: number;
  length: string;
  character: string;
  styles: string[];
  movement: number; // 0-based
  time: number;
}

export function readHash(hash = location.hash): Partial<Place> {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Partial<Place> = {};
  const seed = normalizeSeed(p.get('seed') ?? '');
  if (seed) out.seed = seed;
  const v = Number(p.get('v'));
  if (Number.isInteger(v) && v >= 1 && v <= 999) out.version = v;
  const len = p.get('len') ?? '';
  if (/^[a-z]{1,16}$/.test(len)) out.length = len;
  const character = p.get('char') ?? '';
  if (/^[a-z]{1,16}$/.test(character)) out.character = character;
  const m = Number(p.get('m'));
  if (Number.isInteger(m) && m >= 1 && m <= MAX_MOVEMENT) out.movement = m - 1;
  const t = Number(p.get('t'));
  if (Number.isFinite(t) && t > 0) out.time = t;
  // ids only here; the engine keeps the ones it knows
  const styles = (p.get('styles') ?? '').split(',').filter((s) => /^[a-z]{1,24}$/.test(s)).slice(0, 32);
  if (styles.length) out.styles = styles;
  return out;
}

export function hashFor(p: Partial<Place> & { seed: string; version: number }): string {
  const q = new URLSearchParams({ seed: p.seed, v: String(p.version) });
  if (p.length && p.length !== 'standard') q.set('len', p.length);
  if (p.character && p.character !== 'adventurous') q.set('char', p.character);
  if (p.movement) q.set('m', String(p.movement + 1));
  if (p.time && p.time >= 1) q.set('t', String(Math.floor(p.time)));
  if (p.styles?.length) q.set('styles', p.styles.join(','));
  return `#${q.toString()}`;
}
