// How a piece's arc (see arcs.ts) reaches the band, beyond loudness: who plays a hushed or bare section, and the
// last hit of a piece that ends on its peak.

import { mod } from '../theory.ts';
import { type Ev, isMelody } from '../types.ts';
import type { Ctx } from './context.ts';
import { crash } from './parts.ts';

/** The rhythm section, and what drives a section forward: out of a hushed one. */
const RHYTHM: ReadonlySet<Ev['i']> = new Set([
  'kick',
  'snare',
  'tom',
  'hat',
  'perc',
  'bass',
  'acid',
  'impact',
  'rise',
  'sweep',
]);
/** What a bare section keeps under its tune: the sustained bed, the record's surface, its silences. */
const BED: ReadonlySet<Ev['i']> = new Set(['pad', 'organ', 'drone', 'choir', 'vinyl', 'breath', 'gap']);

/** A hushed section plays without its rhythm section and its overdriven wall; a bare one only its tune over the bed. */
export function treat(ctx: Ctx): void {
  const how = ctx.sec.treatment;
  if (!how) return;
  const keep = how === 'hushed'
    ? (e: Ev) => !RHYTHM.has(e.i) && !(e.i === 'string' && e.k === 'overdrive')
    : (e: Ev) => isMelody(e) || BED.has(e.i);
  const kept = ctx.events.filter(keep);
  ctx.events.length = 0;
  ctx.events.push(...kept);
}

/** A piece with no tune (see Tune): the band and its colour are the piece; counter-lines stay. */
export function untuned(ctx: Ctx): void {
  if (ctx.mv.tune !== 'none') return;
  const kept = ctx.events.filter((e) => !isMelody(e));
  ctx.events.length = 0;
  ctx.events.push(...kept);
}

/**
 * A surprise inside a section (see surprises.ts). `pause`: halfway through, the band hits a downbeat together and
 * stops for the rest of the bar (what rings rings on), then comes back on the next with a crash. `halfTime`: the
 * drums in half time, the backbeat on three alone and the kick only where it isn't marking the beats, so the peak
 * feels twice as broad while the band plays on at tempo.
 */
export function moment(ctx: Ctx): void {
  const drummed = ctx.events.some((e) => e.i === 'kick' || e.i === 'snare');
  const acoustic = ctx.events.some((e) => e.i === 'kick' && e.k === 'acoustic');
  if (ctx.sec.surprise === 'pause') {
    const k = Math.floor(ctx.bars / 2);
    ctx.stop(ctx.barAt(k) + ctx.beat, ctx.barAt(k + 1) - 0.02);
    if (drummed) crash(ctx, k + 1, 0.9, acoustic);
  }
  if (ctx.sec.surprise !== 'halfTime' || ctx.mv.meter !== '4/4' || !drummed) return;
  const step = (t: number) => mod(Math.round(t / ctx.s16), 16);
  const bars = new Map<number, Extract<Ev, { i: 'snare' }>>();
  const kept = ctx.events.filter((e) => {
    if (e.i === 'snare' && (step(e.t) === 4 || step(e.t) === 12)) {
      bars.set(Math.floor(e.t / ctx.bar + 0.01), e);
      return false;
    }
    return !(e.i === 'kick' && [4, 8, 12].includes(step(e.t)));
  });
  ctx.events.length = 0;
  ctx.events.push(...kept);
  // the one backbeat, on three, where the bar hasn't one
  for (const [b, e] of bars) {
    const t = ctx.barAt(b, 8);
    if (!kept.some((x) => x.i === 'snare' && Math.abs(x.t - t) < ctx.s16 / 2)) {
      ctx.push({ ...e, t, v: Math.min(1, e.v * 1.1) });
    }
  }
}

/**
 * A piece that ends on its peak ends on a hit: the band plays the downbeat of its last bar together, with a crash,
 * and stops there (see Ctx.stop: what rings rings on); the tempo broadens into it (see tempo.ts) and the room rings
 * into the rest after it.
 */
export function finale(ctx: Ctx): void {
  if (ctx.mv.arc !== 'lastWord' || ctx.local !== ctx.mv.sections.findLastIndex((s) => s.role !== 'rest')) return;
  const bar = Math.max(0, Math.ceil(ctx.bars) - 1);
  crash(ctx, bar, 1, ctx.events.some((e) => e.i === 'kick' && e.k === 'acoustic'));
  ctx.stop(ctx.barAt(bar) + ctx.beat, ctx.duration + 1);
}
