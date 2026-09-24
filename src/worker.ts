// Render worker: composes and synthesizes sections off the main thread, so the page never stutters.

import type { RenderRequest, RenderResponse } from './audio/protocol.ts';
import { composeSection } from './core/compose/index.ts';
import { Song } from './core/plan.ts';
import { renderScore } from './core/synth/render.ts';
import { renderSpan } from './core/synth/span.ts';

let cached: { key: string; song: Song } | null = null;

function songFor(phrase: string, styles: RenderRequest['styles']): Song {
  const key = `${phrase}|${styles.join(',')}`;
  if (cached?.key !== key) cached = { key, song: new Song(phrase, styles) };
  return cached.song;
}

self.onmessage = (ev: MessageEvent<RenderRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  let res: RenderResponse;
  try {
    const song = songFor(req.phrase, req.styles);
    const r = req.kind === 'section'
      ? renderScore(composeSection(song, req.index), req.sampleRate)
      : renderSpan(song, req.from, req.count, req.sampleRate);
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
