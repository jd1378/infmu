import { assert, assertAlmostEquals, assertEquals, assertNotEquals } from '@std/assert';
import { composeSection, letGo } from '../../../src/engines/v2/compose/index.ts';
import { Ctx, sectionChords, sectionKey } from '../../../src/engines/v2/compose/context.ts';
import { LOUD_OPENINGS } from '../../../src/engines/v2/arcs.ts';
import { type Mood, moodModes, MOODS } from '../../../src/engines/v2/moods.ts';
import { OPEN_ENDS, SPACES } from '../../../src/engines/v2/styles.ts';
import { guitarist, PLAYERS } from '../../../src/engines/v2/compose/guitarist.ts';
import { conceit } from '../../../src/engines/v2/compose/conceits.ts';
import { treat } from '../../../src/engines/v2/compose/treatment.ts';
import { perform } from '../../../src/engines/v2/compose/perform.ts';
import { barSeconds, Song, stillnessOf } from '../../../src/engines/v2/plan.ts';
import { STYLE_IDS, STYLES } from '../../../src/engines/v2/styles.ts';
import { CATHEDRAL_TIMES, DRIFT_TIMES, EMBER_TIMES, GARDEN_TIMES } from '../../../src/engines/v2/compose/grooves.ts';
import { Bus } from '../../../src/engines/v2/synth/bus.ts';
import { freeverb, lufs } from '../../../src/engines/v2/synth/dsp.ts';
import { snare } from '../../../src/engines/v2/synth/instruments.ts';
import { piano } from '../../../src/engines/v2/synth/modal.ts';
import { balanceLift, early, melodyOffset, renderScore, tape } from '../../../src/engines/v2/synth/render.ts';
import { string } from '../../../src/engines/v2/synth/strings.ts';
import { wind } from '../../../src/engines/v2/synth/voice.ts';
import { engine } from '../../../src/engines/index.ts';
import { Rng } from '../../../src/engines/v2/rng.ts';
import { Clock, tempoAt } from '../../../src/engines/v2/tempo.ts';
import { mod, MODES, pc } from '../../../src/engines/v2/theory.ts';
import {
  type Arc,
  BEATS,
  type Ev,
  isMelody,
  type Role,
  STRONGS,
  type StyleId,
  TAKES,
} from '../../../src/engines/v2/types.ts';

Deno.test('movements run as long as the listener chose', () => {
  const bounds = { short: [95, 175], standard: [165, 265], long: [265, 400] } as const;
  for (const length of ['short', 'standard', 'long'] as const) {
    for (const style of STYLE_IDS) {
      // post-rock runs longer than the chosen length (see StyleDef.stretch)
      const [lo, hi] = bounds[length].map((x) => x * (STYLES[style].stretch ?? 1));
      const song = new Song(`length-${style}`, [style], length);
      for (let m = 0; m < 8; m++) {
        const d = song.movement(m).duration;
        assert(d >= lo && d <= hi, `${length} ${style} movement ${m} is ${d.toFixed(0)} s`);
      }
    }
  }
});

Deno.test('a fading or paused hand-over ends in a rest', () => {
  const song = new Song('rests');
  let rests = 0;
  for (let m = 0; m < 30; m++) {
    const mv = song.movement(m);
    const last = mv.sections[mv.sections.length - 1];
    assertEquals(last.role === 'rest', mv.transition === 'pause' || mv.transition === 'fade');
    if (last.role !== 'rest') continue;
    rests++;
    const seconds = last.bars * barSeconds(mv);
    assert(seconds >= 0.75 && seconds <= 3.7, `rest of ${seconds.toFixed(1)} s`);
    const score = composeSection(song, mv.firstSection + mv.sections.length - 1);
    assertEquals(score.events.length, 0);
  }
  assert(rests > 10, `only ${rests} rests in 30 movements`);
});

Deno.test('a written silence is silent, and nothing new starts inside it', () => {
  // find a section with a gap that also stops the room, and render it
  const song = new Song('silence');
  for (let i = 0; i < 400; i++) {
    const s = composeSection(song, i);
    const gap = s.events.find((e): e is Extract<Ev, { i: 'gap' }> => e.i === 'gap' && !e.room && e.d > 0.3);
    if (!gap) continue;
    for (const e of s.events) {
      if (e.i === 'gap' || e.i === 'vinyl') continue;
      assert(!(e.t >= gap.t + 1e-6 && e.t < gap.t + gap.d - 1e-6), `${e.i} starts inside a silence`);
    }
    const sr = 8000;
    const r = renderScore(s, sr);
    let peak = 0;
    for (let k = Math.round((gap.t + 0.15) * sr); k < Math.round((gap.t + gap.d - 0.01) * sr); k++) {
      peak = Math.max(peak, Math.abs(r.left[k]), Math.abs(r.right[k]));
    }
    assert(peak < 1e-4, `the silence peaks at ${peak}`);
    return;
  }
  throw new Error('no room-stopping silence found in 400 sections');
});

Deno.test('a lifted last chorus changes key, and its melody follows', () => {
  for (let seed = 0; seed < 40; seed++) {
    const song = new Song(`lift-${seed}`, ['pulse']);
    const mv = song.movement(0);
    const local = mv.sections.findIndex((s) => s.shift > 0);
    if (local < 0) continue;
    const key = sectionKey(mv, local);
    assertNotEquals(key.tonic, mv.key.tonic);
    const s = composeSection(song, mv.firstSection + local);
    const scale = MODES[key.mode].map((x) => (x + key.tonic) % 12);
    for (const e of s.events) {
      if (e.i !== 'lead' && e.i !== 'wind') continue;
      for (const n of e.ns) {
        const chord = s.chords.find((c) => n.t >= c.t - 1e-6 && n.t < c.t + c.d - 1e-6) ?? s.chords[0];
        assert(scale.includes(pc(n.n)) || chord.pcs.includes(pc(n.n)), `note ${n.n} outside the lifted key`);
      }
    }
    return;
  }
  throw new Error('no lifted movement found');
});

Deno.test('every instrument renders finite audio', () => {
  const base = composeSection(new Song('instruments', ['drift']), 1);
  const notes = [60, 64, 67, 72].map((n, i) => ({ t: 0.1 + i * 0.3, d: 0.25, n, v: 0.8 }));
  const events: Ev[] = [
    ...(['guitar', 'harp', 'electric', 'overdrive'] as const).map((k, i) =>
      ({ i: 'string', t: i * 0.4, n: 52 + i * 5, v: 0.8, k, d: 0.3 }) as Ev
    ),
    ...(['marimba', 'vibes', 'kalimba'] as const).map((k, i) => ({ i: 'mallet', t: i * 0.4, n: 67, v: 0.8, k }) as Ev),
    ...(['conga', 'congaHi', 'bongo', 'cowbell', 'ride', 'crash', 'snap'] as const).map((k, i) =>
      ({ i: 'perc', t: i * 0.2, v: 0.8, k }) as Ev
    ),
    ...(['flute', 'sax', 'hum'] as const).map((k) => ({ i: 'wind', t: 0.1, k, ns: notes }) as Ev),
    ...(['a', 'o', 'u', 'm'] as const).map((vowel) => ({ i: 'choir', t: 0, d: 1, n: [60, 64, 67], vowel }) as Ev),
    { i: 'piano', t: 0, d: 1, n: [48, 60, 64, 67], v: 0.7 },
    { i: 'bass', t: 0, d: 1, n: 36, v: 0.8, k: '808' },
    {
      i: 'acid',
      t: 0.1,
      ns: notes.map((n, i) => ({ ...n, n: n.n - 24, accent: i % 2 === 0, slide: i === 1 })),
      cut: [300, 2000],
      res: 0.9,
      env: 1,
    },
  ];
  const r = renderScore({ ...base, events: events.sort((a, b) => a.t - b.t), duration: 3, tail: 2 }, 16000);
  let peak = 0;
  for (let i = 0; i < r.left.length; i++) {
    assert(Number.isFinite(r.left[i]) && Number.isFinite(r.right[i]));
    peak = Math.max(peak, Math.abs(r.left[i]));
  }
  assert(peak > 0.01 && peak < 1);
});

Deno.test('sections of the same role in a row continue one arc instead of starting over', () => {
  let runs = 0;
  for (let seed = 0; seed < 120 && runs < 12; seed++) {
    for (const style of ['rise', 'acid', 'ember'] as const) {
      const song = new Song(`arc-${seed}`, [style]);
      const mv = song.movement(0);
      mv.sections.forEach((sec, k) => {
        if (k === 0 || sec.role !== mv.sections[k - 1].role || !['intro', 'build', 'outro'].includes(sec.role)) return;
        runs++;
        const a = composeSection(song, mv.firstSection + k - 1);
        const b = composeSection(song, mv.firstSection + k);
        // pad filters pick up where they left off (per pad sound: guest colours may add pads of their own)
        const pads = (x: typeof a) => x.events.filter((e): e is Extract<Ev, { i: 'pad' }> => e.i === 'pad');
        for (const k of new Set(pads(a).map((p) => p.k))) {
          const pa = pads(a).filter((p) => p.k === k);
          const pb = pads(b).filter((p) => p.k === k);
          // only pads that move as one arc (each chord starting where the last one stopped); some swell per chord
          const arc = pa.every((p, i) => i === 0 || Math.abs(pa[i - 1].cut[1] - p.cut[0]) / p.cut[0] < 0.05);
          if (!pa.length || !pb.length || !arc || pa[0].cut[0] === pa[pa.length - 1].cut[1]) continue;
          const end = pa[pa.length - 1].cut[1];
          const start = pb[0].cut[0];
          assert(
            Math.abs(start - end) / end < 0.05,
            `${style} ${sec.role} ${k}: filter jumps ${end.toFixed(0)} -> ${start.toFixed(0)}`,
          );
        }
        // one riser in parts: the second part starts where the first stopped
        const riseA = a.events.find((e): e is Extract<Ev, { i: 'rise' }> => e.i === 'rise' && e.k !== 'cymbal');
        const riseB = b.events.find((e): e is Extract<Ev, { i: 'rise' }> => e.i === 'rise' && e.k !== 'cymbal');
        if (riseA && riseB) assert(Math.abs((riseA.x1 ?? 1) - (riseB.x0 ?? 0)) < 1e-9, `${style}: riser restarts`);
      });
    }
  }
  assert(runs >= 3, `only ${runs} repeated parts found`);
});

Deno.test('the melody sits a set distance under the band, however dense the band is', () => {
  const sr = 8000;
  // undo the section's leveling to compare the renders before the master
  const raw = (s: Parameters<typeof renderScore>[0]) => {
    const r = renderScore(s, sr);
    return [r.left.map((x) => x / r.gain), r.right.map((x) => x / r.gain)] as const;
  };
  let checked = 0;
  for (const style of ['pulse', 'haze', 'drift'] as const) {
    const song = new Song(`ride-${style}`, [style]);
    for (let i = 0; i < 40 && checked < 6; i++) {
      const composed = composeSection(song, i);
      // the ride works on the dry signal: measure it dry (no room, no echoes); loud parts reach the compressor
      const s = {
        ...composed,
        movement: { ...composed.movement, mix: { ...composed.movement.mix, reverb: 0, delayWet: 0 } },
      };
      if (!s.events.some(isMelody) || s.section.energy > 0.7) continue;
      const band = { ...s, events: s.events.filter((e) => !isMelody(e)) };
      const [bl, br] = raw(band);
      const [fl, fr] = raw(s);
      const offset = lufs(sr, fl.map((x, k) => x - bl[k]), fr.map((x, k) => x - br[k])) - lufs(sr, bl, br);
      const alone = renderScore({ ...s, events: s.events.filter(isMelody) }, sr).lufs;
      const need = renderScore(band, sr).lufs + melodyOffset(s.section.energy) - alone;
      if (need < -3 || need > 12) continue; // beyond what the ride may do
      assert(
        Math.abs(offset - melodyOffset(s.section.energy)) < 1,
        `${style} ${s.section.role}: ${offset.toFixed(1)} LU`,
      );
      checked++;
    }
  }
  assert(checked >= 3, `only ${checked} sections checked`);
});

