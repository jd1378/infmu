import type { RenderJob, RenderRequest, RenderResponse } from './protocol.ts';

type Job = {
  req: RenderRequest;
  resolve: (r: Extract<RenderResponse, { ok: true }>) => void;
  reject: (e: Error) => void;
};

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

const MAX_FAILURES = 3;

interface Slot {
  worker: Worker | null;
  job: Job | null;
  /** Crashes in a row. A worker that can't even start (a missing file) would otherwise respawn forever. */
  failures: number;
}

/** A few render workers and a FIFO of jobs. Jobs that haven't started can be cancelled. */
export class RenderPool {
  private readonly url: URL;
  private readonly slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 1;

  constructor(url: URL, size: number) {
    this.url = url;
    for (let i = 0; i < size; i++) this.slots.push({ worker: null, job: null, failures: 0 });
    this.slots.forEach((_, i) => (this.slots[i].worker = this.spawn(i)));
  }

  /** `urgent` jobs go to the front of the queue: a note someone is playing now, before the ones prepared for later. */
  render(req: RenderJob, urgent = false): Promise<Extract<RenderResponse, { ok: true }>> {
    return new Promise((resolve, reject) => {
      if (this.dead()) return reject(new Error('audio rendering is unavailable in this browser'));
      const job = { req: { ...req, id: this.nextId++ } as RenderRequest, resolve, reject };
      if (urgent) this.queue.unshift(job);
      else this.queue.push(job);
      this.drain();
    });
  }

  /** Stops the workers; running and queued jobs are rejected. */
  dispose(): void {
    this.cancelQueued();
    for (const slot of this.slots) {
      slot.job?.reject(new CancelledError());
      slot.job = null;
      slot.worker?.terminate();
      slot.worker = null;
      slot.failures = MAX_FAILURES;
    }
  }

  /**
   * Drops every job that hasn't started yet and returns their requests. Running jobs finish; callers
   * ignore stale results.
   */
  cancelQueued(): RenderRequest[] {
    const q = this.queue;
    this.queue = [];
    for (const j of q) j.reject(new CancelledError());
    return q.map((j) => j.req);
  }

  private dead(): boolean {
    return this.slots.every((s) => s.failures >= MAX_FAILURES);
  }

  private spawn(i: number): Worker {
    const w = new Worker(this.url, { type: 'module', name: `render-${i}` });
    w.onmessage = (ev: MessageEvent<RenderResponse>) => {
      const slot = this.slots[i];
      const job = slot.job;
      slot.job = null;
      slot.failures = 0;
      if (job && job.req.id === ev.data.id) {
        if (ev.data.ok) job.resolve(ev.data);
        else job.reject(new Error(ev.data.error));
      }
      this.drain();
    };
    w.onerror = (ev) => {
      ev.preventDefault();
      const slot = this.slots[i];
      slot.job?.reject(new Error(ev.message || 'render worker crashed'));
      slot.job = null;
      slot.worker?.terminate();
      slot.worker = null;
      if (++slot.failures < MAX_FAILURES) {
        setTimeout(() => {
          if (slot.failures < MAX_FAILURES && !slot.worker) {
            slot.worker = this.spawn(i);
            this.drain();
          }
        }, 250 * 2 ** slot.failures);
      } else if (this.dead()) {
        for (const j of this.queue.splice(0)) j.reject(new Error('audio rendering is unavailable in this browser'));
      }
      this.drain();
    };
    return w;
  }

  private drain(): void {
    for (const slot of this.slots) {
      if (slot.job || !slot.worker || !this.queue.length) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      slot.worker.postMessage(job.req);
    }
  }
}
