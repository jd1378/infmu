// Plays an endless song in the browser. Sections are rendered in workers and scheduled on the AudioContext
// clock back to back; each one carries a few seconds of tail (reverb, echoes) that overlaps the next, so
// the joins are seamless. Seeking renders the target section and the one before it (for its tail), so
// the music at any point sounds exactly as if you had listened from the start.

import type { SectionScore, SongPlan } from '../core/engine.ts';
import type { PlayerEvents, PlayerPort, PlayerState, Position } from '../core/player.ts';
import { engine } from '../engines/index.ts';
import { CancelledError, RenderPool } from './pool.ts';
import { encodeWav } from './wav.ts';

/** Seconds of audio kept rendered and scheduled ahead of the playhead. */
const LOOKAHEAD = 30;
const START_DELAY = 0.1;
const SLEEP_FADE_MS = 30_000;

interface Entry {
  index: number;
  start: number;
  duration: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Scheduled only for its reverb tail (the section before a seek target): never "the" section playing. */
  tailOnly: boolean;
}

export class WebPlayer implements PlayerPort {
  state: PlayerState = 'idle';
  song: SongPlan;
  /** Context time the latest start becomes audible. */
  private audibleFrom = 0;
  repeat = false;
  volume = 0.8;

  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private out: GainNode | null = null;
  private readonly pool: RenderPool;
  private readonly workerUrl: URL;
  private buffers = new Map<number, Promise<AudioBuffer>>();
  private scores = new Map<number, SectionScore>();
  private entries: Entry[] = [];
  /** Next section to schedule, and when (context time) it starts. */
  private cursor: { index: number; start: number } | null = null;
  private rendering = false;
  /** Where playback resumes from when nothing is scheduled. */
  private pending = { index: 0, offset: 0 };
  /** Bumped whenever the plan changes; async results from an older generation are dropped. */
  private gen = 0;
  /**
   * What the listener asked for last. The AudioContext suspends and resumes asynchronously (and the OS can
   * interrupt it), so the context's state alone can't tell a quick pause-play apart from an interruption.
   */
  private intent: 'play' | 'pause' = 'pause';
  private audibleIndex = -1;
  private sleepAt: number | null = null;
  private fading = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly listeners: { [K in keyof PlayerEvents]: Set<(v: PlayerEvents[K]) => void> } = {
    state: new Set(),
    section: new Set(),
    error: new Set(),
  };

  constructor(song: SongPlan, workerUrl: URL, workers: number) {
    this.song = song;
    this.workerUrl = workerUrl;
    this.pool = new RenderPool(workerUrl, workers);
    this.timer = setInterval(() => this.tick(), 200);
  }

  /** Stops playback for good and releases the workers and the audio context. */
  dispose(): void {
    clearInterval(this.timer);
    this.gen++;
    this.intent = 'pause';
    this.stopAll(false);
    this.pool.dispose();
    void this.ctx?.close().catch(() => {});
  }

  // ------------------------------------------------------------------ port

  on<K extends keyof PlayerEvents>(event: K, fn: (v: PlayerEvents[K]) => void): () => void {
    const set = this.listeners[event] as Set<(v: PlayerEvents[K]) => void>;
    set.add(fn);
    return () => set.delete(fn);
  }

  load(song: SongPlan, index = 0, offset = 0): void {
    if (song !== this.song) {
      this.song = song;
      this.buffers.clear();
      this.scores.clear();
      this.cancelQueued();
    }
    this.seek(index, offset);
  }

  async play(): Promise<void> {
    this.intent = 'play';
    const ctx = this.ensureContext();
    if (this.fading) this.restoreBus();
    await ctx.resume().catch(() => {});
    // paused again while resuming, or a start is already on its way
    if (this.intent !== 'play' || this.state === 'loading') return;
    if (this.entries.length && this.cursor) {
      this.setState('playing');
      this.pump();
    } else {
      await this.startAt(this.pending.index, this.pending.offset);
    }
  }