Deno.test("a piece tells one of its style's arcs: seldom the one before, and a loud opening only after a pause", () => {
  const BIG: readonly Role[] = ['chorus', 'drop'];
  const seen = new Map<StyleId, Set<Arc>>();
  let twice = 0;
  for (let k = 0; k < 40; k++) {
    const song = new Song(`arcs-${k}`);
    for (let m = 0; m < 12; m++) {
      const mv = song.movement(m);
      const prev = m ? song.movement(m - 1) : null;
      const at = `${mv.style} ${mv.arc}`;
      assert(STYLES[mv.style].arcs.includes(mv.arc), at);
      seen.set(mv.style, (seen.get(mv.style) ?? new Set()).add(mv.arc));
      // (only when its form can tell no other: one with no early big part, after a fade)
      if (mv.arc === prev?.arc) twice++;
      if (LOUD_OPENINGS.has(mv.arc)) assert(prev && prev.transition !== 'fade', `${at} opens loud after a fade`);
      const s = mv.sections.filter((x) => x.role !== 'rest');
      const e = s.map((x) => x.energy);
      const total = s.reduce((n, x) => n + x.bars, 0);
      const pos = s.map((_, i) => s.slice(0, i).reduce((n, x) => n + x.bars, 0) / total);
      const bigs = s.map((x, i) => (BIG.includes(x.role) ? i : -1)).filter((i) => i >= 0);
      const peak = e.indexOf(1);
      assert(peak >= 0, `${at}: no peak`);
      if (mv.arc === 'climb') assert(e[0] < 0.5 && e[bigs.at(-1)!] === 1, `${at}: ${e}`);
      if (mv.arc === 'cold') assert(BIG.includes(s[0].role) && e[0] >= 0.6 && e[bigs.at(-1)!] === 1, `${at}: ${e}`);
      if (mv.arc === 'lastWord') {
        assert(BIG.includes(s.at(-1)!.role) && e.at(-1) === 1, `${at} ends on ${s.at(-1)!.role}`);
        assertEquals(mv.transition, 'pause');
      }
      if (mv.arc === 'early') {
        assert(pos[peak] < 0.6, `${at} peaks at ${pos[peak].toFixed(2)}`);
        for (const i of bigs.filter((i) => i > peak)) assert(s[i].treatment === 'hushed' && e[i] <= 0.5, at);
      }
      if (mv.arc === 'plateau') {
        // (but for a surprise's sudden hush)
        s.forEach((x, i) =>
          assert(x.role === 'intro' || x.role === 'outro' || x.treatment || e[i] >= 0.55, `${at}: ${e}`)
        );
      }
      if (mv.arc === 'dissolve') {
        assert(e[0] === 1 && e.every((x, i) => !i || x <= e[i - 1]), `${at}: ${e}`);
        assertEquals(s.at(-1)!.treatment, 'bare');
      }
    }
  }
  for (const id of STYLE_IDS) assertEquals(seen.get(id)?.size, STYLES[id].arcs.length, `${id} arcs heard`);
  assert(twice <= 5, `${twice} arcs told twice running`);
});

Deno.test('pieces tell different stories: where they peak, how they start and end', () => {
  const pieces: { peak: number; start: number; end: number }[] = [];
  for (let k = 0; k < 60; k++) {
    const song = new Song(`stories-${k}`);
    for (let m = 0; m < 12; m++) {
      const s = song.movement(m).sections.filter((x) => x.role !== 'rest');
      const total = s.reduce((n, x) => n + x.bars, 0);
      const i = s.findIndex((x) => x.energy === 1);
      pieces.push({
        peak: (s.slice(0, i).reduce((n, x) => n + x.bars, 0) + s[i].bars / 2) / total,
        start: s[0].energy,
        end: s.at(-1)!.energy,
      });
    }
  }
  const share = (f: (p: typeof pieces[0]) => boolean) => pieces.filter(f).length / pieces.length;
  // one arc for every piece peaked in its last 40% (99%), and none started or ended loud
  assert(share((p) => p.peak < 0.6) >= 0.2, `${share((p) => p.peak < 0.6)} peak early`);
  assert(share((p) => p.start >= 0.6) >= 0.1, `${share((p) => p.start >= 0.6)} start loud`);
  assert(share((p) => p.end >= 0.6) >= 0.08, `${share((p) => p.end >= 0.6)} end loud`);
});

Deno.test('a hushed section plays without its rhythm section, a bare one only its tune over the bed; the last word ends on a hit', () => {
  const rhythm = new Set(['kick', 'snare', 'hat', 'tom', 'perc', 'bass', 'acid', 'impact', 'rise', 'sweep']);
  const bed = new Set(['pad', 'organ', 'drone', 'choir', 'vinyl', 'breath', 'gap']);
  const found = { hushed: 0, bare: 0, lastWord: 0 };
  for (let k = 0; k < 12 && (found.hushed < 3 || found.bare < 2 || found.lastWord < 3); k++) {
    const song = new Song(`treated-${k}`);
    for (let m = 0; m < 8; m++) {
      const mv = song.movement(m);
      mv.sections.forEach((sec, i) => {
        const last = mv.arc === 'lastWord' && i === mv.sections.findLastIndex((x) => x.role !== 'rest');
        if (!sec.treatment && !last) return;
        const score = composeSection(song, mv.firstSection + i);
        if (sec.treatment === 'hushed') {
          found.hushed++;
          assert(
            score.events.every((e) => !rhythm.has(e.i) && !(e.i === 'string' && e.k === 'overdrive')),
            `${mv.style}: a hushed ${sec.role} kept ${[
              ...new Set(score.events.filter((e) => rhythm.has(e.i)).map((e) => e.i)),
            ]}`,
          );
        }
        if (sec.treatment === 'bare') {
          found.bare++;
          // (and the hand-over into the next piece)
          const handOver = (e: Ev) => e.i === 'rise' && e.k === 'swell';
          assert(
            // (a counter-line is a tune too, and chords swelled in on a guitar a bed)
            score.events.every((e) =>
              ('lead' in e && e.lead !== undefined) || bed.has(e.i) || (e.i === 'string' && e.swell !== undefined) ||
              handOver(e)
            ),
            `${mv.style}: a bare ${sec.role}`,
          );
        }
        if (last) {
          found.lastWord++;
          // the band's last downbeat, with a crash, and nothing new after its first beat
          const from = score.bars[score.bars.length - 2];
          const beat = 60 / mv.bpm;
          assert(score.events.some((e) => e.i === 'perc' && /rash/.test(e.k) && Math.abs(e.t - from) < 0.08));
          const after = score.events.filter((e) => e.t > from + 1.5 * beat && e.i !== 'gap' && e.i !== 'vinyl');
          assertEquals(after.map((e) => e.i), [], `${mv.style}: plays on after its last hit`);
        }
      });
    }
  }
  assert(found.hushed >= 3 && found.bare >= 2 && found.lastWord >= 3, JSON.stringify(found));
});

Deno.test('every chorus of a movement restates the same hook on the same voice', () => {
  const voiceOf = (e: Ev) => `${e.i}:${'k' in e ? e.k : ''}`;
  // the lead of the first chorus (never doubled) is the voice later choruses must keep
  const lead = (s: ReturnType<typeof composeSection>, keep?: string) => {
    const mel = s.events.filter(isMelody);
    if (!mel.length) return null;
    const voice = keep && mel.some((e) => voiceOf(e) === keep) ? keep : voiceOf(mel[0]);
    const all = mel.filter((e) => voiceOf(e) === voice)
      .flatMap((
        e,
      ) => ('ns' in e ? e.ns.map((n) => [n.t, n.n]) : [[e.t, [(e as { n: number | number[] }).n].flat()[0]]]))
      .sort((a, b) => a[0] - b[0]);
    // a tremolo is one note however many strokes it takes (the tempo decides how many fit)
    const runs = all.filter(([t, n], i) => !(i && n === all[i - 1][1] && t - all[i - 1][0] < 0.25));
    const notes = runs
      // a grace note leaning into the next is how a return is played, not what it plays
      .filter(([t], i) => !(runs[i + 1] && runs[i + 1][0] - t < 0.1))
      .filter(([, n], i, kept) => !(i && n === kept[i - 1][1]))
      // the first four bars, to half a 16th before the fifth: written notes sit on the grid, performed ones move less
      .filter(([t]) => t < s.bars[4] - 60 / s.bpm / 8);
    // the first four bars as intervals (independent of a key lift; the ending may turn towards what comes next)
    return { voice, shape: notes.map((x, i, a) => (i ? x[1] - a[i - 1][1] : 0)).join(',') };
  };
  let checked = 0;
  for (const style of STYLE_IDS) {
    const song = new Song(`hook-${style}`, [style]);
    const mv = song.movement(0);
    const choruses = mv.sections.map((s, k) => [s, k] as const).filter(([s]) =>
      s.role === 'chorus' || s.role === 'drop'
    );
    const hooks: { voice: string; shape: string }[] = [];
    for (const [, k] of choruses) {
      const h = lead(composeSection(song, mv.firstSection + k), hooks[0]?.voice);
      if (h) hooks.push(h);
    }
    for (const h of hooks.slice(1)) {
      assertEquals([h.voice, h.shape], [hooks[0].voice, hooks[0].shape], `${style}: a chorus changed its tune`);
      checked++;
    }
  }
  assert(checked >= 5, `only ${checked} returning choruses checked`);
});

Deno.test('the concert pitch retunes every note', () => {
  const base = composeSection(new Song('tuning', ['drift']), 1);
  const a3: Ev[] = [{ i: 'bass', t: 0, d: 2, n: 57, v: 0.8, k: 'sub' }];
  for (const a4 of [440, 432]) {
    const sr = 16000;
    const r = renderScore({ ...base, events: a3, duration: 2.5, tail: 0.5 }, sr, a4);
    // the fundamental from rising zero crossings over the sustained second
    let crossings = 0;
    for (let i = sr * 0.5 + 1; i < sr * 1.5; i++) if (r.left[i - 1] < 0 && r.left[i] >= 0) crossings++;
    assert(Math.abs(crossings - a4 / 2) <= 2, `A3 at A4 = ${a4} Hz sounds at about ${crossings} Hz`);
  }
});

Deno.test('pieces of one style groove differently', () => {
  // every drum, percussion and bass hit of the first chorus or drop's first bar, on a 16th grid
  const groove = (s: ReturnType<typeof composeSection>) => {
    const s16 = 60 / s.bpm / 4;
    const lanes = new Map<string, string[]>();
    for (const e of s.events) {
      if (!['kick', 'snare', 'hat', 'perc', 'tom', 'bass'].includes(e.i) || e.t >= 16 * s16) continue;
      const lane = `${e.i}:${'k' in e ? e.k : ''}`;
      const cells = lanes.get(lane) ?? Array(16).fill('.');
      cells[Math.round(e.t / s16)] = 'x';
      lanes.set(lane, cells);
    }
    return [...lanes.entries()].sort().map(([k, v]) => `${k}=${v.join('')}`).join('|');
  };
  for (const style of ['rise', 'acid', 'pulse', 'haze', 'garden', 'ember', 'cathedral'] as const) {
    const grooves = new Set<string>();
    for (let seed = 0; seed < 10; seed++) {
      const song = new Song(`groove-${style}-${seed}`, [style]);
      const mv = song.movement(0);
      const k = mv.sections.findIndex((s) => s.role === 'chorus' || s.role === 'drop');
      if (k >= 0) grooves.add(groove(composeSection(song, mv.firstSection + k)));
    }
    assert(grooves.size >= 3, `${style}: only ${grooves.size} different grooves in 10 pieces`);
  }
});

Deno.test('a part counts its returns, not its sections', () => {
  let runs = 0;
  for (let seed = 0; seed < 20; seed++) {
    const song = new Song(`turns-${seed}`);
    const mv = song.movement(0);
    const turns = new Map<string, number>();
    mv.sections.forEach((sec, k) => {
      const ctx = new Ctx(song, mv.firstSection + k);
      const prev = mv.sections[k - 1];
      if (prev?.role === sec.role) {
        // the same run continues: same turn, one further in
        const before = new Ctx(song, mv.firstSection + k - 1);
        assertEquals(ctx.turn, before.turn);
        assertEquals(ctx.inRun, before.inRun + 1);
        assert(!before.runEnd);
        runs++;
      } else {
        assertEquals(ctx.inRun, 0);
        assertEquals(ctx.turn, turns.get(sec.role) ?? 0);
        turns.set(sec.role, ctx.turn + 1);
      }
      // the last full turn: a hushed return after it (an afterglow) doesn't count
      let end = k;
      while (mv.sections[end + 1]?.role === sec.role) end++;
      const later = mv.sections.slice(end + 1).some((s) => s.role === sec.role && !s.treatment);
      assertEquals(ctx.finalTurn, !sec.treatment && !later);
    });
  }
  assert(runs > 5, `only ${runs} continued runs`);
});

