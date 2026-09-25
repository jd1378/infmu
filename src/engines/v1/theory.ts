// Pitch, modes, chords and voice leading. Pitches are MIDI numbers; a "degree" is a step in the current
// mode, counted from the tonic (0), and may be negative or span octaves.

export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
} as const;

export type ModeName = keyof typeof MODES;

/** What a listener would call the mode: "D minor" reads better than "D aeolian". */
export const MODE_LABEL: Record<ModeName, string> = {
  ionian: 'major',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  aeolian: 'minor',
  harmonic: 'harmonic minor',
};

// Where the mode's parent major scale sits, for choosing flats or sharps.
const PARENT_OFFSET: Record<ModeName, number> = {
  ionian: 0,
  dorian: 2,
  phrygian: 4,
  lydian: 5,
  mixolydian: 7,
  aeolian: 9,
  harmonic: 9,
};

const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const FLAT_PARENTS = new Set([5, 10, 3, 8, 1]);

export const pc = (midi: number) => ((midi % 12) + 12) % 12;
export const mod = (x: number, n: number) => ((x % n) + n) % n;

export interface Key {
  tonic: number; // pitch class
  mode: ModeName;
}

const MINOR_MODES = new Set<ModeName>(['aeolian', 'harmonic', 'dorian', 'phrygian']);

export function noteName(pitchClass: number, key: Key): string {
  const parent = mod(key.tonic - PARENT_OFFSET[key.mode], 12);
  // six accidentals either way: E♭ minor and F♯ major are the spellings musicians expect
  const flats = FLAT_PARENTS.has(parent) || (parent === 6 && MINOR_MODES.has(key.mode));
  return (flats ? FLATS : SHARPS)[pc(pitchClass)];
}

export const keyName = (key: Key) => `${noteName(key.tonic, key)} ${MODE_LABEL[key.mode]}`;

/** Degree -> MIDI, with degree 0 at `tonicMidi`. */
export function degreeToMidi(key: Key, degree: number, tonicMidi: number): number {
  const scale = MODES[key.mode];
  return tonicMidi + 12 * Math.floor(degree / 7) + scale[mod(degree, 7)];
}

/** The MIDI number of the tonic nearest to `around` (from below). */
export function tonicNear(key: Key, around: number): number {
  return around - mod(around - key.tonic, 12);
}

