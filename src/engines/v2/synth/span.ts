import { composeSection } from '../compose/index.ts';
import type { Song } from '../plan.ts';
import { limit, type Rendered, renderScore } from './render.ts';

export interface SpanStats {
  index: number;
  lufs: number;
  gain: number;
  ms: number;
}

/**
 * Renders sections [from, from + count) and overlap-adds their tails into one continuous recording, the
 * same way the player schedules them. The section before `from` contributes its tail too, so a span sounds
 * identical to hearing it in the middle of the song.
 */
export function renderSpan(
  song: Song,
  from: number,
  count: number,
  sampleRate: number,
  onSection?: (s: SpanStats) => void,
): Rendered {
  const scores = [];
  for (let i = from; i < from + count; i++) scores.push(composeSection(song, i));
  const total = scores.reduce((s, x) => s + x.duration, 0) + scores[scores.length - 1].tail;
  const n = Math.round(total * sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const add = (r: Rendered, at: number, skip = 0) => {
    const o = Math.round(at * sampleRate);
    for (let j = skip; j < r.left.length && o + j < n; j++) {
      if (o + j < 0) continue;
      left[o + j] += r.left[j];
      right[o + j] += r.right[j];
    }
  };
  // earlier sections still ringing into the span: usually the one before, more when short ones (a rest) sit between
  let gap = 0;
  let before = 0;
  for (let j = from - 1; j >= 0 && gap < 10; j--) {
    const prev = composeSection(song, j);
    before += prev.duration;
    if (gap < prev.tail) add(renderScore(prev, sampleRate), -before, Math.round(before * sampleRate));
    gap += prev.duration;
  }
  let at = 0;
  for (const s of scores) {
    const t0 = performance.now();
    const r = renderScore(s, sampleRate);
    onSection?.({ index: s.index, lufs: r.lufs, gain: r.gain, ms: performance.now() - t0 });
    add(r, at);
    at += s.duration;
  }
  // overlapping tails can add up past the ceiling each section respected on its own
  limit({ sr: sampleRate, n, L: left, R: right }, 10 ** (-1 / 20));
  return { left, right, sampleRate, lufs: NaN, gain: 1 };
}
