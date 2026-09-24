// Per-browser conveniences only: nothing here affects what the music is.

import { normalizeSeed } from '../core/seed.ts';

const KEY = 'infmu:v1';

interface Stored {
  volume?: number;
  recent?: string[];
}

// Anything on this origin can write here (every project site of a github.io owner shares it), so check shapes.
function read(): Stored {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object') return {};
    const { volume, recent } = v as Record<string, unknown>;
    return {
      volume: typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : undefined,
      recent: Array.isArray(recent) ? recent.filter((s): s is string => typeof s === 'string' && s.length <= 64) : [],
    };
  } catch {
    return {};
  }
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

export const recentSeeds = (): string[] => (read().recent ?? []).map(normalizeSeed).filter(Boolean).slice(0, 8);
export const rememberSeed = (seed: string) =>
  write({ recent: [seed, ...recentSeeds().filter((s) => s !== seed)].slice(0, 8) });
