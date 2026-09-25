// Seed text utilities for the interface. Engines keep their own frozen copy of normalization and hashing.

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

export const MAX_SEED_LENGTH = 64;

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

/** Spaces and hyphens are the same seed, and spaces read better in a title. */
export const displaySeed = (phrase: string) => normalizeSeed(phrase).replaceAll('-', ' ');

/** A fresh, memorable phrase. Uses the platform's randomness: this is the one non-deterministic choice. */
export function randomSeedPhrase(random: (n: number) => number = cryptoInt): string {
  const a = ADJECTIVES[random(ADJECTIVES.length)];
  let b = ADJECTIVES[random(ADJECTIVES.length)];
  while (b === a) b = ADJECTIVES[random(ADJECTIVES.length)];
  return `${a}-${b}-${NOUNS[random(NOUNS.length)]}`;
}

function cryptoInt(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

const ROMAN: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let out = '';
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}
