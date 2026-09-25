import type { Song } from '../plan.ts';
import { hash32 } from '../rng.ts';
import type { Ev, Score } from '../types.ts';
import { arrange } from './arrange.ts';
import { Ctx } from './context.ts';

/** Seconds of audio rendered after a section ends, for its reverb and echoes to ring into the next one. */
export const TAIL = 5;

/** The full score of one section. Pure: the same song and index always give the same notes. */
export function composeSection(song: Song, index: number): Score {
  const ctx = new Ctx(song, index);
  arrange(ctx);
  const silent = (t: number) => ctx.silences.some((w) => t >= w.t0 - 1e-6 && t < w.t1 - 1e-6);
  const events = ctx.events
    .filter((e) => e.t >= 0 && e.t < ctx.duration + TAIL && (e.i === 'gap' || e.i === 'vinyl' || !silent(e.t)))
    .map((e) => {
      if (e.i !== 'lead' && e.i !== 'wind' && e.i !== 'acid') return e;
      const ns = e.ns.filter((n) => !silent(n.t));
      return { ...e, ns, t: ns.length ? ns[0].t : e.t } as Ev;
    })
    .filter((e) => !('ns' in e) || e.ns.length > 0)
    .sort((a, b) => a.t - b.t);
  const ref = song.section(index);
  return {
    index,
    movement: ctx.mv,
    section: ctx.sec,
    local: ctx.local,
    offset: ref.offset,
    duration: ctx.duration,
    tail: TAIL,
    bpm: ctx.mv.bpm,
    events,
    chords: ctx.chordSpans(),
    noiseSeed: hash32(song.seed, index, 0x6e6f69),
  };
}
