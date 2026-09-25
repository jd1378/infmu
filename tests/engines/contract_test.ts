// What every engine version must honour, whatever it composes.

import { assert, assertAlmostEquals, assertEquals, assertThrows } from '@std/assert';
import { engine, LATEST_VERSION, LEGACY_VERSION, VERSIONS } from '../../src/engines/index.ts';

const SR = 8000;

Deno.test('versions are registered, newest first', () => {
  assertEquals(VERSIONS[0], LATEST_VERSION);
  assertEquals(LEGACY_VERSION, 1);
  assertEquals(VERSIONS[VERSIONS.length - 1], 1);
  assertThrows(() => engine(999));
});

for (const v of VERSIONS) {
  const e = engine(v);

  Deno.test(`v${v}: the same seed plans, scores and renders identically`, () => {
    const a = e.song('contract');
    const b = e.song('contract');
    b.section(120);
    for (let m = 0; m < 6; m++) assertEquals(a.movement(m), b.movement(m));
    assertEquals(e.score(a, 9), e.score(b, 9));
    const ra = e.render(a, 4, SR);
    const rb = e.render(b, 4, SR);
    assertEquals(ra.left, rb.left);
    assertEquals(ra.right, rb.right);
  });

  Deno.test(`v${v}: movements, sections and time line up`, () => {
    const song = e.song('timeline');
    for (let m = 0; m < 8; m++) {
      const mv = song.movement(m);
      assertEquals(mv.index, m);
      if (m) {
        const prev = song.movement(m - 1);
        assertEquals(mv.firstSection, prev.firstSection + prev.sections.length);
        assertAlmostEquals(mv.startTime, prev.startTime + prev.duration, 1e-6);
      }
      let offset = 0;
      mv.sections.forEach((_, local) => {
        const ref = song.section(mv.firstSection + local);
        assertEquals(ref.local, local);
        assertAlmostEquals(ref.offset, offset, 1e-6);
        const score = e.score(song, ref.index);
        assertAlmostEquals(score.duration, ref.duration, 1e-9);
        assertEquals(song.locate(m, offset + 0.25).index, ref.index);
        offset += ref.duration;
      });
      assertAlmostEquals(offset, mv.duration, 1e-6);
    }
  });

  Deno.test(`v${v}: scores are well formed`, () => {
    const song = e.song('well-formed');
    for (let i = 0; i < 24; i++) {
      const s = e.score(song, i);
      assert(s.chords.length > 0);
      assertEquals(s.movement.key.names.length, 12);
      assert(s.movement.key.scale.includes(s.movement.key.tonic));
      let t = -Infinity;
      for (const c of s.cues) {
        assert(c.t >= t, 'cues are sorted');
        t = c.t;
        assert(Number.isFinite(c.v) && c.t >= 0 && c.t < s.duration + s.tail);
      }
    }
  });

  Deno.test(`v${v}: style filters are kept`, () => {
    for (const st of e.styles) {
      const song = e.song('filter', [st.id]);
      for (let m = 0; m < 5; m++) assertEquals(song.movement(m).style.id, st.id);
    }
    assertEquals(e.song('x', ['no-such-style']).styles.length, e.styles.length);
  });

  Deno.test(`v${v}: audio is finite and under the ceiling`, () => {
    const song = e.song('ceiling');
    const r = e.renderSpan(song, 0, 4, SR);
    let peak = 0;
    for (let i = 0; i < r.left.length; i++) {
      assert(Number.isFinite(r.left[i]) && Number.isFinite(r.right[i]));
      peak = Math.max(peak, Math.abs(r.left[i]), Math.abs(r.right[i]));
    }
    assert(20 * Math.log10(peak) <= -0.99, `peak ${20 * Math.log10(peak)}`);
  });
}
