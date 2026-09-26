import { assert, assertAlmostEquals, assertEquals, assertNotEquals } from '@std/assert';
import { composeSection } from '../../../src/engines/v2/compose/index.ts';
import { Ctx, sectionKey } from '../../../src/engines/v2/compose/context.ts';
import { perform } from '../../../src/engines/v2/compose/perform.ts';
import { Song } from '../../../src/engines/v2/plan.ts';
import { STYLE_IDS, STYLES } from '../../../src/engines/v2/styles.ts';
import { Bus } from '../../../src/engines/v2/synth/bus.ts';
import { lufs } from '../../../src/engines/v2/synth/dsp.ts';
import { snare } from '../../../src/engines/v2/synth/instruments.ts';
import { early, melodyOffset, renderScore, tape } from '../../../src/engines/v2/synth/render.ts';
import { string } from '../../../src/engines/v2/synth/strings.ts';
import { wind } from '../../../src/engines/v2/synth/voice.ts';
import { Clock, tempoAt } from '../../../src/engines/v2/tempo.ts';
import { MODES, pc } from '../../../src/engines/v2/theory.ts';
import { type Ev, isMelody, type StyleId, TAKES } from '../../../src/engines/v2/types.ts';

Deno.test('movements run as long as the listener chose', () => {
  const bounds = { short: [95, 175], standard: [165, 265], long: [265, 400] } as const;
  for (const length of ['short', 'standard', 'long'] as const) {
    const [lo, hi] = bounds[length];
    for (const style of STYLE_IDS) {
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
    const seconds = (last.bars * 240) / mv.bpm;
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

Deno.test('a movement builds: it starts low and peaks in its last chorus or drop', () => {
  for (const style of STYLE_IDS) {
    for (let seed = 0; seed < 4; seed++) {
      const mv = new Song(`arc-${style}-${seed}`, [style]).movement(0);
      const sounding = mv.sections.filter((s) => s.role !== 'rest');
      const big = sounding.map((s, i) => [s, i] as const).filter(([s]) => s.role === 'chorus' || s.role === 'drop');
      assert(sounding[0].energy < 0.5, `${style}: opens at ${sounding[0].energy.toFixed(2)}`);
      if (!big.length) continue;
      const peak = Math.max(...sounding.map((s) => s.energy));
      assertEquals(peak, 1);
      assertEquals(big[big.length - 1][0].energy, peak, `${style}: the last ${big[0][0].role} is not the peak`);
      assert(big[0][0].energy < peak || big.length === 1);
    }
  }
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
    const notes = all
      // a grace note leaning into the next is how a return is played, not what it plays
      .filter(([t], i) => !(all[i + 1] && all[i + 1][0] - t < 0.1))
      // half a 16th before halfway: written notes sit on the grid, performed ones move less than that
      .filter(([t]) => t < s.duration / 2 - 60 / s.bpm / 8);
    // the first half as intervals (independent of a key lift; the ending may turn towards what comes next)
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
      const later = mv.sections.slice(k + 1).some((s, j) =>
        s.role === sec.role && mv.sections[k + j]?.role !== sec.role
      );
      assertEquals(ctx.finalTurn, !later);
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
        const part = `${e.i}:${'k' in e ? e.k : e.i === 'tom' ? e.n : ''}`;
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
  const song = new Song('feel-ember', ['ember']);
  const mv = song.movement(0);
  const sections = mv.sections.map((_, k) => composeSection(song, mv.firstSection + k));
  const snares = sections.flatMap((s) => s.events.filter((e) => e.i === 'snare').map((e) => e.v)).sort((a, b) => a - b);
  const ghost = snares[Math.floor(snares.length * 0.1)] / snares[Math.floor(snares.length * 0.9)];
  assert(ghost < 0.3, `ghost notes are ${ghost.toFixed(2)} of the backbeat`);
  // a rock drummer pushes on the cymbals and leans back on the backbeat
  // against the written grid: the band's tempo moves the grid itself
  const s16 = 60 / mv.bpm / 4;
  const offsets = (f: (e: Ev) => boolean) =>
    sections.flatMap((s) => {
      const clock = new Clock(mv, s.local);
      return s.events.filter(f).map((e) => clock.written(e.t)).map((t) => t - Math.round(t / s16) * s16);
    });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const kick = mean(offsets((e) => e.i === 'kick'));
  const hats = mean(offsets((e) => e.i === 'hat'));
  const backbeat = mean(offsets((e) => e.i === 'snare'));
  assert(hats < kick - 0.002, `hats ${((hats - kick) * 1000).toFixed(1)} ms from the kick`);
  assert(backbeat > kick + 0.003, `backbeat ${((backbeat - kick) * 1000).toFixed(1)} ms from the kick`);
});

Deno.test("a sequencer's tempo never moves", () => {
  for (const style of STYLE_IDS.filter((x) => !Object.values(STYLES[x].tempo).some(Boolean))) {
    const mv = new Song(`steady-${style}`, [style]).movement(0);
    mv.sections.forEach((sec, k) => {
      assert(new Clock(mv, k).steady, `${style} ${sec.role} moves`);
      assertEquals(sec.seconds, sec.bars * (240 / mv.bpm));
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
  assert(!clock.steady && s.duration > s.section.bars * (240 / mv.bpm), 'the last bars are not drawn out');
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
  const song = new Song('listening', ['garden']);
  const mv = song.movement(0);
  const k = mv.sections.findIndex((s, i) => mv.sections[i + 1] && mv.sections[i + 1].energy - s.energy > 0.2);
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
  const written = mv.sections[k].bars * (240 / mv.bpm);
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
  const bar = 240 / mv.bpm;
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