Deno.test('a movement opens quietly: no hit or bell on its first beat', () => {
  let landings = 0;
  for (let seed = 0; seed < 12; seed++) {
    const song = new Song(`opening-${seed}`);
    for (let m = 0; m < 4; m++) {
      const mv = song.movement(m);
      // a cold open starts on its big part, as loud as it means to be
      if (LOUD_OPENINGS.has(mv.arc)) continue;
      const first = composeSection(song, mv.firstSection).events.filter((e) => e.t < 0.1);
      const hits = first.filter((e) => e.i === 'impact' || e.i === 'bell');
      // only a reverse swell from the piece before lands on a soft downbeat
      const swell = m > 0 && song.movement(m - 1).transition === 'swell';
      if (swell) landings++;
      assert(
        hits.every((e) => swell && e.i === 'impact' && e.k === 'ping' && e.a <= 0.4),
        `${mv.style} opens with ${hits.map((e) => e.i).join(', ')}`,
      );
    }
  }
  assert(landings > 0, 'no swell hand-over found');
});

Deno.test('played parts are performed; the kick, the synth bass and the arpeggiator keep the grid', () => {
  const song = new Song('performance', ['pulse']);
  const mv = song.movement(0);
  const k = mv.sections.findIndex((s) => s.role === 'chorus');
  const s = composeSection(song, mv.firstSection + k);
  const s16 = 60 / s.bpm / 4;
  // swing moves odd 16ths on purpose: measure against even 16ths (8ths) only
  const onGrid = (t: number) => Math.abs(t / (2 * s16) - Math.round(t / (2 * s16))) * 2 * s16 < 1e-6;
  const onsets = (f: (e: Ev) => boolean) =>
    s.events.filter(f).flatMap((e) => ('ns' in e ? e.ns.map((n) => n.t) : [e.t]));
  const played = onsets((e) => ['string', 'piano', 'mallet', 'lead', 'wind'].includes(e.i));
  assert(played.length > 0 && played.filter(onGrid).length < played.length * 0.2, 'played parts are machine-exact');
  // synthwave's bass is a synth, sequenced like its arpeggios
  const tight = onsets((e) => e.i === 'kick' || e.i === 'bass' || e.i === 'pluck');
  assert(tight.length > 0 && tight.every((t) => onGrid(t) || onGrid(t + s16)), 'a sequenced part drifted');
  const velocities = new Set(
    s.events.filter((e) => ['string', 'piano', 'mallet'].includes(e.i)).map((e) => (e as { v: number }).v.toFixed(3)),
  );
  assert(velocities.size > 20, `only ${velocities.size} different velocities in the played parts`);
});

type Hit = Extract<Ev, { i: 'kick' | 'snare' | 'hat' | 'perc' | 'tom' }>;
const isHit = (e: Ev): e is Hit => ['kick', 'snare', 'hat', 'perc', 'tom'].includes(e.i);
/** Every section of the first movement of a one-style song. */
const sectionsOf = (seed: string, style: StyleId) => {
  const song = new Song(seed, [style]);
  const mv = song.movement(0);
  return mv.sections.map((_, k) => composeSection(song, mv.firstSection + k));
};

Deno.test("a drummer's strokes are never the same take twice in a row; a drum machine's are all one sample", () => {
  for (const style of ['ember', 'haze'] as const) {
    for (const s of sectionsOf(`takes-${style}`, style)) {
      const last = new Map<string, number>();
      for (const e of s.events.filter(isHit)) {
        assert(e.take !== undefined && e.take >= 0 && e.take < TAKES, `${style} ${e.i} without a take`);
        const part = `${e.i}:${e.i === 'tom' ? e.n : 'k' in e ? e.k : ''}`;
        assertNotEquals(last.get(part), e.take, `${style} ${part} repeats a take at ${e.t.toFixed(2)} s`);
        last.set(part, e.take);
      }
    }
  }
  for (const s of sectionsOf('takes-rise', 'rise')) assert(s.events.filter(isHit).every((e) => e.take === undefined));
});

Deno.test('takes of a stroke differ, a take is the same every time, and a softer stroke is darker', () => {
  const tone = new Song('strokes', ['ember']).movement(0).tone;
  const one = (e: Omit<Extract<Ev, { i: 'snare' }>, 'i'>) => {
    const b = new Bus(16000, 0.5, 1, tone);
    snare(b, { i: 'snare', ...e });
    return b.L;
  };
  const hit = { t: 0, v: 1, k: 'big' as const };
  assertEquals(one(hit), one(hit), 'a machine plays one sample');
  assertEquals(one({ ...hit, take: 2 }), one({ ...hit, take: 2 }), 'a take is fixed');
  assertNotEquals(one({ ...hit, take: 1 }), one({ ...hit, take: 2 }));
  // brightness: the share of the signal's power in its sample-to-sample differences
  const bright = (x: Float32Array) => {
    let d = 0;
    let p = 0;
    for (let i = 1; i < x.length; i++) {
      d += (x[i] - x[i - 1]) ** 2;
      p += x[i] ** 2;
    }
    return d / p;
  };
  const soft = bright(one({ ...hit, v: 0.3, take: 0 }));
  const hard = bright(one({ ...hit, v: 1, take: 0 }));
  assert(soft < hard * 0.8, `a ghost note is as bright as a backbeat (${soft.toFixed(3)} vs ${hard.toFixed(3)})`);
});

Deno.test('a drummer plays ghost notes well under the backbeat, and each limb where the feel puts it', () => {
  // lo-fi's grooves are full of ghost notes
  const snares = [0, 1, 2, 3].flatMap((k) => sectionsOf(`feel-haze-${k}`, 'haze'))
    .flatMap((s) => s.events.filter((e) => e.i === 'snare').map((e) => e.v))
    .sort((a, b) => a - b);
  const ghost = snares[Math.floor(snares.length * 0.1)] / snares[Math.floor(snares.length * 0.9)];
  assert(ghost < 0.3, `ghost notes are ${ghost.toFixed(2)} of the backbeat`);
  // downtempo's shaker drives ahead of the kick and its backbeat leans back
  const song = new Song('feel-garden', ['garden']);
  const mv = song.movement(0);
  const sections = mv.sections.map((_, k) => composeSection(song, mv.firstSection + k));
  // against the written (and swung) grid: the band's tempo moves the grid itself
  const s16 = 60 / mv.bpm / 4;
  const swung = (step: number) => step * s16 + (step % 2 ? mv.swing * s16 : 0);
  const offsets = (f: (e: Ev) => boolean) =>
    sections.flatMap((s) => {
      const clock = new Clock(mv, s.local);
      return s.events.filter(f).map((e) => clock.written(e.t)).map((t) => {
        const step = [Math.floor(t / s16), Math.ceil(t / s16)].reduce((a, b) =>
          Math.abs(t - swung(b)) < Math.abs(t - swung(a)) ? b : a
        );
        return t - swung(step);
      });
    });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const kick = mean(offsets((e) => e.i === 'kick'));
  const hats = mean(offsets((e) => e.i === 'hat'));
  // the backbeat itself: not a flam's grace stroke just before another snare
  const flam = (e: Ev) =>
    sections.some((x) => x.events.some((o) => o.i === 'snare' && o.t - e.t > 0.012 && o.t - e.t < 0.035));
  const backbeat = mean(offsets((e) => e.i === 'snare' && !flam(e)));
  assert(hats < kick - 0.002, `hats ${((hats - kick) * 1000).toFixed(1)} ms from the kick`);
  assert(backbeat > kick + 0.003, `backbeat ${((backbeat - kick) * 1000).toFixed(1)} ms from the kick`);
});

Deno.test("a sequencer's tempo never moves", () => {
  for (const style of STYLE_IDS.filter((x) => !Object.values(STYLES[x].tempo).some(Boolean))) {
    const mv = new Song(`steady-${style}`, [style]).movement(0);
    mv.sections.forEach((sec, k) => {
      assert(new Clock(mv, k).steady, `${style} ${sec.role} moves`);
      assertEquals(sec.seconds, sec.bars * barSeconds(mv));
    });
  }
});

Deno.test('a band pushes into its peak and slows into the end of a piece', () => {
  let ended = 0;
  for (let m = 0; m < 12; m++) {
    const mv = new Song('breathing', ['ember']).movement(m);
    const tempo = (k: number) => tempoAt(mv, k, mv.sections[k].bars / 2);
    const verse = mv.sections.findIndex((x) => x.role === 'verse');
    const peak = mv.sections.findIndex((x) => x.energy === 1);
    assert(tempo(peak) > tempo(verse) * 1.015, `movement ${m}: the peak runs no faster than a verse`);
    if (mv.transition !== 'pause' && mv.transition !== 'fade') continue;
    ended++;
    const last = mv.sections.findLastIndex((x) => x.role !== 'rest');
    const end = tempoAt(mv, last, mv.sections[last].bars);
    assert(end < 0.75, `movement ${m} ends at ${(end * 100).toFixed(0)}% of its tempo`);
    // the ritardando is gradual: half-way through its last bar it's only part of the way down
    assert(tempoAt(mv, last, mv.sections[last].bars - 0.5) > end + 0.05);
  }
  assert(ended > 3, `only ${ended} endings`);
});

Deno.test("every part follows the section's clock", () => {
  const song = new Song('clock', ['nocturne']);
  const mv = song.movement(0);
  const k = mv.sections.findLastIndex((x) => x.role !== 'rest');
  const s = composeSection(song, mv.firstSection + k);
  const clock = new Clock(mv, k);
  assert(!clock.steady && s.duration > s.section.bars * barSeconds(mv), 'the last bars are not drawn out');
  assertEquals(s.duration, mv.sections[k].seconds);
  for (const t of [0.3, 5, 17.2, s.duration + 2]) assertAlmostEquals(clock.written(clock.at(t)), t, 1e-9);
  assert(Math.abs(s.bars[s.bars.length - 1] - s.duration) < 1e-9);
  // bar lines spread out as the piece slows
  const lengths = s.bars.slice(1).map((x, i) => x - s.bars[i]);
  assert(lengths[lengths.length - 1] > lengths[0] * 1.2);
  // a chord change still lands on its bar line
  for (const c of s.chords) assert(s.bars.some((x) => Math.abs(x - c.t) < 1e-9), `a chord at ${c.t.toFixed(3)} s`);
  // and the movement's length is the sum of its sections' played lengths
  const sum = mv.sections.reduce((n, x) => n + x.seconds, 0);
  assert(Math.abs(sum - mv.duration) < 1e-9);
});

Deno.test('a returning melody is ornamented with grace notes; its first statement and a sequencer never are', () => {
  const graces = (s: ReturnType<typeof composeSection>) => {
    const ts = s.events.filter(isMelody).flatMap((e) => ('ns' in e ? e.ns.map((n) => n.t) : [e.t])).sort((a, b) =>
      a - b
    );
    return ts.filter((t, i) => ts[i + 1] !== undefined && ts[i + 1] - t > 0.03 && ts[i + 1] - t < 0.1).length;
  };
  let returning = 0;
  for (const style of ['haze', 'nocturne', 'ember', 'garden'] as const) {
    const song = new Song(`graces-${style}`, [style]);
    const mv = song.movement(0);
    mv.sections.forEach((_, k) => {
      const ctx = new Ctx(song, mv.firstSection + k);
      const n = graces(composeSection(song, mv.firstSection + k));
      if (!ctx.returning) assertEquals(n, 0, `${style} ${ctx.role} ornaments its first statement`);
      else returning += n;
    });
  }
  assert(returning >= 4, `only ${returning} grace notes in returning parts`);
  for (const s of sectionsOf('graces-acid', 'acid')) assertEquals(graces(s), 0);
});