  pause(): void {
    this.intent = 'pause';
    if (!this.ctx || this.state === 'idle') return;
    // while loading, `pending` already holds where the listener is going; keep it
    if (this.state === 'playing') this.pending = this.currentPlace();
    if (this.state === 'loading') {
      this.gen++;
      this.stopAll(false);
    }
    void this.ctx.suspend();
    this.setState('paused');
  }

  seek(index: number, offset: number): void {
    this.pending = { index, offset: Math.max(0, offset) };
    this.audibleIndex = -1;
    if (this.state === 'playing' || this.state === 'loading') {
      void this.startAt(index, offset);
    } else {
      this.gen++;
      this.stopAll(false);
      this.emitSection(index);
    }
  }

  position(): Position {
    const { index, offset } = this.currentPlace();
    const score = this.score(index);
    return { index, offset, score, movementTime: score.offset + offset };
  }

  score(index: number): SectionScore {
    let s = this.scores.get(index);
    if (!s) {
      if (this.scores.size > 48) this.scores.clear();
      s = engine(this.song.version).score(this.song, index);
      this.scores.set(index, s);
    }
    return s;
  }

  setRepeat(on: boolean): void {
    this.repeat = on;
    if (!this.ctx || !this.cursor) return;
    // drop what hasn't started yet; the cursor re-plans from the last started section with the new rule
    const now = this.ctx.currentTime;
    this.gen++;
    this.rendering = false;
    const keep = this.entries.filter((e) => e.start <= now);
    for (const e of this.entries) if (!keep.includes(e)) this.stopEntry(e, true);
    this.entries = keep;
    const last = keep.reduce<Entry | null>((a, e) => (!a || e.start > a.start ? e : a), null);
    this.cursor = last ? { index: this.next(last.index), start: last.start + last.duration } : null;
    this.pump();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(this.volume ** 2, this.ctx.currentTime, 0.03);
  }

  setSleep(minutes: number | null): void {
    this.sleepAt = minutes ? performance.now() + minutes * 60_000 : null;
    if (this.fading) this.restoreBus();
  }

  sleepRemaining(): number | null {
    return this.sleepAt === null ? null : Math.max(0, this.sleepAt - performance.now());
  }

  async exportMovement(m: number): Promise<Uint8Array<ArrayBuffer>> {
    const mv = this.song.movement(m);
    const sampleRate = this.ctx?.sampleRate ?? 48000;
    const job = {
      kind: 'span' as const,
      version: this.song.version,
      phrase: this.song.phrase,
      styles: [...this.song.styles],
      length: this.song.length,
      character: this.song.character,
      from: mv.firstSection,
      count: mv.sections.length,
      sampleRate,
    };
    // its own worker, so a long export never holds up the sections playback is waiting for; if that worker
    // can't start (a page left open across a new deploy: its worker file is gone), the running ones do it
    const pool = new RenderPool(this.workerUrl, 1);
    try {
      const r = await pool.render(job).catch((err) => {
        if (err instanceof CancelledError) throw err;
        console.warn('export worker failed, using the playback workers', err);
        return this.pool.render(job);
      });
      return encodeWav(r.left, r.right, sampleRate);
    } finally {
      pool.dispose();
    }
  }

