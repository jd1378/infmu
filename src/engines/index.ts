// Every composer version ever released. Old versions stay forever so old seeds keep their songs.

import type { Engine } from '../core/engine.ts';
import { v1 } from './v1/index.ts';
import { v2 } from './v2/index.ts';

const ENGINES: ReadonlyMap<number, Engine> = new Map([[1, v1], [2, v2]]);

/** New seeds are played by the latest composer. */
export const LATEST_VERSION = 2;
/** Links from before versions existed carry none; they were made by v1. */
export const LEGACY_VERSION = 1;

export const VERSIONS = [...ENGINES.keys()].sort((a, b) => b - a);

export const isVersion = (v: number) => ENGINES.has(v);

export function engine(version: number): Engine {
  const e = ENGINES.get(version);
  if (!e) throw new RangeError(`unknown composer version ${version}`);
  return e;
}
