import { assert, assertEquals } from '@std/assert';
import { engine } from '../../src/engines/index.ts';
import { keymap, noteName, shifts, SPAN, windowBase } from '../../src/ui/instruments/keys.ts';

Deno.test('the computer keyboard plays two and a half octaves from a C, inside the instrument', () => {
  const piano = engine(2).instruments!.find((x) => x.id === 'piano')!;
  const base = windowBase(piano.range!);
  assertEquals(base % 12, 0);
  const keys = keymap(piano, base);
  assertEquals(keys.get('KeyZ'), { note: base });
  assertEquals(keys.get('KeyS'), { note: base + 1 });
  assertEquals(keys.get('KeyQ'), { note: base + 12 });
  assertEquals(keys.get('Comma'), { note: base + 12 });
  assertEquals(keys.get('KeyP'), { note: base + SPAN });
  assertEquals(noteName(60), 'C4');
  assertEquals(noteName(61), 'C♯4');
  // every instrument's window starts on a C, sits at least an octave inside its range, and shifts only as far
  for (const inst of engine(2).instruments!) {
    if (!inst.range) continue;
    const [down, up] = shifts(inst.range);
    assert(down <= 0 && up >= 0, inst.id);
    for (let s = down; s <= up; s++) {
      const b = windowBase(inst.range, s);
      const notes = [...keymap(inst, b).values()].map((x) => ('note' in x ? x.note : NaN));
      assert(notes.length >= 12, `${inst.id} at ${s}: ${notes.length} notes`);
      assert(notes.every((n) => n >= inst.range![0] && n <= inst.range![1]), inst.id);
    }
  }
});

Deno.test('an unpitched instrument lays its sounds along the keys, each once', () => {
  const kit = engine(2).instruments!.find((x) => x.id === 'kit:acoustic')!;
  const keys = keymap(kit, 0);
  assertEquals(keys.size, kit.hits!.length);
  assertEquals(keys.get('KeyZ'), { hit: 'kick', name: 'Kick' });
  assertEquals(new Set([...keys.values()].map((x) => ('hit' in x ? x.hit : ''))).size, keys.size);
});