Deno.test('the band listens: softer under the melody, fuller in its rests, swelling into a bigger part', () => {
  // a piece with a part that leads into a much bigger one
  const jump = (mv: ReturnType<Song['movement']>) =>
    mv.sections.findIndex((s, i) => mv.sections[i + 1] && mv.sections[i + 1].energy - s.energy > 0.2);
  const song = [...Array(20).keys()].map((k) => new Song(`listening-${k}`, ['garden'])).find((x) =>
    jump(x.movement(0)) >= 0
  )!;
  const mv = song.movement(0);
  const k = jump(mv);
  const ctx = new Ctx(song, mv.firstSection + k);
  ctx.events.length = 0;
  // a melody note in every other bar, and a chord on every beat under it all
  for (let b = 0; b < ctx.bars; b += 2) {
    ctx.push({
      i: 'wind',
      t: ctx.barAt(b),
      k: 'flute',
      ns: [{ t: ctx.barAt(b), d: ctx.bar * 0.9, n: 72, v: 0.8 }],
      lead: true,
    });
  }
  for (let q = 0; q < ctx.bars * 4; q++) {
    ctx.push({ i: 'piano', t: q * ctx.beat, d: ctx.beat / 2, n: [60, 64, 67], v: 0.5 });
  }
  perform(ctx);
  const piano = ctx.events.filter((e): e is Extract<Ev, { i: 'piano' }> => e.i === 'piano');
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const bar = (e: Ev) => Math.floor((e.t + 0.05) / ctx.bar);
  const early = piano.filter((e) => bar(e) < ctx.bars - 2);
  const under = mean(early.filter((e) => bar(e) % 2 === 0).map((e) => e.v));
  const rests = mean(early.filter((e) => bar(e) % 2 === 1).map((e) => e.v));
  assert(under < rests * 0.8, `under the melody ${under.toFixed(2)}, in its rests ${rests.toFixed(2)}`);
  const last = piano.filter((e) => bar(e) === ctx.bars - 1).sort((a, b) => a.t - b.t);
  assert(last[last.length - 1].v > last[0].v * 1.1, 'no swell into the bigger part');
});

Deno.test('a slow piece is pedalled: the left hand rings to the next chord; a groove is not', () => {
  const held = (style: StyleId) => {
    let rings = 0;
    let all = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      for (const s of sectionsOf(`pedal-${seed}`, style)) {
        const next = (t: number) => s.chords.find((c) => c.t > t + 0.1)?.t ?? s.duration;
        for (const e of s.events) {
          if (e.i !== 'piano' || isMelody(e)) continue;
          all++;
          if (e.t + e.d >= next(e.t) - 1e-6) rings++;
        }
      }
    }
    assert(all > 20, `only ${all} ${style} piano notes`);
    return rings / all;
  };
  assert(held('nocturne') > 0.95, `only ${(held('nocturne') * 100).toFixed(0)}% of nocturne's piano rings on`);
  assert(held('haze') < 0.5, "lo-fi's comping is pedalled");
});

Deno.test('a guitarist hammers on, slides and squeaks; flams and fills vary on a drummed kit', () => {
  const all = ['ember', 'haze', 'garden'].flatMap((style) =>
    [0, 1, 2].flatMap((k) => sectionsOf(`fret-${style}-${k}`, style as StyleId))
  );
  const strings = all.flatMap((s) => s.events.filter((e): e is Extract<Ev, { i: 'string' }> => e.i === 'string'));
  assert(strings.some((e) => e.slur) && strings.some((e) => e.slide) && strings.some((e) => e.squeak));
  assert(strings.every((e) => e.k !== 'harp' || (!e.slur && !e.slide && !e.squeak)));
  // a flam: a soft stroke of the same drum 18 to 30 ms before a loud one
  const flams = (sections: ReturnType<typeof composeSection>[]) =>
    sections.flatMap((s) => {
      const sn = s.events.filter((e) => e.i === 'snare') as { t: number; v: number }[];
      return sn.filter((a) => sn.some((b) => b.t - a.t > 0.017 && b.t - a.t < 0.031 && a.v < b.v * 0.5));
    }).length;
  assert(flams(sectionsOf('flams', 'ember')) > 0);
  assertEquals(flams(sectionsOf('flams', 'rise')), 0);
  // the fills of a drummed movement are not all the same
  const song = new Song('fills', ['ember']);
  const mv = song.movement(0);
  const s16 = 60 / mv.bpm / 4;
  const fills = new Set<string>();
  mv.sections.forEach((sec, k) => {
    if (sec.role !== 'chorus' && sec.role !== 'drop' && sec.role !== 'verse') return;
    const s = composeSection(song, mv.firstSection + k);
    const clock = new Clock(mv, k);
    const ctx = new Ctx(song, mv.firstSection + k);
    for (let b = 0; b < sec.bars; b++) {
      if (ctx.runBar(b) % 8 !== 7) continue;
      const steps = s.events.filter((e) => (e.i === 'snare' || e.i === 'tom') && (e as { v: number }).v > 0.2)
        .map((e) => Math.round(clock.written(e.t) / s16) - b * 16).filter((x) => x >= 0 && x < 16);
      fills.add([...new Set(steps)].sort((x, y) => x - y).join(','));
    }
  });
  assert(fills.size > 1, `every fill is ${[...fills][0]}`);
});

Deno.test('a slide glides onto its note; a long wind note swells', () => {
  const tone = new Song('slide', ['ember']).movement(0).tone;
  const sr = 22050;
  const guitar = (slide?: number) => {
    const b = new Bus(sr, 1.5, 3, tone);
    string(b, { i: 'string', t: 0.2, n: 57, v: 0.8, k: 'guitar', d: 1, slide });
    return b.L.map((x, i) => x + b.ML[i]);
  };
  const pitch = (x: Float32Array, at: number) => {
    const a = Math.round(at * sr);
    let best = 0;
    let lag = 0;
    for (let L = Math.round(sr / 400); L < Math.round(sr / 150); L++) {
      let c = 0;
      let e = 0;
      for (let i = a; i < a + Math.round(0.03 * sr); i++) {
        c += x[i] * x[i + L];
        e += x[i + L] ** 2;
      }
      if (c / Math.sqrt(e + 1e-12) > best) [best, lag] = [c / Math.sqrt(e + 1e-12), L];
    }
    return sr / lag;
  };
  const plain = guitar();
  const slid = guitar(-2);
  assert(pitch(slid, 0.205) < pitch(plain, 0.205) * 0.95, 'the slide starts on its note');
  assertAlmostEquals(pitch(slid, 0.5), pitch(plain, 0.5), 1);
  const b = new Bus(sr, 3, 5, tone);
  wind(b, { i: 'wind', t: 0.1, k: 'sax', ns: [{ t: 0.1, d: 2.4, n: 65, v: 0.7 }] });
  const rms = (a: number, z: number) => {
    let e = 0;
    for (let i = Math.round(a * sr); i < Math.round(z * sr); i++) e += b.ML[i] ** 2;
    return Math.sqrt(e / ((z - a) * sr));
  };
  assert(rms(1.9, 2.2) > rms(0.3, 0.6) * 1.12, 'a long note stays flat');
});

Deno.test("a pianist's phrase breathes, the tune sounds ahead of the chords, and the left hand leans on its bass", () => {
  const song = new Song('pianist', ['nocturne']);
  const mv = song.movement(0);
  const k = mv.sections.findIndex((s) => s.role === 'bridge' || s.role === 'intro');
  const tempo = Array.from({ length: mv.sections[k].bars * 16 + 1 }, (_, j) => tempoAt(mv, k, j / 16));
  assert(Math.max(...tempo) / Math.min(...tempo) > 1.15, 'a calm phrase keeps one tempo');
  const written = mv.sections[k].bars * barSeconds(mv);
  assert(Math.abs(mv.sections[k].seconds / written - 1) < 0.03, 'rubato stole time it never gave back');

  const verse = mv.sections.findIndex((s) => s.role === 'verse');
  const s = composeSection(song, mv.firstSection + verse);
  const clock = new Clock(mv, verse);
  const pianos = s.events.filter((e): e is Extract<Ev, { i: 'piano' }> => e.i === 'piano');
  const tune = pianos.filter(isMelody);
  const chords = pianos.filter((e) => !isMelody(e));
  const leads = tune.flatMap((m) => {
    const near = chords.filter((c) => Math.abs(c.t - m.t) < 0.06);
    return near.length ? [m.t - Math.min(...near.map((c) => c.t))] : [];
  });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert(
    leads.length > 3 && mean(leads) < -0.01,
    `the tune leads the chords by ${(-mean(leads) * 1000).toFixed(0)} ms`,
  );
  const bar = barSeconds(mv);
  const down = chords.filter((e) => {
    const w = clock.written(e.t) / bar;
    return Math.abs(w - Math.round(w)) * bar < 0.06;
  });
  assert(mean(down.map((e) => e.v)) > mean(chords.map((e) => e.v)) * 1.15, 'the bass note is played like the rest');
});

Deno.test('a recording has a noise floor that never steps between sections; a digital production is silent', () => {
  const sr = 16000;
  const silent = (song: Song, i: number) => renderScore({ ...composeSection(song, i), events: [] }, sr);
  const song = new Song('floor', ['nocturne']);
  const mv = song.movement(0);
  const [a, b] = [1, 2].map((k) => ({
    s: composeSection(song, mv.firstSection + k),
    r: silent(song, mv.firstSection + k),
  }));
  // the first section's tail overlaps the second's start, as the player plays them
  const at = (t: number) => {
    const i = Math.round(t * sr);
    const j = Math.round((t - a.s.duration) * sr);
    return (a.r.left[i] ?? 0) + (j >= 0 ? b.r.left[j] : 0);
  };
  const db = (from: number) => {
    let e = 0;
    for (let t = from; t < from + 0.1; t += 1 / sr) e += at(t) ** 2;
    return 10 * Math.log10(e / (0.1 * sr));
  };
  const level = mv.mix.hiss!;
  for (const t of [-0.6, -0.1, 0.05, 0.12, 0.6]) {
    assertAlmostEquals(db(a.s.duration + t), level, 2, `a step in the noise floor at ${t} s from the boundary`);
  }
  const rise = new Song('floor', ['rise']);
  const r = silent(rise, rise.movement(0).firstSection + 1);
  assert(r.left.every((x) => x === 0), 'a digital production has a noise floor');
});

Deno.test('the room answers with early reflections, different on each side; the tape adds little', () => {
  const sr = 22050;
  const tone = new Song('room', ['nocturne']).movement(0).tone;
  const b = new Bus(sr, 0.2, 1, tone);
  b.REV[0] = 1;
  early(b, { size: 1, early: 0.6 });
  const onset = (x: Float32Array) => x.findIndex((v) => Math.abs(v) > 1e-4) / sr;
  assert(onset(b.L) > 0.005 && onset(b.L) < 0.01 && onset(b.R) > 0.005 && onset(b.R) < 0.01);
  assert(Math.abs(onset(b.L) - onset(b.R)) > 0.0005, 'both ears hear the first reflection at once');
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let i = 0; i < b.n; i++) {
    lr += b.L[i] * b.R[i];
    ll += b.L[i] ** 2;
    rr += b.R[i] ** 2;
  }
  assert(Math.abs(lr / Math.sqrt(ll * rr)) < 0.5, 'both sides hear the same reflections');
  const later = new Bus(sr, 0.2, 1, tone);
  later.REV[0] = 1;
  early(later, { size: 1.6, early: 0.6 });
  assert(onset(later.L) > onset(b.L) * 1.4, 'a bigger room answers no later');
  // a full-scale sine through the tape at full warmth: its harmonics stay under 3%
  const warm = tape(1);
  const N = 4800;
  const x = Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * i) / 48));
  const y = x.map(warm);
  const fund = (2 / N) * y.reduce((s, v, i) => s + v * x[i], 0);
  const mean = y.reduce((s, v) => s + v, 0) / N;
  const rest = Math.sqrt(y.reduce((s, v, i) => s + (v - mean - fund * x[i]) ** 2, 0) / N);
  assert(rest / (fund / Math.SQRT2) < 0.03, `the tape distorts ${((100 * rest) / (fund / Math.SQRT2)).toFixed(1)}%`);
});