  // ------------------------------------------------------------------ scheduling

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    // iOS: let Web Audio play with the ringer switch off, like a music app
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.bus = ctx.createGain();
    // a safety limiter: each section is limited on its own, but overlapping tails can add up
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume ** 2;
    this.bus.connect(limiter).connect(this.out).connect(ctx.destination);
    ctx.onstatechange = () => {
      const running = ctx.state === 'running';
      if (this.intent === 'pause') {
        // resumed by someone else (the OS after an interruption) while the listener wants silence
        if (running) void ctx.suspend();
        return;
      }
      // interrupted (a phone call, another app taking audio): show it, and come back when the OS lets us
      if (!running && this.state === 'playing') this.setState('paused');
      else if (running && this.state === 'paused' && this.entries.length && this.cursor) {
        this.setState('playing');
        this.pump();
      }
    };
    this.ctx = ctx;
    return ctx;
  }

  private async startAt(index: number, offset: number): Promise<void> {
    const ctx = this.ensureContext();
    const gen = ++this.gen;
    // what's playing keeps playing until the new place is ready, then crossfades out
    this.rendering = false;
    this.cursor = null;
    this.cancelQueued();
    this.setState('loading');
    const ringing = this.ringing(index, offset);
    try {
      const [cur, ...earlier] = await Promise.all([this.buffer(index), ...ringing.map((r) => this.buffer(r.index))]);
      if (gen !== this.gen) return;
      if (ctx.state !== 'running') await ctx.resume();
      if (gen !== this.gen) return;
      this.stopAll(true);
      const t = ctx.currentTime + START_DELAY;
      this.audibleFrom = t;
      const start = t - offset;
      ringing.forEach((r, k) => this.schedule(r.index, earlier[k], start - r.before, true));
      this.schedule(index, cur, start);
      this.cursor = { index: this.next(index), start: start + this.score(index).duration };
      this.setState('playing');
      this.pump();
    } catch (err) {
      if (gen !== this.gen || err instanceof CancelledError) return;
      this.fail(err);
    }
  }

  /**
   * Earlier sections whose tails still ring at `offset` into section `index` (usually just the one before;
   * more when short sections such as a rest sit in between), with how long before `index` each one starts.
   */
  private ringing(index: number, offset: number): { index: number; before: number }[] {
    const out: { index: number; before: number }[] = [];
    let gap = offset; // from the end of section j to the place we start at
    let before = 0; // from the start of section j to the start of `index`
    for (let j = index - 1; j >= 0 && gap < 10; j--) {
      const s = this.score(j);
      before += s.duration;
      if (gap < s.tail) out.push({ index: j, before });
      gap += s.duration;
    }
    return out;
  }

  /** Keeps LOOKAHEAD seconds scheduled, rendering one section at a time. */
  private pump(): void {
    const ctx = this.ctx;
    if (!ctx || this.state !== 'playing' || !this.cursor || this.rendering) return;
    if (this.cursor.start - ctx.currentTime > LOOKAHEAD) return;
    const { index, start } = this.cursor;
    const gen = this.gen;
    this.rendering = true;
    this.buffer(index).then((buf) => {
      if (gen !== this.gen) return;
      this.rendering = false;
      // a render that arrives late (a slow device) opens a short gap instead of cutting in mid-section
      const s = Math.max(start, ctx.currentTime + 0.05);
      this.schedule(index, buf, s);
      this.cursor = { index: this.next(index), start: s + this.score(index).duration };
      this.pump();
    }, (err) => {
      if (gen !== this.gen || err instanceof CancelledError) return;
      this.rendering = false;
      this.fail(err);
    });
  }

  private schedule(index: number, buf: AudioBuffer, start: number, tailOnly = false): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    src.connect(gain).connect(this.bus!);
    const now = ctx.currentTime;
    if (start >= now) src.start(start);
    else if (now - start < buf.duration) src.start(now, now - start);
    else return;
    const entry: Entry = { index, start, duration: this.score(index).duration, src, gain, tailOnly };
    src.onended = () => {
      gain.disconnect();
      this.entries = this.entries.filter((e) => e !== entry);
    };
    this.entries.push(entry);
    this.prune(index);
  }

  private buffer(index: number): Promise<AudioBuffer> {
    let p = this.buffers.get(index);
    if (!p) {
      const ctx = this.ensureContext();
      const mine: Promise<AudioBuffer> = this.pool.render({
        kind: 'section',
        version: this.song.version,
        phrase: this.song.phrase,
        styles: [...this.song.styles],
        length: this.song.length,
        character: this.song.character,
        index,
        sampleRate: ctx.sampleRate,
      }).then((r) => {
        const buf = ctx.createBuffer(2, r.left.length, ctx.sampleRate);
        buf.copyToChannel(r.left, 0);
        buf.copyToChannel(r.right, 1);
        return buf;
      });
      mine.catch(() => {
        if (this.buffers.get(index) === mine) this.buffers.delete(index);
      });
      this.buffers.set(index, mine);
      p = mine;
    }
    return p;
  }

  /** Cancels renders that haven't started and forgets them at once, so the next request starts afresh. */
  private cancelQueued(): void {
    for (const req of this.pool.cancelQueued()) if (req.kind === 'section') this.buffers.delete(req.index);
  }

  /** Keeps only buffers around the playhead: the previous section (for seeking back) and the next few. */
  private prune(index: number): void {
    for (const k of this.buffers.keys()) if (k < index - 2 || k > index + 3) this.buffers.delete(k);
  }

  private next(index: number): number {
    const ref = this.song.section(index);
    if (this.repeat && ref.local === ref.movement.sections.length - 1) return ref.movement.firstSection;
    return index + 1;
  }

  private stopEntry(e: Entry, fade: boolean): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    e.src.onended = null;
    if (fade) {
      e.gain.gain.setTargetAtTime(0, t, 0.015);
      e.src.stop(t + 0.1);
    } else e.src.stop();
    setTimeout(() => e.gain.disconnect(), 200);
  }

  private stopAll(fade: boolean): void {
    if (!this.ctx) return;
    for (const e of this.entries) this.stopEntry(e, fade && this.ctx.state === 'running');
    this.entries = [];
    this.cursor = null;
  }

  // ------------------------------------------------------------------ time

  /** Context time of the sample reaching the speakers now. */
  private audibleTime(): number {
    const ctx = this.ctx!;
    if (ctx.state === 'running' && ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime && ts.performanceTime) {
        return Math.min(ctx.currentTime, ts.contextTime + (performance.now() - ts.performanceTime) / 1000);
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  private currentPlace(): { index: number; offset: number } {
    // while loading, what matters is where we're going, not the audio still fading out
    if (!this.ctx || this.state === 'loading' || !this.entries.length) return this.pending;
    const t = this.audibleTime();
    // a start is scheduled a moment ahead: until it's heard, the place is the one asked for
    if (t < this.audibleFrom) return this.pending;
    let cur: Entry | null = null;
    let upcoming: Entry | null = null;
    for (const e of this.entries) {
      if (e.tailOnly) continue;
      if (e.start <= t) {
        if (!cur || e.start > cur.start) cur = e;
      } else if (!upcoming || e.start < upcoming.start) upcoming = e;
    }
    if (cur && t - cur.start < cur.duration) return { index: cur.index, offset: t - cur.start };
    // in a gap (a late render) or just before the first section: the one about to play
    if (upcoming) return { index: upcoming.index, offset: 0 };
    if (cur) return { index: this.cursor?.index ?? this.next(cur.index), offset: 0 };
    return this.pending;
  }

  private tick(): void {
    if (this.state === 'playing') {
      this.pump();
      const { index } = this.currentPlace();
      if (index !== this.audibleIndex) this.emitSection(index);
    }
    if (this.sleepAt !== null) {
      const left = this.sleepAt - performance.now();
      if (left <= 0) {
        // the bus stays faded until the next play(), so nothing blips while the context suspends
        this.sleepAt = null;
        this.pause();
      } else if (left <= SLEEP_FADE_MS && !this.fading && this.bus && this.ctx) {
        this.fading = true;
        this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, left / 1000 / 4);
      }
    }
  }

  private restoreBus(): void {
    this.fading = false;
    if (this.bus && this.ctx) {
      this.bus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.bus.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
    }
  }

  // ------------------------------------------------------------------ events

  private emitSection(index: number): void {
    this.audibleIndex = index;
    this.emit('section', this.score(index));
  }

  private setState(s: PlayerState): void {
    if (s === this.state) return;
    this.state = s;
    this.emit('state', s);
  }

  private fail(err: unknown): void {
    console.error(err);
    this.gen++;
    this.stopAll(true);
    this.intent = 'pause';
    this.setState('paused');
    this.emit('error', err instanceof Error ? err.message : String(err));
  }

  private emit<K extends keyof PlayerEvents>(event: K, v: PlayerEvents[K]): void {
    for (const fn of this.listeners[event] as Set<(v: PlayerEvents[K]) => void>) fn(v);
  }
}
