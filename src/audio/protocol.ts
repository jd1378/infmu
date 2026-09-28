// Messages to and from the render worker. `version` picks the composer engine; phrase, styles, length and
// character identify the song within it. A note request renders one note of an instrument (see Engine.renderNote).

interface SongRef {
  version: number;
  phrase: string;
  styles: string[];
  length: string;
  character: string;
}

export type RenderRequest =
  | SongRef & { id: number; kind: 'section'; index: number; sampleRate: number }
  | SongRef & { id: number; kind: 'span'; from: number; count: number; sampleRate: number }
  | { id: number; kind: 'note'; version: number; instrument: string; note: number | string; sampleRate: number };

/** A request before the pool assigns its id (Omit distributed over the union). */
type WithoutId<T> = T extends RenderRequest ? Omit<T, 'id'> : never;
export type RenderJob = WithoutId<RenderRequest>;

export type RenderResponse =
  | { id: number; ok: true; left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer>; ms: number }
  | { id: number; ok: false; error: string };
