// A stand-in for Web Audio, just enough for WebPlayer. Like the real thing, suspend() and resume() change
// the state asynchronously, and the clock only runs while the context is running. `speed` makes it run
// faster than real time, to simulate renders that can't keep up.

class Param {
  value = 1;
  setTargetAtTime(): void {}
  cancelScheduledValues(): void {}
}

class FakeNode {
  gain = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  connect<T>(n: T): T {
    return n;
  }
  disconnect(): void {}
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

class FakeBuffer {
  readonly duration: number;
  constructor(_channels: number, length: number, rate: number) {
    this.duration = length / rate;
  }
  copyToChannel(): void {}
}

export const clock = { speed: 1 };

export class FakeAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  readonly sampleRate = 100;
  readonly outputLatency = 0.02;
  readonly baseLatency = 0;
  readonly destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  private base = 0;
  private since = performance.now();

  get currentTime(): number {
    return this.state === 'running' ? this.base + ((performance.now() - this.since) / 1000) * clock.speed : this.base;
  }
  createGain(): FakeNode {
    return new FakeNode();
  }
  createDynamicsCompressor(): FakeNode {
    return new FakeNode();
  }
  createBufferSource(): FakeSource {
    return new FakeSource();
  }
  createBuffer(channels: number, length: number, rate: number): FakeBuffer {
    return new FakeBuffer(channels, length, rate);
  }
  suspend(): Promise<void> {
    return this.flip('suspended');
  }
  resume(): Promise<void> {
    return this.flip('running');
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  private flip(next: 'running' | 'suspended'): Promise<void> {
    return new Promise((done) =>
      setTimeout(() => {
        if (this.state !== next && this.state !== 'closed') {
          if (next === 'suspended') this.base = this.currentTime;
          else this.since = performance.now();
          this.state = next;
          this.onstatechange?.();
        }
        done();
      }, 30)
    );
  }
}

export function installFakeAudio(): void {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
}

/** A worker that renders silence of the right length after `delay` ms of busy work, like a real render. */
export const fakeWorker = (delay: number) => new URL(`./fake_worker.ts?delay=${delay}`, import.meta.url);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 5000): Promise<boolean> {
  const t = performance.now();
  while (!cond()) {
    if (performance.now() - t > ms) return false;
    await sleep(15);
  }
  return true;
}
