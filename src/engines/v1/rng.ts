// Deterministic randomness. Everything here is integer math (Math.imul, shifts), so a seed produces the
// same stream in every JS engine. Composition decisions must only ever use these streams.

/** Mixes any number of integers into one well-distributed 32-bit value (murmur3 finalizer per step). */
export function hash32(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    let k = Math.imul(p | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    h ^= Math.imul(k, 0x1b873593);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return hash32(h, s.length);
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.a = hash32(seed, 1);
    this.b = hash32(seed, 2);
    this.c = hash32(seed, 3);
    this.d = 1;
    for (let i = 0; i < 12; i++) this.u32();
  }

  /** sfc32 */
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** [0, 1), exact: a 32-bit integer divided by 2^32. */
  next(): number {
    return this.u32() / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Symmetric jitter in [-x, x). */
  jitter(x: number): number {
    return (this.next() * 2 - 1) * x;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of entries) total += w;
    let x = this.next() * total;
    for (const [v, w] of entries) {
      if ((x -= w) < 0) return v;
    }
    return entries[entries.length - 1][0];
  }

  /**
   * An independent stream derived from this one's seed, not its position: adding draws in one part of the
   * composer never shifts another part, and the order forks are made in doesn't matter.
   */
  fork(...labels: (number | string)[]): Rng {
    return new Rng(hash32(this.seed, ...labels.map((l) => (typeof l === 'string' ? hashString(l) : l))));
  }
}
