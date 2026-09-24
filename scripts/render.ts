// Offline render of a seed to WAV, with per-section measurements. Handy for listening outside the browser
// and for checking the mix: loudness, true peak, render speed.
//
//   deno task render --seed amber-quiet-harbor --movement 1 [--sections 3] [--rate 48000] [--out out]

import { parseArgs } from '@std/cli/parse-args';
import { Song } from '../src/core/plan.ts';
import { lufs } from '../src/core/synth/dsp.ts';
import { renderSpan } from '../src/core/synth/span.ts';
import { keyName } from '../src/core/theory.ts';
import { encodeWav } from '../src/audio/wav.ts';

const args = parseArgs(Deno.args, {
  string: ['seed', 'out', 'styles'],
  default: { seed: 'amber-quiet-harbor', movement: 1, rate: 48000, out: 'out' },
});
const song = new Song(args.seed, args.styles ? args.styles.split(',') as never : undefined);
const mv = song.movement(Math.max(0, Number(args.movement) - 1));
const count = args.sections ? Number(args.sections) : mv.sections.length;
const sr = Number(args.rate);

console.log(`${song.phrase} · ${mv.index + 1}. ${mv.title} · ${mv.style} · ${keyName(mv.key)} · ${mv.bpm} BPM`);
const t0 = performance.now();
const out = renderSpan(song, mv.firstSection, count, sr, (s) => {
  const sec = song.section(s.index);
  const role = sec.movement.sections[sec.local].role;
  console.log(
    `  #${s.index} ${role.padEnd(6)} ${sec.duration.toFixed(1).padStart(5)} s  raw ${
      s.lufs.toFixed(1).padStart(6)
    } LUFS  gain ${(20 * Math.log10(s.gain)).toFixed(1).padStart(5)} dB  ${s.ms.toFixed(0).padStart(5)} ms  (${
      ((sec.duration * 1000) / s.ms).toFixed(1)
    }x realtime)`,
  );
});
const secs = out.left.length / sr;
let peak = 0;
let bad = 0;
for (let i = 0; i < out.left.length; i++) {
  const a = Math.max(Math.abs(out.left[i]), Math.abs(out.right[i]));
  if (!Number.isFinite(a)) bad++;
  else if (a > peak) peak = a;
}
console.log(
  `total ${secs.toFixed(1)} s in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${
    lufs(sr, out.left, out.right).toFixed(1)
  } LUFS · peak ${(20 * Math.log10(peak)).toFixed(2)} dBFS · non-finite samples: ${bad}`,
);
await Deno.mkdir(args.out, { recursive: true });
const file = `${args.out}/${song.phrase}-${mv.index + 1}.wav`;
await Deno.writeFile(file, encodeWav(out.left, out.right, sr));
console.log(`wrote ${file}`);