Deno.test('a piano is heard by two microphones, and its pedal wakes the strings that match its notes', () => {
  const tone = new Song('two-mics', ['nocturne']).movement(0).tone;
  const sr = 22050;
  const render = (pedal: boolean) => {
    const b = new Bus(sr, 5, 1, tone);
    piano(b, { i: 'piano', t: 0.1, d: 4, n: [64, 67, 72], v: 0.6, pedal });
    return b;
  };
  const band = (b: Bus, from: number, to: number) => {
    let mid = 0;
    let side = 0;
    for (let i = Math.round(from * sr); i < Math.round(to * sr); i++) {
      const l = b.L[i] + b.ML[i];
      const r = b.R[i] + b.MR[i];
      mid += ((l + r) / 2) ** 2;
      side += ((l - r) / 2) ** 2;
    }
    return { mid: 10 * Math.log10(mid), width: Math.sqrt(side / mid) };
  };
  const dry = render(false);
  const held = render(true);
  assert(band(dry, 0.1, 2).width > 0.1, 'a centred chord is heard in mono');
  // the sympathetic strings build from nothing and bloom in the tail
  assertAlmostEquals(band(held, 0.1, 0.12).mid, band(dry, 0.1, 0.12).mid, 0.1);
  assert(band(held, 3, 4).mid > band(dry, 3, 4).mid + 1.5, 'the pedal adds nothing to the tail');
  // and only a pedalled piece pedals
  const pedalled = (style: StyleId) =>
    sectionsOf(`two-mics-${style}`, style).some((x) => x.events.some((e) => e.i === 'piano' && e.pedal));
  assert(pedalled('nocturne') && !pedalled('haze'));
});

Deno.test('a journey moves on: never one style twice in a row, rarely back to the one before', () => {
  let back = 0;
  let count = 0;
  for (let k = 0; k < 6; k++) {
    const song = new Song(`journey-${k}`);
    for (let m = 1; m < 16; m++) {
      const [a, b] = [song.movement(m - 1), song.movement(m)];
      assert(a.style !== b.style, `${a.style} twice in a row`);
      if (m > 1 && song.movement(m - 2).style === b.style) back++;
      count++;
    }
  }
  assert(back / count < 0.12, `${back} of ${count} went straight back to the style before`);
  // a listener who allowed one style hears it every time
  const one = new Song('journey', ['nocturne']);
  for (let m = 0; m < 4; m++) assertEquals(one.movement(m).style, 'nocturne');
});

Deno.test('harmony: eight-chord phrases play through once, and a bridge may go away and come home', () => {
  let eight = 0;
  let away = 0;
  for (let k = 0; k < 100; k++) {
    const mv = new Song(`harmony-${k}`).movement(k % 5);
    if (mv.progressions.main.length === 8) {
      eight++;
      assertEquals(mv.barsPerChord, 1);
      const verse = mv.sections.findIndex((s) => s.role === 'verse' && s.bars === 8);
      if (verse >= 0) assertEquals(sectionChords(mv, verse).length, 8);
    }
    const bridge = mv.sections.findIndex((s) => s.role === 'bridge');
    if (bridge > 0 && mv.sections[bridge].shift - mv.sections[bridge - 1].shift === 5) {
      away++;
      const after = mv.sections.slice(bridge).findIndex((s) => s.role !== 'bridge') + bridge;
      assertEquals(mv.sections[after].shift % 12, mv.sections[bridge - 1].shift % 12, 'the piece never came home');
    }
  }
  assert(eight >= 5 && away >= 5, `${eight} eight-chord phrases, ${away} bridges away`);
});

Deno.test('a piece only has parts its style knows how to play', () => {
  for (const style of STYLE_IDS) {
    const known = new Set(STYLES[style].forms.flatMap((f) => f.split(' ').map((x) => x.split(':')[0])));
    known.add('rest');
    for (const length of ['short', 'standard', 'long'] as const) {
      const song = new Song(`parts-${style}`, [style], length);
      for (let m = 0; m < 4; m++) {
        for (const s of song.movement(m).sections) assert(known.has(s.role), `${style} ${length} plays a ${s.role}`);
      }
    }
  }
});

Deno.test('some pieces sway in three: waltzes and 6/8, with bars of three beats and tunes on them', () => {
  const seen = new Set<string>();
  for (const style of STYLE_IDS) {
    for (let k = 0; k < 24; k++) {
      const mv = new Song(`meter-${style}-${k}`, [style]).movement(0);
      if (!STYLES[style].meters.some(([m]) => m === mv.meter)) throw new Error(`${style} in ${mv.meter}`);
      seen.add(`${style} ${mv.meter}`);
    }
  }
  for (const s of ['nocturne 3/4', 'nocturne 6/8', 'garden 6/8', 'ember 6/8', 'cathedral 3/4', 'drift 6/8']) {
    assert(seen.has(s), `no ${s}`);
  }
  for (const s of ['rise', 'acid', 'pulse', 'haze']) assert(!seen.has(`${s} 3/4`) && !seen.has(`${s} 6/8`));
  // every groove in three fits its bar of twelve 16ths
  for (const banks of [DRIFT_TIMES, GARDEN_TIMES, EMBER_TIMES, CATHEDRAL_TIMES]) {
    for (const meter of ['3/4', '6/8'] as const) {
      for (const [g] of banks[meter] ?? []) {
        for (const bar of [g.light, g.full, g.fill, g.answer, g.layer]) {
          for (const lane of Object.values(bar ?? {})) assertEquals((lane as string).length, 12, `${g.name}`);
        }
        for (const [step, len] of [...g.bassLight, ...g.bassFull]) assert(step + len <= 12, `${g.name} bass`);
      }
    }
  }
  // a waltz: bar lines three beats apart, and its tune mostly on the beats
  let waltz: ReturnType<typeof composeSection> | undefined;
  for (let k = 0; k < 60 && !waltz; k++) {
    const song = new Song(`waltz-${k}`, ['nocturne']);
    const mv = song.movement(0);
    const v = mv.sections.findIndex((x) => x.role === 'verse');
    if (mv.meter === '3/4' && v >= 0) waltz = composeSection(song, mv.firstSection + v);
  }
  assert(waltz, 'no waltz');
  const mv = waltz.movement;
  const beat = 60 / mv.bpm;
  assertAlmostEquals(barSeconds(mv), 3 * beat, 1e-9);
  const clock = new Clock(mv, waltz.local);
  const tune = waltz.events.filter(isMelody).map((e) => clock.written(e.t) / beat);
  const onBeat = tune.filter((q) => Math.abs(q - Math.round(q)) < 0.06).length;
  assert(tune.length > 6 && onBeat / tune.length > 0.5, `${onBeat} of ${tune.length} notes on a beat`);
});

Deno.test('post-rock rises in long waves: quiet without drums, a crescendo, a slow tremolo theme over a wall', () => {
  for (const seed of ['wave-a', 'wave-b', 'wave-c']) {
    const song = new Song(seed, ['ember'], 'standard');
    const mv = song.movement(0);
    assert(mv.duration > 265, `${seed} lasts ${mv.duration.toFixed(0)} s`);
    // long parts, not a string of short rounds
    const sounding = mv.sections.filter((s) => s.role !== 'rest');
    assert(sounding.length <= 12, `${seed} has ${sounding.length} sections`);
    // a run of builds climbs
    const k = mv.sections.findIndex((s, i) => s.role === 'build' && mv.sections[i + 1]?.role === 'build');
    if (k >= 0) assert(mv.sections[k + 1].energy > mv.sections[k].energy);
    mv.sections.forEach((sec, i) => {
      const s = composeSection(song, mv.firstSection + i);
      const drums = s.events.filter((e) => ['kick', 'snare', 'hat', 'tom'].includes(e.i));
      if (sec.role === 'intro' || sec.role === 'verse' || sec.role === 'break') {
        assertEquals(drums.length, 0, `${seed}: drums in the ${sec.role}`);
      }
      if (sec.role === 'drop' || sec.role === 'chorus') {
        const wall = s.events.filter((e): e is Extract<Ev, { i: 'string' }> => e.i === 'string' && e.k === 'overdrive');
        assert(wall.some((e) => (e.p ?? 0) < 0) && wall.some((e) => (e.p ?? 0) > 0), 'the wall is one guitarist');
        // the tune: slow, its long notes tremolo-picked, but moving through the scale (not one note hammered for bars)
        const tune = s.events.filter(isMelody).map((e) => e as Extract<Ev, { i: 'string' }>).sort((a, b) => a.t - b.t);
        const again = tune.filter((e, j) => j > 0 && e.n === tune[j - 1].n && e.t - tune[j - 1].t < 0.2).length;
        assert(tune.length > 20 && again / tune.length > 0.25, `${seed}: ${again} of ${tune.length} strokes repeat`);
        let held = 0;
        for (let j = 1, from = tune[0].t; j < tune.length; j++) {
          if (tune[j].n === tune[j - 1].n) continue;
          held = Math.max(held, tune[j].t - from);
          from = tune[j].t;
        }
        assert(new Set(tune.map((e) => e.n)).size >= 4, `${seed}: the tune has too few notes`);
        assert(held <= 4 * barSeconds(mv), `${seed}: the tune holds one note for ${held.toFixed(1)} s`);
        // and the bass drives the chords' roots: a bass that bounces to the fifth and the octave is a polka
        for (const e of s.events) {
          if (e.i !== 'bass') continue;
          const c = s.chords.find((c) => e.t >= c.t - 0.05 && e.t < c.t + c.d - 0.05);
          assert(!c || c.pcs.length < 2 || pc(e.n - c.bass) === 0, `${seed}: bass ${e.n} under ${c?.name}`);
        }
      }
    });
  }
});

Deno.test('a build stops before a climax rarely: only before the last one, and briefly', () => {
  for (const style of ['ember', 'acid', 'rise', 'cathedral'] as const) {
    let stops = 0;
    for (let k = 0; k < 8; k++) {
      const song = new Song(`lead-in-${style}-${k}`, [style]);
      const mv = song.movement(0);
      let here = 0;
      mv.sections.forEach((sec, i) => {
        const next = mv.sections[i + 1]?.role;
        if (sec.role !== 'build' || (next !== 'drop' && next !== 'chorus')) return;
        const s = composeSection(song, mv.firstSection + i);
        for (const e of s.events) {
          if (e.i !== 'gap' || e.t + e.d < s.duration - 0.01) continue;
          here++;
          // a beat and a half at most (the tempo curve may stretch it a little)
          assert(e.d <= 1.5 * (60 / mv.bpm) * 1.1, `${style}: a ${e.d.toFixed(2)} s stop`);
          let j = i + 1;
          while (mv.sections[j]?.role === next) j++;
          assert(!mv.sections.slice(j).some((x) => x.role === next), `${style}: a stop before an early climax`);
        }
      });
      assert(here <= 1, `${style}: ${here} stops in one piece`);
      stops += here;
    }
    assert(stops < 8, `${style}: every piece stops before its climax`);
  }
});

Deno.test('a band stops as players do: held sounds are let go, ringing ones ring on, nothing is cut', () => {
  const stop = [2];
  const pad = letGo({ i: 'pad', t: 0, d: 4, n: [60, 64, 67], k: 'warm', cut: [800, 1200] }, stop);
  assertEquals((pad as { d: number }).d, 2);
  const piano = letGo({ i: 'piano', t: 1, d: 3, n: [48, 60], v: 0.6 }, stop);
  assertEquals((piano as { d: number }).d, 3, 'the piano was stopped');
  const guitar = letGo({ i: 'string', t: 1.5, n: 52, v: 0.7, k: 'clean', d: 2 }, stop);
  assertEquals((guitar as { d: number }).d, 2, 'the string was choked');
  const flute = letGo({
    i: 'wind',
    t: 0,
    k: 'flute',
    ns: [{ t: 0, d: 1, n: 72, v: 0.8 }, { t: 1, d: 3, n: 74, v: 0.8 }],
  }, stop);
  assertEquals((flute as { ns: { d: number }[] }).ns.map((n) => n.d), [1, 1]);
  const rise = letGo({ i: 'rise', t: 0, d: 4, k: 'build', x0: 0, x1: 1 }, stop) as { d: number; x1: number };
  assertEquals([rise.d, rise.x1], [2, 0.5]);
  assertEquals(letGo({ i: 'bass', t: 0, d: 4, n: 40, v: 0.8, k: 'pick' }, stop), {
    i: 'bass',
    t: 0,
    d: 4,
    n: 40,
    v: 0.8,
    k: 'pick',
  });
  // and a band's stop is not a cut: no section of a band style mutes everything
  for (const style of ['ember', 'nocturne', 'haze', 'garden', 'cathedral'] as const) {
    for (const s of sectionsOf(`stops-${style}`, style)) {
      assert(!s.events.some((e) => e.i === 'gap' && e.t + e.d < s.duration - 0.01), `${style} cuts dead`);
    }
  }
});

