import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { composeSection } from '../../../src/engines/v2/compose/index.ts';
import { Ctx, sectionKey } from '../../../src/engines/v2/compose/context.ts';
import { Song } from '../../../src/engines/v2/plan.ts';
import { STYLE_IDS } from '../../../src/engines/v2/styles.ts';
import { lufs } from '../../../src/engines/v2/synth/dsp.ts';
import { melodyOffset, renderScore } from '../../../src/engines/v2/synth/render.ts';
import { MODES, pc } from '../../../src/engines/v2/theory.ts';
import { type Ev, isMelody } from '../../../src/engines/v2/types.ts';

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
    const notes = mel.filter((e) => voiceOf(e) === voice)
      .flatMap((e) => ('ns' in e ? e.ns.map((n) => [n.t, n.n]) : [[e.t, (e as { n: number }).n]]))
      // half a 16th before halfway: written notes sit on the grid, performed ones move less than that
      .filter(([t]) => t < s.duration / 2 - 60 / s.bpm / 8)
      .sort((a, b) => a[0] - b[0]);
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
