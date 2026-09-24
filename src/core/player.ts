// The contract between the interface and whatever plays the music. The UI only knows this port; the
// browser implementation lives in src/audio.

import type { Song } from './plan.ts';
import type { Score } from './types.ts';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused';

export interface Position {
  /** Global section index and seconds into it. */
  index: number;
  offset: number;
  score: Score;
  /** Seconds into the section's movement. */
  movementTime: number;
}

export interface PlayerEvents {
  state: PlayerState;
  /** A new section became audible. */
  section: Score;
  error: string;
}

export interface PlayerPort {
  readonly state: PlayerState;
  readonly song: Song;
  readonly repeat: boolean;
  readonly volume: number;

  /** Switches to another song (or position) without starting playback if paused. */
  load(song: Song, index?: number, offset?: number): void;
  play(): Promise<void>;
  pause(): void;
  seek(index: number, offset: number): void;
  /** What is audible right now (latency-compensated), or the pending start position when stopped. */
  position(): Position;
  /** The score of a section, composed on demand (cheap and cached). */
  score(index: number): Score;
  setRepeat(on: boolean): void;
  setVolume(v: number): void;
  /** Fades out and pauses after `minutes`; null cancels. */
  setSleep(minutes: number | null): void;
  /** Milliseconds until the sleep timer fires, or null. */
  sleepRemaining(): number | null;
  /** Renders movement `m` start to end as a WAV file. */
  exportMovement(m: number): Promise<Uint8Array<ArrayBuffer>>;
  on<K extends keyof PlayerEvents>(event: K, fn: (v: PlayerEvents[K]) => void): () => void;
}