Deno.test("each piece has its own lead guitarist: their vibrato, slides and bends, and their guitar's tuning", () => {
  type Str = Extract<Ev, { i: 'string' }>;
  const who = new Set<string>();
  let sung = 0;
  for (const style of ['ember', 'haze'] as const) {
    for (let k = 0; k < 12; k++) {
      const song = new Song(`hands-${style}-${k}`, [style]);
      const mv = song.movement(0);
      const g = guitarist(new Ctx(song, mv.firstSection));
      who.add(g.who);
      const sections = mv.sections.map((_, i) => composeSection(song, mv.firstSection + i));
      const tune = sections.flatMap((s) => s.events.filter((e): e is Str => e.i === 'string' && e.lead === true));
      // one pair of hands all piece long
      assert(tune.every((e) => e.vibRate === undefined || e.vibRate === g.hands.rate), `${g.who} changed hands`);
      if (tune.some((e) => e.vibRate === g.hands.rate)) sung++;
      // a picked note given its own glide is bent into (a fret player's slides take the usual time)
      const bent = g.hands.glide === 1 ? tune.filter((e) => !e.slur && e.glide !== undefined) : [];
      if (!g.hands.bend) assertEquals(bent.length, 0, `${g.who} bent a string`);
      assert(bent.every((e) => e.k !== 'guitar'), 'bent an acoustic');
      if (!g.hands.slur) assert(!tune.some((e) => e.slur && !e.slide), `${g.who} hammered on`);
      if (!g.hands.legato) assert(!tune.some((e) => e.slur && e.slide), `${g.who} slid from note to note`);
      if (style !== 'ember') continue;
      // the open strings of the tuning ring in every chord swelled in
      const open = g.open.map((x) => (mv.key.tonic + x) % 12);
      sections.forEach((s, i) => {
        const tonic = sectionKey(mv, i).tonic;
        const ring = g.open.map((x) => (tonic + x) % 12);
        const swells = s.events.filter((e): e is Str => e.i === 'string' && e.swell !== undefined);
        for (const c of s.chords) {
          const pcs = swells.filter((e) => e.t > c.t - 0.1 && e.t < c.t + 0.4).map((e) => pc(e.n));
          if (!pcs.length) continue;
          assert(ring.every((p) => pcs.includes(p)), `${open}: open strings missing from ${pcs}`);
        }
      });
    }
  }
  assert(who.size >= 5, `only ${[...who]} played`);
  assert(sung >= 12, `the lead guitarist shook their held notes their way in ${sung} pieces`);
  assertEquals(Object.keys(PLAYERS).length, 6);
});

Deno.test('a piece is written in one mood: its key, tempo, sound, room and dynamics lean the same way', () => {
  const heard = new Set<Mood>();
  let again = 0;
  for (let k = 0; k < 30; k++) {
    const song = new Song(`moods-${k}`);
    for (let m = 0; m < 10; m++) {
      const mv = song.movement(m);
      const style = STYLES[mv.style];
      const feel = MOODS[mv.mood];
      const at = `${mv.style} ${mv.mood}`;
      heard.add(mv.mood);
      if (m && song.movement(m - 1).mood === mv.mood) again++;
      assert(style.moods.includes(mv.mood) && style.motions.includes(mv.motion), at);
      // the modes the mood leans on, when the style has any
      if (moodModes(style.modes, mv.mood).length) assert((feel.modes[mv.key.mode] ?? 0) > 0, `${at} in ${mv.key.mode}`);
      // its part of the style's tempo range (a 6/8 piece counts dotted quarters)
      const q = mv.meter === '6/8' ? mv.bpm / 1.125 : mv.bpm;
      const [lo, hi] = [style.bpm[0], style.bpm[1] + 1];
      // (to the bpm it rounds to)
      const [slowest, fastest] = feel.tempo.map((x) => lo + (hi - lo) * x);
      assert(q >= slowest - 1.1 && q <= fastest + 0.6, `${at} at ${mv.bpm} bpm`);
      assert(mv.tone.bright >= feel.bright[0] && mv.tone.bright <= feel.bright[1], at);
      assertAlmostEquals(mv.mix.peak, style.dynamics[0] + feel.dynamics[0]);
      // a room the style is recorded in, its reverb as that room's
      assert(style.spaces.includes(mv.space), `${at} in a ${mv.space}`);
      assert(mv.mix.room >= SPACES[mv.space].room[0] && mv.mix.room <= SPACES[mv.space].room[1], at);
    }
  }
  assertEquals(heard.size, Object.keys(MOODS).length);
  assert(again <= 6, `${again} moods told twice running`);
  // the dance styles always drive; the calmest never unsettle
  for (const id of ['rise', 'acid'] as const) assertEquals(STYLES[id].motions, ['driving']);
  for (const id of ['drift', 'nocturne'] as const) assert(!STYLES[id].moods.includes('unease'));
});

Deno.test('a still piece accompanies on the beats, a flowing one in eighths; only joy bounces', () => {
  let checked = 0;
  let off = 0;
  let oompah = 0;
  for (let k = 0; k < 16; k++) {
    const song = new Song(`motion-${k}`);
    for (let m = 0; m < 5; m++) {
      const mv = song.movement(m);
      const spb = mv.meter === '4/4' ? 16 : 12;
      const beat = mv.meter === '6/8' ? 6 : 4;
      mv.sections.forEach((_, i) => {
        const s = composeSection(song, mv.firstSection + i);
        const stepOf = (t: number) => {
          const b = s.bars.findLastIndex((x) => x <= t + 0.02);
          if (b < 0 || b >= s.bars.length - 1) return null;
          const x = ((t - s.bars[b]) / (s.bars[b + 1] - s.bars[b])) * spb;
          return Math.abs(x - Math.round(x)) <= 0.4 ? { bar: b, step: Math.round(x) % spb } : null;
        };
        // (a step busier where the piece is at its fullest)
        const motion = mv.sections[i].energy < 0.75 ? mv.motion : mv.motion === 'still' ? 'flowing' : 'driving';
        for (const e of s.events) {
          const accompanies = ['pluck', 'mallet', 'piano', 'bass', 'string'].includes(e.i) && !('lead' in e) &&
            !(e.i === 'string' && e.swell !== undefined);
          if (motion === 'driving' || !accompanies) continue;
          const at = stepOf(e.t);
          if (!at) continue;
          checked++;
          if (motion === 'still' ? at.step % beat : at.step % 2) off++;
        }
        if (mv.mood === 'joy') return;
        // no oom-pah: on the beats of a bar, never the root on one and its fifth on another
        const bars = new Map<number, Set<number>>();
        for (const e of s.events) {
          if (e.i !== 'bass') continue;
          const at = stepOf(e.t);
          const chord = s.chords.find((c) => e.t >= c.t - 0.05 && e.t < c.t + c.d - 0.05);
          if (!at || at.step % beat || !chord) continue;
          bars.set(at.bar, (bars.get(at.bar) ?? new Set()).add(pc(e.n - chord.bass)));
        }
        for (const set of bars.values()) if (set.has(0) && set.has(7)) oompah++;
      });
    }
  }
  assert(checked > 500, `only ${checked} notes checked`);
  assert(off / checked < 0.02, `${off} of ${checked} accompanying notes move faster than their piece`);
  assertEquals(oompah, 0, 'a bass bounced between root and fifth outside joy');
});

Deno.test('a piece speaks one harmonic language: a pedal, a lament, a vamp, a colour, or its loops; some end open', () => {
  const seen = new Set<string>();
  let open = 0;
  let pieces = 0;
  let steps = 0;
  let changes = 0;
  for (let k = 0; k < 30; k++) {
    const song = new Song(`languages-${k}`);
    for (let m = 0; m < 10; m++) {
      const mv = song.movement(m);
      const at = `${mv.style} ${mv.mood} ${mv.harmony} in ${mv.key.mode}`;
      pieces++;
      seen.add(mv.harmony);
      assert(STYLES[mv.style].languages.includes(mv.harmony), at);
      assert((MOODS[mv.mood].languages[mv.harmony] ?? 0) > 0 || mv.harmony === 'loop', at);
      const verse = mv.progressions.main;
      if (mv.harmony === 'vamp') assert(new Set(verse.map((c) => `${c.deg}${c.alt}`)).size <= 2, at);
      if (mv.harmony === 'lament') {
        // its bass walks down: one or two semitones at each change, but for the way back up to the tonic
        const bass = verse.map((c) => c.bass ?? MODES[mv.key.mode][c.deg % 7]);
        bass.forEach((b, i) => {
          if (!i || b === bass[i - 1]) return;
          changes++;
          if ([1, 2].includes(mod(bass[i - 1] - b, 12))) steps++;
        });
      }
      if (mv.harmony === 'colour') {
        assert(verse.some((c) => c.shift || c.alt), `${at}: no colour in ${JSON.stringify(verse)}`);
      }
      // the bass holds the tonic under every part but the bridge (the fifth under a build)
      mv.sections.forEach((sec, i) => {
        const slots = sectionChords(mv, i);
        if (mv.harmony === 'pedal' && sec.role !== 'bridge') {
          const want = sec.role === 'build' || sec.role === 'prechorus' ? 7 : 0;
          assert(slots.every((c) => c.spec.bass === want), `${at}: a ${sec.role} without its pedal`);
        }
      });
      // it ends home on the tonic, or open on the mode's plagal or deceptive chord
      const last = mv.sections.findLastIndex((x) => x.role !== 'rest');
      const end = sectionChords(mv, last).at(-1)!.spec;
      if (mv.ending === 'open') {
        open++;
        assertEquals(end.deg, OPEN_ENDS[mv.key.mode].deg, at);
      } else assert(end.deg === 0 && !end.shift, `${at} ends on ${end.deg}`);
    }
  }
  assertEquals(seen.size, 5);
  assert(open / pieces > 0.05 && open / pieces < 0.25, `${open} of ${pieces} end open`);
  assert(changes > 20 && steps / changes >= 0.6, `a lament's bass steps down at ${steps} of ${changes} changes`);
});

Deno.test("a pedal holds the bass on the tonic; a piano's left hand plays a lament's walking bass", () => {
  let pedalled = 0;
  let held = 0;
  let laments = 0;
  for (let k = 0; k < 40 && (pedalled < 200 || laments < 20); k++) {
    const song = new Song(`pedal-bass-${k}`, ['nocturne', 'ember', 'drift', 'cathedral']);
    for (let m = 0; m < 6; m++) {
      const mv = song.movement(m);
      if (mv.harmony !== 'pedal' && mv.harmony !== 'lament') continue;
      mv.sections.forEach((sec, i) => {
        if (sec.role === 'bridge' || sec.role === 'build' || sec.role === 'prechorus' || sec.role === 'rest') return;
        const s = composeSection(song, mv.firstSection + i);
        const chordAt = (t: number) => s.chords.find((c) => t >= c.t - 0.05 && t < c.t + c.d - 0.05);
        if (mv.harmony === 'pedal') {
          for (const e of s.events.filter((e) => e.i === 'bass')) {
            pedalled++;
            if (pc(e.n - sectionKey(mv, i).tonic) === 0) held++;
          }
        }
        // (in the parts the left hand plays figures over the bass; a break holds voiced chords)
        if (mv.harmony === 'lament' && mv.style === 'nocturne' && (sec.role === 'verse' || sec.role === 'chorus')) {
          // the left hand's lowest note on each chord's downbeat is the chord's bass
          for (const c of s.chords) {
            const low = s.events.filter((e): e is Extract<Ev, { i: 'piano' }> =>
              e.i === 'piano' && !isMelody(e) && Math.abs(e.t - c.t) < 0.06
            );
            if (!low.length || !chordAt(c.t)) continue;
            laments++;
            assertEquals(pc(Math.min(...low.flatMap((e) => e.n)) - c.bass), 0, `${c.name}`);
          }
        }
      });
    }
  }
  assert(pedalled >= 200 && held / pedalled > 0.9, `${held} of ${pedalled} bass notes on the pedal`);
  assert(laments >= 20, `only ${laments} lament chords played`);
});

