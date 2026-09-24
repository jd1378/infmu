import { assertEquals } from '@std/assert';
import { encodeWav } from '../../src/audio/wav.ts';

Deno.test('wav header and samples', () => {
  const l = Float32Array.from([0, 0.5, -1, 2]);
  const r = Float32Array.from([1, -0.5, 0, -2]);
  const bytes = encodeWav(l, r, 44100);
  const v = new DataView(bytes.buffer);
  const text = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
  assertEquals([text(0), text(8), text(12), text(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assertEquals(v.getUint32(4, true), bytes.length - 8);
  assertEquals(v.getUint16(22, true), 2);
  assertEquals(v.getUint32(24, true), 44100);
  assertEquals(v.getUint32(40, true), 16);
  const samples = Array.from({ length: 8 }, (_, i) => v.getInt16(44 + 2 * i, true));
  // interleaved L R; 0.5 * 32767 rounds up to 16384, -16383.5 rounds up to -16383; past ±1 is clamped
  assertEquals(samples, [0, 32767, 16384, -16383, -32767, 0, 32767, -32767]);
});
