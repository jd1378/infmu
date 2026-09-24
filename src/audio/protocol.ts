import type { StyleId } from '../core/types.ts';

export type RenderRequest =
  | { id: number; kind: 'section'; phrase: string; styles: StyleId[]; index: number; sampleRate: number }
  | { id: number; kind: 'span'; phrase: string; styles: StyleId[]; from: number; count: number; sampleRate: number };

/** A request before the pool assigns its id (Omit distributed over the union). */
type WithoutId<T> = T extends RenderRequest ? Omit<T, 'id'> : never;
export type RenderJob = WithoutId<RenderRequest>;

export type RenderResponse =
  | { id: number; ok: true; left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer>; ms: number }
  | { id: number; ok: false; error: string };
