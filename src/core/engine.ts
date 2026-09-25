// The contract every composer engine implements. An engine is sealed once released: a seed played by
// version N must sound the same forever, so improvements go into a new version instead of changing an old
// one. The interface, the player and the render worker only ever talk to engines through this port.

export interface StyleInfo {
  id: string;
  name: string;
  genre: string;
}

export interface KeyInfo {
  tonic: number; // pitch class
  /** Mode name, e.g. "dorian"; the interface tints the page by it. */
  mode: string;
  /** "E♭ minor" */
  label: string;
  /** Pitch classes of the mode. */
  scale: number[];
  /** The twelve pitch classes spelled for this key (flats or sharps). */
  names: string[];
}

export interface SectionInfo {
  role: string;
  bars: number;
  /** 0..1 */
  energy: number;
}

export interface MovementInfo {
  index: number;
  title: string;
  style: StyleInfo;
  key: KeyInfo;
  bpm: number;
  swing: number;
  sections: SectionInfo[];
  /** Global index of the movement's first section. */
  firstSection: number;
  /** Seconds from the start of the song. */
  startTime: number;
  duration: number;
}

export interface SectionRef {
  index: number;
  movement: MovementInfo;
  local: number;
  /** Seconds from the start of the movement. */
  offset: number;
  duration: number;
}

export interface ChordSpan {
  t: number;
  d: number;
  name: string;
  pcs: number[];
}

/** What the visuals react to: the score reduced to a few kinds of moment. */
export type CueKind = 'kick' | 'snare' | 'impact' | 'pad' | 'chord' | 'bass' | 'pluck' | 'perc' | 'bell' | 'melody';

export interface Cue {
  t: number;
  kind: CueKind;
  v: number;
  n?: number;
  d?: number;
}

export interface SectionScore {
  index: number;
  local: number;
  /** Seconds from the start of the movement. */
  offset: number;
  duration: number;
  /** Seconds rendered past `duration` for reverb and echo tails. */
  tail: number;
  bpm: number;
  movement: MovementInfo;
  section: SectionInfo;
  /** The key this section plays in: the movement's, or another after a key change. */
  key: KeyInfo;
  chords: ChordSpan[];
  /** Sorted by time. */
  cues: Cue[];
}

export interface SongPlan {
  readonly version: number;
  readonly phrase: string;
  readonly styles: readonly string[];
  /** The listener's choice of movement length ('standard' unless the engine offers others). */
  readonly length: string;
  movement(m: number): MovementInfo;
  section(i: number): SectionRef;
  locate(m: number, t: number): { index: number; offset: number };
}

export interface Rendered {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Loudness before leveling and the gain applied (single sections only). */
  lufs: number;
  gain: number;
}

export interface SectionStats {
  index: number;
  /** Loudness before leveling, and the leveling gain. */
  lufs: number;
  gain: number;
  /** Render time in milliseconds. */
  ms: number;
}

export interface Engine {
  readonly version: number;
  /** Shown to listeners, e.g. "the original composer". */
  readonly about: string;
  readonly styles: readonly StyleInfo[];
  /** Movement lengths a listener can choose from (the first is the default); absent when fixed. */
  readonly lengths?: readonly { id: string; label: string }[];
  song(phrase: string, styles?: readonly string[], length?: string): SongPlan;
  score(song: SongPlan, index: number): SectionScore;
  render(song: SongPlan, index: number, sampleRate: number): Rendered;
  /** Sections [from, from + count) played back to back with their tails, as the player hears them. */
  renderSpan(
    song: SongPlan,
    from: number,
    count: number,
    sampleRate: number,
    onSection?: (s: SectionStats) => void,
  ): Rendered;
}