/** Nearest degree to a MIDI note (ties resolve downward). Chromatic notes land on a neighbour. */
export function midiToDegree(key: Key, midi: number, tonicMidi: number): number {
  let best = 0;
  let bestD = Infinity;
  const guess = Math.round(((midi - tonicMidi) * 7) / 12);
  for (let d = guess - 2; d <= guess + 2; d++) {
    const dist = Math.abs(degreeToMidi(key, d, tonicMidi) - midi);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

// ------------------------------------------------------------------ chords

/**
 * A chord built by stacking thirds inside the mode from degree `deg`. `size` 3 = triad, 4 = seventh,
 * 5 = ninth. `sus` swaps the third for the 2nd or 4th. `alt` nudges chord tones chromatically
 * (index = chord tone: 0 root, 1 third, 2 fifth, 3 seventh), e.g. a major V in minor is alt [0, 1].
 */
export interface ChordSpec {
  deg: number;
  size: 3 | 4 | 5;
  sus?: 2 | 4;
  alt?: readonly number[];
  /** Semitone shift of the whole chord, for borrowed chords such as bVII in major. */
  shift?: number;
}

/** Pitch classes of the chord, root first, then the upper tones in stacking order. */
export function chordPitchClasses(key: Key, c: ChordSpec): number[] {
  const steps = [0, 2, 4, 6, 8].slice(0, c.size);
  if (c.sus) steps[1] = c.sus === 2 ? 1 : 3;
  return steps.map((s, i) => pc(degreeToMidi(key, c.deg + s, key.tonic) + (c.alt?.[i] ?? 0) + (c.shift ?? 0)));
}

export const chordRoot = (key: Key, c: ChordSpec) => chordPitchClasses(key, c)[0];

const QUALITY: [number[], string][] = [
  [[4, 7, 11, 2], 'maj9'],
  [[3, 7, 10, 2], 'm9'],
  [[4, 7, 10, 2], '9'],
  [[4, 7, 11], 'maj7'],
  [[3, 7, 10], 'm7'],
  [[4, 7, 10], '7'],
  [[3, 6, 10], 'ø7'],
  [[3, 6, 9], '°7'],
  [[3, 7, 11], 'm(maj7)'],
  [[4, 8, 11], '+maj7'],
  [[4, 7, 2], 'add9'],
  [[3, 7, 2], 'm(add9)'],
  [[2, 7, 10], '7sus2'],
  [[5, 7, 10], '7sus4'],
  [[4, 7], ''],
  [[3, 7], 'm'],
  [[3, 6], '°'],
  [[4, 8], '+'],
  [[2, 7], 'sus2'],
  [[5, 7], 'sus4'],
];

export function chordName(key: Key, c: ChordSpec): string {
  const pcs = chordPitchClasses(key, c);
  const root = pcs[0];
  const ivs = new Set(pcs.slice(1).map((p) => mod(p - root, 12)));
  for (const [need, q] of QUALITY) {
    if (need.length === ivs.size && need.every((i) => ivs.has(i))) return noteName(root, key) + q;
  }
  return noteName(root, key);
}

// ------------------------------------------------------------------ voice leading

/**
 * Chooses a voicing of `pcs` in [lo, hi] with `voices` notes that moves least from `prev`: every voice
 * holds or steps where it can, which is what makes a pad sound like an ensemble instead of block chords.
 * Brute force over nearby notes per voice; at most a few thousand candidates.
 */
export function voiceLead(
  prev: readonly number[] | null,
  pcs: readonly number[],
  voices: number,
  lo: number,
  hi: number,
): number[] {
  const center = (lo + hi) / 2;
  const from = prev && prev.length === voices ? prev : spread(voices, center);
  const allowed = new Set(pcs);
  const essential = pcs.length > 3 ? [pcs[1], pcs[3]] : [pcs[1]]; // third (and seventh) define the colour
  const cands = from.map((p) => {
    const out: number[] = [];
    for (let m = Math.max(lo, p - 6); m <= Math.min(hi, p + 6); m++) if (allowed.has(pc(m))) out.push(m);
    return out.length ? out : [nearestIn(allowed, p, lo, hi)];
  });

  let best: number[] = [];
  let bestCost = Infinity;
  const cur: number[] = new Array(voices);
  const walk = (v: number, cost: number) => {
    if (cost >= bestCost) return;
    if (v === voices) {
      const have = new Set(cur.map(pc));
      let c = cost;
      for (const e of essential) if (!have.has(e)) c += 9;
      c += (pcs.length - Math.min(pcs.length, have.size)) * 2; // unused chord tones
      const mean = cur.reduce((s, x) => s + x, 0) / voices;
      c += Math.abs(mean - center) * 0.35; // don't let the register wander over many chords
      if (c < bestCost) {
        bestCost = c;
        best = cur.slice();
      }
      return;
    }
    for (const m of cands[v]) {
      if (v > 0) {
        const gap = m - cur[v - 1];
        if (gap < 1) continue; // no crossing, no unisons
        if (m < 55 && gap < 3) continue; // low close intervals turn to mud
      }
      cur[v] = m;
      walk(v + 1, cost + Math.abs(m - from[v]));
    }
  };
  walk(0, 0);
  return best.length ? best : spread(voices, center).map((p) => nearestIn(allowed, p, lo, hi)).sort((a, b) => a - b);
}

function spread(voices: number, center: number): number[] {
  const width = 4 * (voices - 1);
  return Array.from({ length: voices }, (_, i) => Math.round(center - width / 2 + 4 * i));
}

function nearestIn(allowed: Set<number>, p: number, lo: number, hi: number): number {
  for (let d = 0; d < 12; d++) {
    if (p - d >= lo && allowed.has(pc(p - d))) return p - d;
    if (p + d <= hi && allowed.has(pc(p + d))) return p + d;
  }
  return p;
}
