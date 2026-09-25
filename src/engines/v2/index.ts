// v2: longer movements (three to four minutes), more song forms and phrase forms, written silences, key lifts,
// nine styles and many more instruments. Frozen once released, like v1. This adapter only translates its
// internals to the engine port.

import type { Cue, Engine, KeyInfo, MovementInfo, SectionScore, SongPlan, StyleInfo } from '../../core/engine.ts';
import { composeSection } from './compose/index.ts';
import { type Length, LENGTHS, Song } from './plan.ts';
import { STYLE_IDS, STYLES } from './styles.ts';
import { renderScore } from './synth/render.ts';
import { renderSpan } from './synth/span.ts';
import { type Key, keyName, MODES, noteName } from './theory.ts';
import { sectionKey } from './compose/context.ts';
import type { Ev, Movement, StyleId } from './types.ts';

const styleInfo = (id: StyleId): StyleInfo => ({ id, name: STYLES[id].name, genre: STYLES[id].genre });

const keyInfo = (key: Key): KeyInfo => ({
  tonic: key.tonic,
  mode: key.mode,
  label: keyName(key),
  scale: MODES[key.mode].map((x) => (x + key.tonic) % 12),
  names: Array.from({ length: 12 }, (_, p) => noteName(p, key)),
});

class Plan implements SongPlan {
  readonly version = 2;
  readonly song: Song;
  get length(): string {
    return this.song.length;
  }
  private readonly infos = new WeakMap<Movement, MovementInfo>();

  constructor(phrase: string, styles?: readonly string[], length?: string) {
    this.song = new Song(
      phrase,
      styles?.filter((s): s is StyleId => (STYLE_IDS as string[]).includes(s)),
      length && length in LENGTHS ? (length as Length) : 'standard',
    );
  }

  get phrase(): string {
    return this.song.phrase;
  }

  get styles(): readonly string[] {
    return this.song.styles;
  }

  movement(m: number): MovementInfo {
    return this.info(this.song.movement(m));
  }

  section(i: number) {
    const r = this.song.section(i);
    return { index: r.index, movement: this.info(r.movement), local: r.local, offset: r.offset, duration: r.duration };
  }

  locate(m: number, t: number) {
    return this.song.locate(m, t);
  }

  info(mv: Movement): MovementInfo {
    let info = this.infos.get(mv);
    if (!info) {
      info = {
        index: mv.index,
        title: mv.title,
        style: styleInfo(mv.style),
        key: keyInfo(mv.key),
        bpm: mv.bpm,
        swing: mv.swing,
        sections: mv.sections,
        firstSection: mv.firstSection,
        startTime: mv.startTime,
        duration: mv.duration,
      };
      this.infos.set(mv, info);
    }
    return info;
  }
}

function plan(song: SongPlan): Plan {
  if (!(song instanceof Plan)) throw new TypeError(`a v${song.version} song can't be played by engine v2`);
  return song;
}

/** The score reduced to what the visuals react to. */
function cues(events: readonly Ev[]): Cue[] {
  const out: Cue[] = [];
  for (const e of events) {
    switch (e.i) {
      case 'kick':
        out.push({ t: e.t, kind: 'kick', v: e.v });
        break;
      case 'snare':
        if (e.k !== 'roll' && e.k !== 'rim') out.push({ t: e.t, kind: 'snare', v: e.v });
        break;
      case 'impact':
        out.push({ t: e.t, kind: 'impact', v: e.a });
        break;
      case 'pad':
        for (const n of e.n) out.push({ t: e.t, kind: 'pad', v: 1, n, d: e.d + 0.5 });
        break;
      case 'organ':
        out.push({ t: e.t, kind: 'pad', v: 1, n: e.n, d: e.d });
        break;
      case 'keys':
        for (const n of e.n) out.push({ t: e.t, kind: 'chord', v: e.v, n, d: e.d + 0.2 });
        break;
      case 'bass':
        out.push({ t: e.t, kind: 'bass', v: e.v, n: e.n, d: e.d });
        break;
      case 'pluck':
        out.push({ t: e.t, kind: 'pluck', v: e.v, n: e.n, d: 0.45 });
        break;
      case 'tom':
        out.push({ t: e.t, kind: 'perc', v: e.v, n: e.n, d: 0.4 });
        break;
      case 'bell':
        for (const n of e.n) out.push({ t: e.t, kind: 'bell', v: e.v, n, d: 2.5 });
        break;
      case 'lead':
      case 'wind':
        for (const n of e.ns) out.push({ t: n.t, kind: 'melody', v: n.v, n: n.n, d: n.d });
        break;
      case 'string':
      case 'mallet':
        out.push({
          t: e.t,
          kind: e.lead ? 'melody' : 'pluck',
          v: e.v,
          n: e.n,
          d: e.i === 'string' ? Math.min(2, e.d ?? 1) : 0.8,
        });
        break;
      case 'piano':
        for (const n of e.n) out.push({ t: e.t, kind: e.lead ? 'melody' : 'chord', v: e.v, n, d: e.d + 0.3 });
        break;
      case 'choir':
        for (const n of e.n) out.push({ t: e.t, kind: 'pad', v: 1, n, d: e.d + 1 });
        break;
      case 'acid':
        for (const n of e.ns) out.push({ t: n.t, kind: 'bass', v: n.v, n: n.n, d: n.d });
        break;
      case 'perc':
        if (e.k === 'crash') out.push({ t: e.t, kind: 'impact', v: e.v * 0.4 });
        else if (e.k === 'conga' || e.k === 'congaHi' || e.k === 'bongo') {
          out.push({ t: e.t, kind: 'perc', v: e.v, n: e.n, d: 0.3 });
        }
        break;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export const v2: Engine = {
  version: 2,
  about: 'longer pieces, more instruments',
  styles: STYLE_IDS.map(styleInfo),
  lengths: [
    { id: 'standard', label: 'Standard, 3 to 4 minutes' },
    { id: 'short', label: 'Short, about 2 minutes' },
    { id: 'long', label: 'Long, 5 to 6 minutes' },
  ],
  song: (phrase, styles, length) => new Plan(phrase, styles, length),
  score(song, index): SectionScore {
    const p = plan(song);
    const s = composeSection(p.song, index);
    return {
      index: s.index,
      local: s.local,
      offset: s.offset,
      duration: s.duration,
      tail: s.tail,
      bpm: s.bpm,
      movement: p.info(s.movement),
      section: s.section,
      key: keyInfo(sectionKey(s.movement, s.local)),
      chords: s.chords,
      cues: cues(s.events),
    };
  },
  render: (song, index, sampleRate) => renderScore(composeSection(plan(song).song, index), sampleRate),
  renderSpan: (song, from, count, sampleRate, onSection) =>
    renderSpan(plan(song).song, from, count, sampleRate, onSection),
};
