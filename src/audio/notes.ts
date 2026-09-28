// Plays single notes of the engine's instruments: each is rendered once in the render workers (in its style's mix)
// and kept, so a key plays at once the second time. An instrument's notes are prepared in the background when it is
// chosen; a note played before it's ready jumps the queue.

import type { Rendered } from '../core/engine.ts';
import { CancelledError, RenderPool } from './pool.ts';

/** A sounding note: let go, it fades as a damped string or a released key does (or rings on, `ring`). */
export interface Voice {
  release(): void;
}

const FADE = 0.25;

export class NotePlayer {
  readonly ctx: AudioContext;
  private readonly pool: RenderPool;
  private readonly out: GainNode;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();

  constructor(private readonly version: number, workerUrl: URL, workers: number) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(this.ctx.destination);
    this.pool = new RenderPool(workerUrl, workers);
  }

  /**
   * Renders an instrument's notes in the background, dropping what was queued for another; `ready` is called as each
   * one is (at once, for one already rendered).
   */
  prepare(instrument: string, notes: readonly (number | string)[], ready?: () => void): void {
    this.pool.cancelQueued();
    for (const n of notes) void this.buffer(instrument, n, false).then(() => ready?.(), () => {});
  }

  /**
   * Plays a note now (or as soon as it's rendered). `ring`: a struck or plucked note rings out when let go; otherwise
   * it fades, as a key or a breath does.
   */
  play(instrument: string, note: number | string, ring: boolean): Voice {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    let released = false;
    let stop: (() => void) | null = null;
    void this.buffer(instrument, note, true).then((buf) => {
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      src.buffer = buf;
      src.connect(gain).connect(this.out);
      src.start();
      stop = () => {
        const t = this.ctx.currentTime;
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + FADE);
        src.stop(t + FADE + 0.02);
      };
      // a tap let go before the note was ready still sounds, briefly
      if (released && !ring) setTimeout(() => stop?.(), 150);
    }, () => {});
    return {
      release: () => {
        if (released) return;
        released = true;
        if (!ring) stop?.();
      },
    };
  }

  dispose(): void {
    this.pool.dispose();
    void this.ctx.close();
  }

  private buffer(instrument: string, note: number | string, urgent: boolean): Promise<AudioBuffer> {
    const key = `${instrument}|${note}`;
    const known = this.buffers.get(key);
    if (known) return known;
    const job = { kind: 'note', version: this.version, instrument, note, sampleRate: this.ctx.sampleRate } as const;
    const p = this.pool.render(job, urgent).then((r) => this.toBuffer(r));
    this.buffers.set(key, p);
    // a cancelled or failed render is forgotten, so it can be asked for again
    p.catch((e) => {
      if (this.buffers.get(key) === p) this.buffers.delete(key);
      if (!(e instanceof CancelledError)) console.warn(`could not render ${key}: ${e}`);
    });
    return p;
  }

  private toBuffer(r: Pick<Rendered, 'left' | 'right'>): AudioBuffer {
    const buf = this.ctx.createBuffer(2, r.left.length, this.ctx.sampleRate);
    buf.copyToChannel(r.left as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(r.right as Float32Array<ArrayBuffer>, 1);
    return buf;
  }
}