Deno.test('a tune is a song, a lament, a riff, a recitation or a fanfare, or none; a riff never in three or major', () => {
  type Line = { falls: number; statements: number; leaps: number; ivs: number; span: number[] };
  const by = new Map<string, Line>();
  for (let k = 0; k < 24; k++) {
    const song = new Song(`tunes-${k}`);
    for (let m = 0; m < 6; m++) {
      const mv = song.movement(m);
      const at = `${mv.style} ${mv.mood} ${mv.tune}`;
      assert(STYLES[mv.style].tunes.includes(mv.tune), at);
      assert(mv.tune === 'song' || (MOODS[mv.mood].tunes[mv.tune] ?? 0) > 0, at);
      if (mv.tune === 'riff') {
        assert(mv.meter === '4/4' && !['ionian', 'lydian', 'mixolydian'].includes(mv.key.mode), at);
      }
      const r = by.get(mv.tune) ?? { falls: 0, statements: 0, leaps: 0, ivs: 0, span: [] };
      by.set(mv.tune, r);
      mv.sections.forEach((sec, i) => {
        if (sec.role !== 'verse' && sec.role !== 'chorus' && sec.role !== 'drop') return;
        const s = composeSection(song, mv.firstSection + i);
        const tune = s.events.filter(isMelody);
        if (mv.tune === 'none') return assertEquals(tune.length, 0, `${at} sings`);
        // the lead voice's notes (the voice the tune starts on), a chord's top one, a tremolo as one note
        const voice = (e: Ev) => `${e.i}:${'k' in e ? e.k : ''}`;
        const all = tune.filter((e) => voice(e) === voice(tune[0])).flatMap((e) =>
          'ns' in e
            ? e.ns.map((n) => ({ t: n.t, n: n.n }))
            : [{ t: e.t, n: Math.max(...[(e as { n: number | number[] }).n].flat()) }]
        ).sort((a, b) => a.t - b.t);
        const ns = all.filter((x, j) => !(j && x.n === all[j - 1].n && x.t - all[j - 1].t < 0.25));
        for (let j = 1; j < ns.length; j++, r.ivs++) if (Math.abs(ns[j].n - ns[j - 1].n) >= 5) r.leaps++;
        const two = 2 * (s.bars[1] - s.bars[0]);
        for (let t0 = 0; t0 < s.duration; t0 += two) {
          const st = ns.filter((x) => x.t >= t0 && x.t < t0 + two);
          if (st.length < 3) continue;
          r.statements++;
          if (st.at(-1)!.n < st[0].n - 2) r.falls++;
          r.span.push(Math.max(...st.map((x) => x.n)) - Math.min(...st.map((x) => x.n)));
        }
      });
    }
  }
  const song = by.get('song')!;
  const falls = (l: Line) => l.falls / l.statements;
  const span = (l: Line) => l.span.reduce((a, b) => a + b, 0) / l.span.length;
  for (const t of ['lament', 'fanfare', 'recitation']) assert(by.get(t)!.statements > 30, `few ${t} statements`);
  assert(falls(by.get('lament')!) > falls(song) + 0.15, `a lament falls in ${falls(by.get('lament')!)}`);
  assert(
    by.get('fanfare')!.leaps / by.get('fanfare')!.ivs > song.leaps / song.ivs + 0.05,
    `fanfare ${by.get('fanfare')!.leaps}/${by.get('fanfare')!.ivs}, song ${song.leaps}/${song.ivs}`,
  );
  assert(span(by.get('recitation')!) < span(song) - 1, `a recitation spans ${span(by.get('recitation')!)}`);
});

Deno.test('a piece is recorded in its own room, sometimes with no bed; its rhythm section grows with it', () => {
  let bare = 0;
  let pieces = 0;
  const rooms = new Set<string>();
  for (let k = 0; k < 20; k++) {
    const song = new Song(`rooms-${k}`);
    for (let m = 0; m < 6; m++) {
      const mv = song.movement(m);
      pieces++;
      rooms.add(mv.space);
      if (mv.texture !== 'bare') continue;
      bare++;
      assert(STYLES[mv.style].bare > 0 && mv.motion !== 'still', `${mv.style} ${mv.motion} is bare`);
      mv.sections.forEach((_, i) => {
        assert(!composeSection(song, mv.firstSection + i).events.some((e) => e.i === 'pad'), `${mv.style}: a pad`);
      });
    }
  }
  assertEquals(rooms.size, 4);
  assert(bare > 0 && bare / pieces < 0.3, `${bare} of ${pieces} bare`);
  // a close room decays in about a second, a cathedral in six (the decay of the reverb's energy by 60 dB)
  const rt60 = (room: number) => {
    const sr = 16000;
    const n = 9 * sr;
    const inp = new Float32Array(n);
    const noise = new Rng(7);
    for (let i = 0; i < 0.02 * sr; i++) inp[i] = noise.range(-1, 1);
    const [l, r] = [new Float32Array(n), new Float32Array(n)];
    freeverb(sr, inp, l, r, room, 1, 0, 0.35);
    const e: number[] = new Array(n);
    for (let i = n - 1, acc = 0; i >= 0; i--) e[i] = acc += l[i] * l[i] + r[i] * r[i];
    const at = (db: number) => e.findIndex((x) => 10 * Math.log10(x / e[0]) <= db);
    return (2 * (at(-35) - at(-5))) / sr;
  };
  assert(rt60(SPACES.close.room[1]) < 1.3, `close: ${rt60(SPACES.close.room[1]).toFixed(2)} s`);
  assert(rt60(SPACES.cathedral.room[0]) > 4, `cathedral: ${rt60(SPACES.cathedral.room[0]).toFixed(2)} s`);
  // the drums and bass sit under the bed in a quiet part and over it at the peak
  assert(balanceLift(0.2) < -2 && balanceLift(0.7) === 0 && balanceLift(1) > 1.5);
});

Deno.test('about half the pieces have one surprise, after their pattern, never the kind of the two before', () => {
  const BIG: readonly Role[] = ['chorus', 'drop'];
  let placed = 0;
  let pieces = 0;
  const kinds = new Set<string>();
  for (let k = 0; k < 40; k++) {
    const song = new Song(`surprises-${k}`);
    for (let m = 0; m < 10; m++) {
      const mv = song.movement(m);
      pieces++;
      if (!mv.surprise) continue;
      placed++;
      kinds.add(mv.surprise);
      const at = `${mv.style} ${mv.mood} ${mv.arc}: ${mv.surprise}`;
      assert(STYLES[mv.style].surprises.includes(mv.surprise) && (MOODS[mv.mood].surprises[mv.surprise] ?? 0) > 0, at);
      for (const d of [1, 2]) if (m >= d) assert(song.movement(m - d).surprise !== mv.surprise, `${at} again`);
      const s = mv.sections;
      const firstBig = s.findIndex((x) => BIG.includes(x.role));
      const peak = s.findIndex((x) => x.energy === Math.max(...s.map((y) => y.energy)));
      const marked = s.map((x, i) => (x.surprise ? i : -1)).filter((i) => i >= 0);
      switch (mv.surprise) {
        case 'subito': {
          const i = s.findIndex((x, j) => x.treatment === 'hushed' && BIG.includes(x.role) && j > firstBig && j < peak);
          assert(i > 0, at);
          break;
        }
        case 'alone':
          assert(
            s.some((x, j) => x.treatment === 'bare' && ['verse', 'bridge', 'break'].includes(x.role) && j > firstBig),
            at,
          );
          break;
        case 'pause':
          assertEquals(marked.length, 1, at);
          assert(BIG.includes(s[marked[0]].role) && marked[0] > firstBig && s[marked[0]].bars >= 8, at);
          break;
        case 'halfTime':
          assert(mv.meter === '4/4' && marked.includes(peak) && marked.every((i) => s[i].surprise === 'halfTime'), at);
          break;
        case 'keyJump': {
          const last = s.findLastIndex((x) => BIG.includes(x.role));
          assertEquals(s[last].shift, 4, at);
          break;
        }
      }
    }
  }
  assertEquals(kinds.size, 5);
  assert(placed / pieces > 0.35 && placed / pieces < 0.7, `${placed} of ${pieces} pieces have a surprise`);
});

Deno.test('a pause stops the band for the rest of a bar and it comes back; half time moves the backbeat to three', () => {
  let pauses = 0;
  let halves = 0;
  for (let k = 0; k < 40 && (pauses < 3 || halves < 3); k++) {
    const song = new Song(`moments-${k}`);
    for (let m = 0; m < 8; m++) {
      const mv = song.movement(m);
      mv.sections.forEach((sec, i) => {
        if (!sec.surprise) return;
        const s = composeSection(song, mv.firstSection + i);
        const bar = (b: number) => s.bars[b];
        if (sec.surprise === 'pause') {
          pauses++;
          const b = Math.floor(sec.bars / 2);
          const beat = (bar(b + 1) - bar(b)) / (mv.meter === '4/4' ? 4 : 3);
          const inside = s.events.filter((e) =>
            e.t > bar(b) + beat + 0.06 && e.t < bar(b + 1) - 0.06 && e.i !== 'gap' && e.i !== 'vinyl'
          );
          assertEquals(inside.map((e) => e.i), [], `${mv.style}: plays on through its pause`);
        }
        if (sec.surprise === 'halfTime' && s.events.some((e) => e.i === 'snare')) {
          halves++;
          for (const e of s.events) {
            if (e.i !== 'snare' && e.i !== 'kick') continue;
            const b = s.bars.findLastIndex((x) => x <= e.t + 0.03);
            if (b < 0 || b >= s.bars.length - 1) continue;
            const step = Math.round(((e.t - bar(b)) / (bar(b + 1) - bar(b))) * 16) % 16;
            if (e.i === 'snare') assert(step !== 4 && step !== 12, `${mv.style}: a backbeat on ${step}`);
            else assert(![4, 8, 12].includes(step), `${mv.style}: a kick on ${step}`);
          }
        }
      });
    }
  }
  assert(pauses >= 3 && halves >= 3, `${pauses} pauses, ${halves} half-time parts`);
});

Deno.test("a long line doesn't come back on itself: its statements' rhythms are new where a song's return", () => {
  const by = new Map<string, { again: number; statements: number }>();
  for (let k = 0; k < 30; k++) {
    const song = new Song(`lines-${k}`, ['nocturne', 'cathedral', 'drift', 'ember']);
    for (let m = 0; m < 6; m++) {
      const mv = song.movement(m);
      if (mv.tune !== 'song' && mv.tune !== 'longLine') continue;
      const r = by.get(mv.tune) ?? { again: 0, statements: 0 };
      by.set(mv.tune, r);
      mv.sections.forEach((sec, i) => {
        if (!['verse', 'chorus', 'drop'].includes(sec.role) || sec.bars < 8) return;
        const s = composeSection(song, mv.firstSection + i);
        const tune = s.events.filter(isMelody);
        if (!tune.length) return;
        const voice = (e: Ev) => `${e.i}:${'k' in e ? e.k : ''}`;
        const onsets = tune.filter((e) => voice(e) === voice(tune[0])).flatMap((e) =>
          'ns' in e ? e.ns.map((n) => n.t) : [e.t]
        ).sort((a, b) => a - b).filter((t, j, a) => !j || t - a[j - 1] > 0.25);
        // each statement's first bar as its rhythm, placed against that bar's own lines (the tempo breathes)
        const heard = new Set<string>();
        for (let j = 0; j + 2 < s.bars.length; j += 2) {
          const [t0, t1] = [s.bars[j], s.bars[j + 1]];
          const bar = onsets.filter((t) => t >= t0 - 0.04 && t < t1 - 0.04).map((t) =>
            Math.round(((t - t0) / (t1 - t0)) * 16)
          );
          if (bar.length < 2) continue;
          r.statements++;
          if (heard.has(bar.join())) r.again++;
          heard.add(bar.join());
        }
      });
    }
  }
  const share = (t: string) => by.get(t)!.again / by.get(t)!.statements;
  assert(by.get('longLine')!.statements > 100, `only ${by.get('longLine')!.statements} long-line statements`);
  assert(share('longLine') < share('song') / 2, `a long line restates ${share('longLine')}, a song ${share('song')}`);
});

