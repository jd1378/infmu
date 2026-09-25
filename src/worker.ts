// Render worker: composes and synthesizes sections off the main thread, so the page never stutters.

import type { RenderRequest, RenderResponse } from './audio/protocol.ts';
import type { SongPlan } from './core/engine.ts';
import { engine } from './engines/index.ts';

let cached: { key: string; song: SongPlan } | null = null;

function songFor(req: RenderRequest): SongPlan {
  const key = `${req.version}|${req.phrase}|${req.styles.join(',')}|${req.length}`;
  if (cached?.key !== key) cached = { key, song: engine(req.version).song(req.phrase, req.styles, req.length) };
  return cached.song;
}

self.onmessage = (ev: MessageEvent<RenderRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  let res: RenderResponse;
  try {
    const e = engine(req.version);
    const song = songFor(req);
    const r = req.kind === 'section'
      ? e.render(song, req.index, req.sampleRate)
      : e.renderSpan(song, req.from, req.count, req.sampleRate);
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
