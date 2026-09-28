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
  /** Seconds it plays for, when its bars don't all last 240 / bpm (a moving tempo, a time other than 4/4). */
  seconds?: number;
}

export interface MovementInfo {
  index: number;
  title: string;
  style: StyleInfo;
  key: KeyInfo;
  bpm: number;
  /** The time signature, when the engine has more than one ('3/4', '6/8'; absent means 4/4). */
  meter?: string;
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
  /** Seconds from the section start of each bar line, the end included, when the tempo moves (else 240 / bpm apart). */
  bars?: readonly number[];
  movement: MovementInfo;
  section: SectionInfo;
  /** The key this section plays in: the movement's, or another after a key change. */
  key: KeyInfo;
  chords: ChordSpan[];
  /** Sorted by time. */
  cues: Cue[];
}

/** What an instrument is: how a listener would group it, and what it looks like to play. */
export type InstrumentFamily =
  | 'piano'
  | 'keys'
  | 'organ'
  | 'mallets'
  | 'kalimba'
  | 'bells'
  | 'guitar'
  | 'harp'
  | 'bass'
  | 'synth bass'
  | 'winds'
  | 'voices'
  | 'synths'
  | 'pads'
  | 'drums'
  | 'percussion'
  | 'effects';

/** An instrument a listener can play by itself (see Engine.renderNote). */
export interface InstrumentInfo {
  id: string;
  name: string;
  family: InstrumentFamily;
  /** A pitched instrument's lowest and highest MIDI notes. */
  range?: readonly [lo: number, hi: number];
  /** An unpitched one's sounds (a kit's drums, an effect's kinds), in the order they're laid out. */
  hits?: readonly { id: string; name: string }[];
  /** A line on what it is. */
  about: string;
}

export interface SongPlan {
  readonly version: number;
  readonly phrase: string;
  readonly styles: readonly string[];
  /** The listener's choice of movement length ('standard' unless the engine offers others). */
  readonly length: string;
  /** The listener's choice of the music's range ('adventurous' unless the engine offers others). */
  readonly character: string;
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
  /** How far the music may range, as a listener can choose (the first is the default); absent when fixed. */
  readonly characters?: readonly { id: string; label: string }[];
  song(phrase: string, styles?: readonly string[], length?: string, character?: string): SongPlan;
  /** Every instrument the engine synthesizes that can be played alone; absent when it offers none. */
  readonly instruments?: readonly InstrumentInfo[];
  /** One note of an instrument: a MIDI note for a pitched one, a hit id for an unpitched one. */
  renderNote?(instrument: string, note: number | string, sampleRate: number): Rendered;
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
