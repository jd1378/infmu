import type { Song } from '../plan.ts';
import { hash32 } from '../rng.ts';
import { Clock } from '../tempo.ts';
import type { Ev, Score } from '../types.ts';
import { arrange } from './arrange.ts';
import { Ctx } from './context.ts';

/** Seconds of audio rendered after a section ends, for its reverb and echoes to ring into the next one. */
export const TAIL = 5;

/**
 * The full score of one section. Pure: the same song and index always give the same notes. Parts are written
 * against the movement's steady tempo, then played on the section's clock (see tempo.ts).
 */
export function composeSection(song: Song, index: number): Score {
  const ctx = new Ctx(song, index);
  const clock = new Clock(ctx.mv, ctx.local);
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
    .map((e) => letGo(e, ctx.stops))
    .sort((a, b) => a.t - b.t)
    .map((e) => (clock.steady ? e : played(e, clock)));
  const ref = song.section(index);
  const chords = ctx.chordSpans().map((c) =>
    clock.steady ? c : { ...c, t: clock.at(c.t), d: clock.at(c.t + c.d) - clock.at(c.t) }
  );
  return {
    index,
    movement: ctx.mv,
    section: ctx.sec,
    local: ctx.local,
    offset: ref.offset,
    duration: ref.duration,
    tail: TAIL,
    bpm: ctx.mv.bpm,
    bars: Array.from({ length: Math.ceil(ctx.bars - 1e-9) + 1 }, (_, k) => clock.at(Math.min(k, ctx.bars) * ctx.bar)),
    events,
    chords,
    noiseSeed: hash32(song.seed, index, 0x6e6f69),
  };
}

/** An event moved onto the section's clock: its start, its length and its notes'. */
function played(e: Ev, clock: Clock): Ev {
  const span = (t: number, d: number) => clock.at(t + d) - clock.at(t);
  const out = { ...e, t: clock.at(e.t) };
  if ('d' in out && out.d !== undefined) out.d = span(e.t, out.d);
  if ('ns' in out) out.ns = out.ns.map((n) => ({ ...n, t: clock.at(n.t), d: span(n.t, n.d) })) as typeof out.ns;
  return out;
}

/** What a player holds (and lets go when the band stops); everything else rings on by nature. */
const held = (e: Ev) =>
  ['pad', 'organ', 'choir', 'drone', 'lead', 'wind', 'acid', 'rise', 'sweep'].includes(e.i) ||
  (e.i === 'bass' && e.k !== 'pick' && e.k !== 'finger');

/** An event as the band plays it through its stops: a held sound let go at the first stop it runs into. */
export function letGo(e: Ev, stops: readonly number[]): Ev {
  if (!stops.length || !held(e)) return e;
  const at = (t: number, d: number) => stops.find((s) => s > t + 1e-6 && s < t + d - 1e-6);
  if ('ns' in e) {
    const ns = e.ns.map((n) => {
      const s = at(n.t, n.d);
      return s === undefined ? n : { ...n, d: s - n.t };
    });
    return { ...e, ns } as Ev;
  }
  if (!('d' in e) || e.d === undefined) return e;
  const s = at(e.t, e.d);
  if (s === undefined) return e;
  const d = s - e.t;
  // a riser or a sweep let go where it has got to on its arc
  if (e.i === 'rise' || e.i === 'sweep') {
    const [x0, x1] = [e.x0 ?? 0, e.x1 ?? 1];
    return { ...e, d, x1: x0 + ((x1 - x0) * d) / e.d };
  }
  return { ...e, d } as Ev;
}
