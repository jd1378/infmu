// Regressions for races found in review: every scenario here once left the player stuck, silent or lost.
import { assert, assertEquals } from '@std/assert';
import { RenderPool } from '../../src/audio/pool.ts';
import { WebPlayer } from '../../src/audio/player.ts';
import { Song } from '../../src/core/plan.ts';
import { clock, fakeWorker, installFakeAudio, sleep, until } from './fake_audio.ts';

installFakeAudio();
// the player's fades schedule short timers that may outlive a test
const opts = { sanitizeOps: false };

async function withPlayer(seed: string, delay: number, workers: number, fn: (p: WebPlayer) => Promise<void>) {
  const p = new WebPlayer(new Song(seed), fakeWorker(delay), workers);
  try {
    await fn(p);
  } finally {
    p.dispose();
  }
}

const settled = (p: WebPlayer) => until(() => p.state !== 'loading');

Deno.test({
  name: 'a new seed while playing starts it, even with one worker',
  ...opts,
  fn: () =>
    withPlayer('one', 100, 1, async (p) => {
      await p.play();
      await settled(p);
      p.load(new Song('two'));
      void p.play();
      await settled(p);
      assertEquals(p.state, 'playing');
      assertEquals(p.song.phrase, 'two');
    }),
});

Deno.test({
  name: 'seeking twice to the same place, or playing while loading, still starts',
  ...opts,
  fn: () =>
    withPlayer('twice', 100, 2, async (p) => {
      await p.play();
      await settled(p);
      p.seek(9, 0);
      p.seek(9, 0);
      await settled(p);
      assertEquals(p.state, 'playing');
      p.seek(14, 0);
      void p.play();
      await settled(p);
      assertEquals(p.state, 'playing');
    }),
});

Deno.test({
  name: 'pausing during a seek keeps the seek target',
  ...opts,
  fn: () =>
    withPlayer('target', 300, 2, async (p) => {
      await p.play();
      await settled(p);
      p.seek(13, 2);
      p.pause();
      await sleep(80);
      assertEquals(p.position().index, 13);
      await p.play();
      await settled(p);
      await sleep(150);
      assertEquals(p.state, 'playing');
      assertEquals(p.position().index, 13);
    }),
});

Deno.test({
  name: 'a new seed, paused while loading, resumes at its own start',
  ...opts,
  fn: () =>
    withPlayer('old', 300, 2, async (p) => {
      await p.play();
      await settled(p);
      p.seek(9, 0);
      await settled(p);
      p.load(new Song('new'));
      p.pause();
      assertEquals(p.position().index, 0);
      await p.play();
      await settled(p);
      await sleep(150);
      assertEquals(p.position().index, 0);
      assertEquals(p.state, 'playing');
    }),
});

Deno.test({
  name: 'a seek never shows the previous section, whose tail is playing',
  ...opts,
  fn: () =>
    withPlayer('tail', 100, 2, async (p) => {
      await p.play();
      await settled(p);
      const seen = new Set<number>();
      p.on('section', (s) => seen.add(s.index));
      p.seek(5, 0);
      for (let i = 0; i < 30; i++) {
        seen.add(p.position().index);
        await sleep(10);
      }
      assert(!seen.has(4), `saw ${[...seen]}`);
    }),
});

Deno.test({
  name: 'when renders fall behind, the position never jumps backwards',
  ...opts,
  fn: async () => {
    clock.speed = 60;
    try {
      await withPlayer('slow', 300, 1, async (p) => {
        await p.play();
        await settled(p);
        const seen: number[] = [];
        for (let i = 0; i < 30; i++) {
          seen.push(p.position().index);
          await sleep(100);
        }
        assert(seen.every((x, i) => i === 0 || x >= seen[i - 1]), `went ${seen}`);
        assert(seen[seen.length - 1] > 1, 'it kept moving');
      });
    } finally {
      clock.speed = 1;
    }
  },
});

Deno.test({
  name: 'pause and play in quick succession honour the last request',
  ...opts,
  fn: () =>
    withPlayer('quick', 100, 2, async (p) => {
      await p.play();
      await settled(p);
      p.pause();
      void p.play();
      await sleep(200);
      assertEquals(p.state, 'playing');
      p.pause();
      await sleep(100);
      const resuming = p.play();
      p.pause();
      await resuming;
      await sleep(100);
      assertEquals(p.state, 'paused');
    }),
});

Deno.test({
  name: 'a worker that cannot start is retried a few times, then rendering reports failure',
  ...opts,
  fn: async () => {
    const pool = new RenderPool(new URL('./does-not-exist.js', import.meta.url), 2);
    const job = { kind: 'section' as const, phrase: 'a', styles: ['drift' as const], index: 0, sampleRate: 100 };
    try {
      const first = await pool.render(job).then(() => 'ok', (e: Error) => e.message);
      assert(first !== 'ok');
      await sleep(3000); // let the retries and their backoff run out
      const later = await pool.render(job).then(() => 'ok', (e: Error) => e.message);
      assertEquals(later, 'audio rendering is unavailable in this browser');
    } finally {
      pool.dispose();
    }
  },
});
