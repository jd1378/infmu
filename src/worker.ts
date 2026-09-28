// Render worker: composes and synthesizes sections off the main thread, so the page never stutters.

import type { RenderRequest, RenderResponse } from './audio/protocol.ts';
import type { Engine, Rendered, SongPlan } from './core/engine.ts';
import { engine } from './engines/index.ts';

let cached: { key: string; song: SongPlan } | null = null;

function songFor(req: Exclude<RenderRequest, { kind: 'note' }>): SongPlan {
  const key = `${req.version}|${req.phrase}|${req.styles.join(',')}|${req.length}|${req.character}`;
  if (cached?.key !== key) {
    cached = { key, song: engine(req.version).song(req.phrase, req.styles, req.length, req.character) };
  }
  return cached.song;
}

function renderNote(e: Engine, instrument: string, note: number | string, sampleRate: number): Rendered {
  if (!e.renderNote) throw new Error(`composer v${e.version} has no instruments to play`);
  return e.renderNote(instrument, note, sampleRate);
}

self.onmessage = (ev: MessageEvent<RenderRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  let res: RenderResponse;
  try {
    const e = engine(req.version);
    const r = req.kind === 'note'
      ? renderNote(e, req.instrument, req.note, req.sampleRate)
      : req.kind === 'section'
      ? e.render(songFor(req), req.index, req.sampleRate)
      : e.renderSpan(songFor(req), req.from, req.count, req.sampleRate);
    res = {
      id: req.id,
      ok: true,
      left: r.left as Float32Array<ArrayBuffer>,
      right: r.right as Float32Array<ArrayBuffer>,
      ms: performance.now() - t0,
    };
    self.postMessage(res, { transfer: [res.left.buffer, res.right.buffer] });
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};
