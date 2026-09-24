import type { RenderRequest } from '../../src/audio/protocol.ts';
import { Song } from '../../src/core/plan.ts';

const DELAY = Number(new URL(import.meta.url).searchParams.get('delay') ?? 100);

self.onmessage = (ev: MessageEvent<RenderRequest>) => {
  const req = ev.data;
  if (req.kind !== 'section') return;
  const seconds = new Song(req.phrase, req.styles).section(req.index).duration + 5;
  const until = Date.now() + DELAY;
  while (Date.now() < until) { /* busy, like a real render */ }
  const left = new Float32Array(Math.round(seconds * req.sampleRate));
  const right = new Float32Array(left.length);
  self.postMessage({ id: req.id, ok: true, left, right, ms: DELAY }, { transfer: [left.buffer, right.buffer] });
};