Deno.test('a piece may be built on one idea: an ostinato on fixed notes, or loops drifting out of phase', () => {
  const seen = { ostinato: 0, phase: 0, none: 0 };
  for (let k = 0; k < 30; k++) {
    const song = new Song(`ideas-${k}`);
    for (let m = 0; m < 8; m++) {
      const mv = song.movement(m);
      seen[mv.conceit]++;
      if (mv.conceit === 'none') continue;
      assert(STYLES[mv.style].conceits.includes(mv.conceit), `${mv.style}: ${mv.conceit}`);
      if (mv.conceit === 'phase') assert(mv.motion !== 'driving', `${mv.style} drives its loops`);
      // the idea alone, in a verse or a chorus
      const i = mv.sections.findIndex((x) => x.role === 'verse' || x.role === 'chorus');
      if (i < 0) continue;
      const ctx = new Ctx(song, mv.firstSection + i);
      conceit(ctx);
      const notes = ctx.events.map((e) => ({ t: e.t, n: Math.max(...['n' in e ? e.n : []].flat() as number[]) }));
      assert(notes.length > 0, `${mv.style}: no ${mv.conceit}`);
      const barOf = (t: number) => Math.floor(t / ctx.bar + 1e-6);
      if (mv.conceit === 'ostinato') {
        // the same notes in every bar, whatever the chords do under them
        const bars = new Map<number, string>();
        for (const x of notes) bars.set(barOf(x.t), `${bars.get(barOf(x.t)) ?? ''},${x.n}`);
        assertEquals(new Set(bars.values()).size, 1, `${mv.style}: the figure changes`);
      } else {
        // a note comes back after its loop's length in beats, which no bar divides
        const beats = notes.map((x) => x.t / ctx.beat);
        const gaps = new Set<number>();
        for (const a of notes) {
          for (const b of notes) if (b.n === a.n && b.t > a.t) gaps.add(Math.round((b.t - a.t) / ctx.beat));
        }
        assert(beats.length > 0 && [...gaps].every((g) => [23, 29, 37].some((p) => g % p === 0)), `${[...gaps]}`);
      }
    }
  }
  assert(seen.ostinato > 10 && seen.phase > 5 && seen.none > seen.ostinato, JSON.stringify(seen));
});

Deno.test('a steady song stays calm: no sad or tense moods, arcs that grow or hold, no surprises, always home', () => {
  const calm = new Set(['wonder', 'transcendence', 'tenderness', 'nostalgia', 'peace', 'joy']);
  for (let k = 0; k < 20; k++) {
    const steady = new Song(`steady-${k}`, STYLE_IDS, 'standard', 'steady');
    for (let m = 0; m < 10; m++) {
      const mv = steady.movement(m);
      assert(calm.has(mv.mood), `${mv.style}: ${mv.mood}`);
      assert(['climb', 'early', 'plateau'].includes(mv.arc), `${mv.style}: ${mv.arc}`);
      assertEquals([mv.surprise, mv.ending], [null, 'home']);
    }
  }
  // and the adventurous default is the song it always was
  const a = new Song('same-song');
  const b = new Song('same-song', STYLE_IDS, 'standard', 'adventurous');
  assertEquals(
    JSON.stringify([0, 1, 2].map((m) => a.movement(m))),
    JSON.stringify([0, 1, 2].map((m) => b.movement(m))),
  );
  assertEquals(engine(2).song('x', undefined, undefined, 'steady').character, 'steady');
  assertEquals(engine(2).song('x', undefined, undefined, 'wild').character, 'adventurous');
});

Deno.test('some pieces are in five or seven: bars of 20 or 14 sixteenths, drums on their groups, tunes in them', () => {
  const seen = new Set<string>();
  for (const style of ['ember', 'cathedral', 'nocturne'] as const) {
    for (let k = 0; k < 60; k++) seen.add(`${style} ${new Song(`odd-${style}-${k}`, [style]).movement(0).meter}`);
  }
  for (const s of ['ember 7/8', 'ember 5/4', 'cathedral 5/4', 'nocturne 5/4']) assert(seen.has(s), `no ${s}`);
  for (const id of STYLE_IDS) {
    if (['ember', 'cathedral', 'nocturne'].includes(id)) continue;
    assert(!STYLES[id].meters.some(([m]) => m === '5/4' || m === '7/8'), `${id} in an odd time`);
  }
  // every groove in five or seven fits its bar
  for (const banks of [EMBER_TIMES, CATHEDRAL_TIMES]) {
    for (const [meter, steps] of [['5/4', 20], ['7/8', 14]] as const) {
      assert(banks[meter]?.length, `no grooves in ${meter}`);
      for (const [g] of banks[meter]!) {
        for (const bar of [g.light, g.full, g.fill, g.answer, g.layer]) {
          for (const lane of Object.values(bar ?? {})) assertEquals((lane as string).length, steps, g.name);
        }
        for (const [step, len] of [...g.bassLight, ...g.bassFull]) assert(step + len <= steps, `${g.name} bass`);
      }
    }
  }
  // a piece in seven: bar lines three and a half beats apart, every section's notes inside its bars, and the kick
  // on the groups of two, two and three
  for (
    const [style, meter, quarters] of [['ember', '7/8', 3.5], ['cathedral', '5/4', 5], ['nocturne', '5/4', 5]] as const
  ) {
    let song: Song | undefined;
    for (let k = 0; k < 200 && !song; k++) {
      const s = new Song(`odd-${style}-${k}`, [style]);
      if (s.movement(0).meter === meter) song = s;
    }
    assert(song, `no ${style} in ${meter}`);
    const mv = song.movement(0);
    assertAlmostEquals(barSeconds(mv), quarters * (60 / mv.bpm), 1e-9);
    let kicks = 0;
    let onGroups = 0;
    mv.sections.forEach((_, i) => {
      const sc = composeSection(song!, mv.firstSection + i);
      const clock = new Clock(mv, sc.local);
      for (const e of sc.events) {
        if (e.i !== 'kick') continue;
        const q = clock.written(e.t) / (60 / mv.bpm / 4);
        const step = ((Math.round(q) % (4 * quarters)) + 4 * quarters) % (4 * quarters);
        kicks++;
        if (STRONGS[meter].includes(step) || BEATS[meter].includes(step)) onGroups++;
      }
    });
    if (style !== 'nocturne') {
      assert(kicks > 20 && onGroups / kicks > 0.8, `${style}: ${onGroups} of ${kicks} kicks on groups`);
    }
  }
});

Deno.test('no part of a piece is silent: every four bars of every section sound', () => {
  const silent = new Set(['gap', 'vinyl', 'stop', 'breath']);
  let sections = 0;
  for (const style of STYLE_IDS) {
    for (let k = 0; k < 6; k++) {
      const song = new Song(`sounding-${style}-${k}`, [style], 'short');
      for (let m = 0; m < 3; m++) {
        const mv = song.movement(m);
        mv.sections.forEach((sec, i) => {
          if (sec.role === 'rest') return;
          sections++;
          const s = composeSection(song, mv.firstSection + i);
          const sound = s.events.filter((e) => !silent.has(e.i));
          for (let b = 0; b + 4 < s.bars.length; b += 4) {
            const [t0, t1] = [s.bars[b], s.bars[b + 4]];
            // (a line of notes, a 303's or a wind's, sounds where its notes do)
            const heard = sound.some((e) =>
              'ns' in e
                ? e.ns.some((n) => n.t < t1 && n.t + n.d > t0)
                : e.t < t1 && e.t + ('d' in e && typeof e.d === 'number' ? e.d : 2) > t0
            );
            assert(
              heard,
              `${style} ${mv.mood} ${mv.tune} ${sec.role} ${sec.treatment ?? ''}: bars ${b} to ${b + 4} silent`,
            );
          }
        });
      }
    }
  }
  assert(sections > 300);
});

Deno.test('a piece is extreme on one or two axes, never on all: still, a vamp, no tune and an ostinato never meet', () => {
  let still = 0;
  for (let k = 0; k < 60; k++) {
    const song = new Song(`stillness-${k}`);
    for (let m = 0; m < 12; m++) {
      const mv = song.movement(m);
      assert(stillnessOf(mv) <= 2, `${mv.style}: ${mv.motion} ${mv.harmony} ${mv.tune} ${mv.conceit} ${mv.arc}`);
      if (mv.motion === 'still' && mv.harmony === 'vamp') still++;
      if (mv.tune === 'none') assert(mv.motion !== 'still' && mv.harmony !== 'vamp', `${mv.style}: nothing moves`);
    }
  }
  assert(still > 0, 'a still vamp never happens at all');
  // the piece that was wallpaper: still, a vamp, and now a tune over it
  const mv = new Song('dusty-wild-aurora', ['ember'], 'short').movement(0);
  assert(mv.tune !== 'none' && mv.conceit === 'none', `${mv.tune} ${mv.conceit}`);
});

Deno.test("a post-rock build grows a layer at a time: nothing floods in at a section's line", () => {
  let lines = 0;
  for (let k = 0; k < 30; k++) {
    const song = new Song(`growing-${k}`, ['ember'], 'short');
    for (let m = 0; m < 3; m++) {
      const mv = song.movement(m);
      mv.sections.forEach((sec, i) => {
        if (sec.role !== 'build' || mv.sections[i + 1]?.role !== 'build') return;
        const [a, b] = [composeSection(song, mv.firstSection + i), composeSection(song, mv.firstSection + i + 1)];
        // what sounds in the last two bars of one and the first two of the next (a held chord sounds all through)
        const part = (e: Ev) => `${e.i}:${'k' in e ? e.k : ''}`;
        const len = (e: Ev) => ('d' in e && typeof e.d === 'number' ? e.d : 0.3);
        const [a0, a1] = [a.bars[a.bars.length - 3], a.duration];
        const before = new Set(a.events.filter((e) => e.t < a1 && e.t + len(e) > a0).map(part));
        const after = new Set(b.events.filter((e) => e.t < b.bars[2]).map(part));
        const entering = [...after].filter((p) => !before.has(p) && !p.startsWith('perc') && !p.startsWith('tom'));
        lines++;
        assert(entering.length <= 1, `${mv.mood} ${mv.motion}: ${entering} enter together`);
      });
    }
  }
  assert(lines > 10, `only ${lines} lines between builds`);
});

Deno.test('a bare or hushed section with nothing of its own to keep is never left silent', () => {
  const find = (how: 'bare' | 'hushed') => {
    for (let k = 0; k < 200; k++) {
      const song = new Song(`treated-${k}`);
      for (let m = 0; m < 6; m++) {
        const mv = song.movement(m);
        const i = mv.sections.findIndex((x) => x.treatment === how);
        if (i >= 0) return new Ctx(song, mv.firstSection + i);
      }
    }
    throw new Error(`no ${how} section`);
  };
  // a bare part with no tune and no bed (a guitar's picking alone) keeps the picking, hushed
  const bare = find('bare');
  bare.events.length = 0;
  bare.push({ i: 'string', t: 0, n: 64, v: 0.5, k: 'clean' });
  bare.push({ i: 'kick', t: 0, v: 0.8, k: 'acoustic', sc: 0, n: 36 });
  treat(bare);
  assertEquals(bare.events.map((e) => e.i), ['string']);
  // a hushed part of nothing but a 303 and drums keeps the 303
  const hushed = find('hushed');
  hushed.events.length = 0;
  hushed.push({
    i: 'acid',
    t: 0,
    ns: [{ t: 0, d: 0.2, n: 45, v: 0.8, accent: false, slide: false }],
    cut: [300, 2000],
    res: 0.6,
    env: 0.5,
  });
  hushed.push({ i: 'hat', t: 0, v: 0.5, k: 'closed' });
  treat(hushed);
  assertEquals(hushed.events.map((e) => e.i), ['acid']);
  // and a bare part keeps the chords a guitar swells in, as its bed
  const swelled = find('bare');
  swelled.events.length = 0;
  swelled.push({ i: 'string', t: 0, n: 64, v: 0.5, k: 'clean', d: 2, swell: 0.8 });
  swelled.push({ i: 'string', t: 0, n: 52, v: 0.5, k: 'overdrive', d: 2 });
  treat(swelled);
  assertEquals(swelled.events.length, 1);
});
