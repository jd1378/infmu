// Per-browser conveniences only: nothing here affects what the music is.

import { normalizeSeed } from '../core/seed.ts';

const KEY = 'infmu:v1';

export interface RecentSeed {
  seed: string;
  version: number;
  length?: string;
}

interface Stored {
  volume?: number;
  recent?: RecentSeed[];
}

// Anything on this origin can write here (every project site of a github.io owner shares it), so check shapes.
function read(): Stored {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object') return {};
    const { volume, recent } = v as Record<string, unknown>;
    return {
      volume: typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : undefined,
      recent: Array.isArray(recent) ? recent.map(toRecent).filter((r): r is RecentSeed => r !== null) : [],
    };
  } catch {
    return {};
  }
}

// seeds saved before versions existed are plain strings, and were played by v1
function toRecent(x: unknown): RecentSeed | null {
  if (typeof x === 'string') return normalizeSeed(x) ? { seed: normalizeSeed(x), version: 1 } : null;
  if (!x || typeof x !== 'object') return null;
  const { seed, version, length } = x as Record<string, unknown>;
  if (typeof seed !== 'string' || !normalizeSeed(seed)) return null;
  return {
    seed: normalizeSeed(seed),
    version: Number.isInteger(version) && (version as number) >= 1 ? version as number : 1,
    length: typeof length === 'string' && /^[a-z]{1,16}$/.test(length) ? length : undefined,
  };
}

function write(patch: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    // private mode or storage disabled: settings just won't persist
  }
}

export const storedVolume = (): number | undefined => read().volume;
export const storeVolume = (volume: number) => write({ volume });

export const recentSeeds = (): RecentSeed[] => (read().recent ?? []).slice(0, 8);
export const rememberSeed = (seed: string, version: number, length: string) =>
  write({
    recent: [
      { seed, version, length },
      ...recentSeeds().filter((r) => r.seed !== seed || r.version !== version || (r.length ?? 'standard') !== length),
    ].slice(0, 8),
  });
