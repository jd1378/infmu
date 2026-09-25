// v1 engine: frozen. The seed text -> number mapping and the title words are part of every v1 song.

import { hashString, type Rng } from './rng.ts';

// deno-fmt-ignore
const ADJECTIVES = [
  'amber', 'ashen', 'azure', 'bitter', 'blue', 'bright', 'brittle', 'burning', 'calm', 'cedar', 'cinder', 'clear',
  'cobalt', 'copper', 'crimson', 'crystal', 'dawn', 'deep', 'distant', 'dusk', 'dusty', 'electric', 'ember',
  'fading', 'faint', 'feral', 'first', 'floating', 'frozen', 'gentle', 'gilded', 'glass', 'golden', 'hollow',
  'hidden', 'hushed', 'idle', 'indigo', 'iron', 'ivory', 'jade', 'last', 'lilac', 'little', 'lone', 'lucid', 'lunar',
  'marble', 'midnight', 'misty', 'molten', 'neon', 'north', 'oblique', 'olive', 'opal', 'pale', 'paper', 'quiet',
  'restless', 'rose', 'rust', 'salt', 'scarlet', 'secret', 'silent', 'silver', 'slow', 'solar', 'still', 'stray',
  'sudden', 'tidal', 'velvet', 'violet', 'wandering', 'warm', 'wild', 'winter', 'woven',
] as const;

// deno-fmt-ignore
const NOUNS = [
  'aurora', 'avenue', 'beacon', 'bloom', 'canyon', 'cathedral', 'cloud', 'comet', 'coral', 'current', 'delta',
  'drift', 'dune', 'echo', 'eclipse', 'ember', 'engine', 'field', 'fjord', 'flare', 'forest', 'garden', 'glacier',
  'harbor', 'horizon', 'island', 'lantern', 'lattice', 'meadow', 'meridian', 'mirror', 'monsoon', 'moth', 'nebula',
  'orbit', 'orchard', 'parade', 'pendulum', 'prism', 'pulse', 'quarry', 'radio', 'reef', 'river', 'satellite',
  'signal', 'skyline', 'spire', 'static', 'station', 'summit', 'swallow', 'tide', 'tower', 'tram', 'tundra',
  'valley', 'vapor', 'veil', 'voyage', 'wave', 'whale', 'window', 'zenith',
] as const;

const MAX_SEED_LENGTH = 64;

/** Any text is a valid seed. Normalizing first makes "Amber Tide" and "amber-tide" the same music. */
export function normalizeSeed(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SEED_LENGTH);
}

export function seedNumber(phrase: string): number {
  return hashString(normalizeSeed(phrase));
}

const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

export function movementTitle(rng: Rng): string {
  const noun = rng.pick(NOUNS);
  return rng.chance(0.25) ? `${cap(noun)} of ${cap(rng.pick(NOUNS))}` : `${cap(rng.pick(ADJECTIVES))} ${cap(noun)}`;
}
