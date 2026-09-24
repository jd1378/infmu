import type { Song } from '../plan.ts';
import { hash32 } from '../rng.ts';
import type { Score } from '../types.ts';
import { arrange } from './arrange.ts';
import { Ctx } from './context.ts';

/** Seconds of audio rendered after a section ends, for its reverb and echoes to ring into the next one. */
export const TAIL = 5;

/** The full score of one section. Pure: the same song and index always give the same notes. */
export function composeSection(song: Song, index: number): Score {
  const ctx = new Ctx(song, index);
  arrange(ctx);
  const events = ctx.events.filter((e) => e.t >= 0 && e.t < ctx.duration + TAIL).sort((a, b) => a.t - b.t);
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
