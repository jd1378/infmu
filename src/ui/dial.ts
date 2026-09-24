// The dial: the circle of fifths, turned so the key's tonic sits at the top. Inside it the chord playing now
// is drawn as a shape (major and minor triads are mirror images), notes light up as sparks at their pitch
// class (low notes near the centre, high ones near the rim), and the melody leaves a trail. It reads the
// same score the synthesizer plays, so every mark corresponds to a sound.

import type { Position } from '../core/player.ts';
import { MODES, noteName, pc } from '../core/theory.ts';
import type { Ev, Score } from '../core/types.ts';
import { fifths, type Tint } from './theme.ts';

interface Spark {
  a: number; // angle (radians, 0 = top of the dial before rotation)
  r: number; // 0..1 radius fraction
  size: number;
  age: number;
  life: number;
  alpha: number;
}

interface TrailPoint {
  a: number;
  r: number;
  age: number;
}

const TAU = Math.PI * 2;
const angleOf = (pitchClass: number) => (fifths(pitchClass) / 12) * TAU;
const radiusOf = (midi: number) => Math.min(1, Math.max(0.12, (midi - 28) / 68));
/** Shortest signed difference between two angles. */
const dAngle = (a: number, b: number) => ((((b - a) % TAU) + TAU * 1.5) % TAU) - TAU / 2;

export class Dial {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly still: boolean;
  private size = 0;
  private dpr = 1;
  private rot = 0;
  private chord: number[] = [];
  private chordTarget: number[] = [];
  private sparks: Spark[] = [];
  private trail: TrailPoint[] = [];
  private kick = 0;
  private flash = 0;
  private rings: number[] = [];
  /** Notes of lead phrases, which arrive as one event per phrase, waiting for their time. */
  private pendingNotes: { t: number; n: number; d: number; v: number }[] = [];
  private last: { index: number; offset: number } | null = null;
  private lastFrame = 0;
  private tint: Tint = { h: 285, l: 0.8, c: 0.12 };

  constructor(canvas: HTMLCanvasElement, reducedMotion: boolean) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.still = reducedMotion;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setTint(t: Tint): void {
    this.tint = t;
  }

  /** Draws one frame. `playing` false freezes time (sparks hold still while paused). */
  frame(pos: Position, playing: boolean): void {
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    const score = pos.score;
    const key = score.movement.key;

    if (playing) this.consume(pos, score);
    else this.last = { index: pos.index, offset: pos.offset };

    // turn the dial so the tonic is at the top, and morph the chord shape towards the current chord
    const rotTarget = -angleOf(key.tonic);
    this.rot += dAngle(this.rot, rotTarget) * (this.still || !dt ? 1 : Math.min(1, dt * 2.2));
    const span = score.chords.find((c) => pos.offset >= c.t && pos.offset < c.t + c.d) ?? score.chords[0];
    // vertices in ring order starting from the root, so seventh and ninth chords draw as simple shapes
    const root = span ? angleOf(span.pcs[0]) : 0;
    this.chordTarget = span
      ? span.pcs.map(angleOf).sort((x, y) => ((x - root + TAU) % TAU) - ((y - root + TAU) % TAU))
      : [];
    this.morphChord(playing ? dt : 1);

    if (playing) this.age(dt);
    this.draw(score, pos, playing);
  }

  // ------------------------------------------------------------------ events -> visuals

  private consume(pos: Position, score: Score): void {
    const prev = this.last;
    this.last = { index: pos.index, offset: pos.offset };
    // a new section, a seek or a stall: start reading from here without replaying what we skipped
    if (!prev || prev.index !== pos.index || pos.offset < prev.offset || pos.offset - prev.offset > 0.5) {
      this.pendingNotes = [];
      if (prev && prev.index !== pos.index && pos.offset < 0.5) this.spawnRange(score, -1, pos.offset);
      return;
    }
    this.spawnRange(score, prev.offset, pos.offset);
  }

  private spawnRange(score: Score, from: number, to: number): void {
    for (const e of score.events) {
      if (e.t > to) break;
      if (e.t > from) this.spawn(e);
    }
  }

  private spawn(e: Ev): void {
    const add = (n: number, size: number, life: number, alpha: number) =>
      this.sparks.push({ a: angleOf(pc(n)), r: radiusOf(n), size, age: 0, life: Math.min(life, 5), alpha });
    switch (e.i) {
      case 'kick':
        this.kick = Math.max(this.kick, e.v);
        break;
      case 'snare':
        if (e.k !== 'roll' && e.k !== 'rim') this.rings.push(0);
        break;
      case 'impact':
        this.flash = Math.max(this.flash, e.a);
        break;
      case 'pad':
        for (const n of e.n) add(n, 12, e.d + 0.5, 0.22);
        break;
      case 'organ':
        add(e.n, 11, e.d, 0.2);
        break;
      case 'keys':
        for (const n of e.n) add(n, 7, e.d + 0.2, 0.4 * e.v);
        break;
      case 'bass':
        add(e.n, 8, Math.max(0.25, e.d), 0.45 * e.v);
        break;
      case 'pluck':
        add(e.n, 3.5, 0.45, 0.8 * e.v);
        break;
      case 'tom':
        add(e.n, 5, 0.4, 0.6 * e.v);
        break;
      case 'bell':
        for (const n of e.n) {
          add(n, 5.5, 2.5, 1 * e.v);
          this.trailTo(n);
        }
        break;
      case 'lead':
        // a lead is one event per phrase: queue each note at its own time
        for (const note of e.ns) this.pendingNotes.push({ t: note.t, n: note.n, d: note.d, v: note.v });
        this.pendingNotes.sort((x, y) => x.t - y.t);
        break;
    }
  }

  private trailTo(n: number): void {
    this.trail.push({ a: angleOf(pc(n)), r: radiusOf(n), age: 0 });
    if (this.trail.length > 24) this.trail.shift();
  }

  private age(dt: number): void {
    // lead notes queued from their phrase event fire when their time comes
    const off = this.last?.offset ?? 0;
    while (this.pendingNotes.length && this.pendingNotes[0].t <= off) {
      const n = this.pendingNotes.shift()!;
      this.sparks.push({
        a: angleOf(pc(n.n)),
        r: radiusOf(n.n),
        size: 6,
        age: 0,
        life: Math.min(3, n.d + 0.4),
        alpha: n.v,
      });
      this.trailTo(n.n);
    }
    for (const s of this.sparks) s.age += dt;
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    if (this.sparks.length > 400) this.sparks.splice(0, this.sparks.length - 400);
    for (const p of this.trail) p.age += dt;
    this.trail = this.trail.filter((p) => p.age < 6);
    this.kick *= Math.exp(-8 * dt);
    this.flash *= Math.exp(-2.2 * dt);
    this.rings = this.rings.map((r) => r + dt * 1.6).filter((r) => r < 1);
  }

  private morphChord(k: number): void {
    const target = this.chordTarget;
    if (this.chord.length !== target.length) {
      // grow or shrink by repeating the last vertex, then glide
      const src = this.chord.length ? this.chord : target;
      this.chord = target.map((_, i) => src[Math.min(i, src.length - 1)]);
    }
    const f = this.still ? 1 : Math.min(1, k * 6);
    this.chord = this.chord.map((a, i) => a + dAngle(a, target[i]) * f);
  }

  // ------------------------------------------------------------------ drawing

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.size = Math.max(1, Math.round(rect.width));
    this.canvas.width = Math.round(this.size * this.dpr);
    this.canvas.height = Math.round(this.size * this.dpr);
  }

  private col(l: number, c: number, a: number, dh = 0): string {
    return `oklch(${l} ${c} ${(this.tint.h + dh).toFixed(1)} / ${a.toFixed(3)})`;
  }

  private draw(score: Score, pos: Position, playing: boolean): void {
    const g = this.g;
    const S = this.size;
    const cx = S / 2;
    const R = S * 0.36;
    const pulse = this.still ? 0 : this.kick;
    const energy = score.section.energy;
    const key = score.movement.key;
    const { l, c } = this.tint;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const at = (a: number, r: number): [number, number] => {
      const ang = a + this.rot - Math.PI / 2;
      return [cx + Math.cos(ang) * r, cx + Math.sin(ang) * r];
    };

    // glow: breathes with the section's energy, jumps on the kick, blooms on impacts
    const glow = g.createRadialGradient(cx, cx, 0, cx, cx, R * 1.25);
    const gi = 0.1 + 0.16 * energy + 0.18 * pulse + 0.35 * this.flash;
    glow.addColorStop(0, this.col(l, c, gi));
    glow.addColorStop(0.55, this.col(l * 0.7, c, gi * 0.35));
    glow.addColorStop(1, this.col(l * 0.5, c, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, S, S);

    // the bar hand: one sweep per bar, a quiet metronome
    if (playing || pos.offset > 0) {
      const bar = (4 * 60) / score.bpm;
      const frac = (pos.offset % bar) / bar;
      const [hx, hy] = at(frac * TAU - this.rot, R * 1.02);
      g.strokeStyle = this.col(0.9, 0.03, 0.12);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx, cx);
      g.lineTo(hx, hy);
      g.stroke();
    }

    // the ring and its twelve pitch classes; notes of the mode are marked, the tonic is the accent
    const scale = new Set(MODES[key.mode].map((x) => (x + key.tonic) % 12));
    const ringR = R * (1 + 0.012 * pulse);
    g.lineWidth = 1.5 + 1.5 * pulse;
    g.strokeStyle = this.col(0.5 + 0.2 * pulse, 0.05, 0.9);
    g.beginPath();
    g.arc(cx, cx, ringR, 0, TAU);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fs = Math.max(11, S * 0.026);
    for (let p = 0; p < 12; p++) {
      const a = angleOf(p);
      const inScale = scale.has(p);
      const tonic = p === key.tonic;
      const [x, y] = at(a, ringR);
      g.fillStyle = tonic ? this.col(l, c, 1) : inScale ? this.col(0.85, 0.03, 0.9) : this.col(0.5, 0.03, 0.8);
      g.beginPath();
      g.arc(x, y, tonic ? 5 : inScale ? 3.2 : 2, 0, TAU);
      g.fill();
      const [lx, ly] = at(a, ringR + fs * 1.6);
      g.font = `${tonic ? 600 : 400} ${fs}px 'Hanken Grotesk', system-ui, sans-serif`;
      g.fillStyle = tonic ? this.col(l, c, 1) : inScale ? this.col(0.8, 0.02, 0.85) : this.col(0.55, 0.02, 0.6);
      g.fillText(noteName(p, key), lx, ly);
    }

    // snare shock rings
    for (const r of this.rings) {
      g.strokeStyle = this.col(0.9, 0.04, 0.35 * (1 - r));
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(cx, cx, R * (0.2 + 1.1 * r), 0, TAU);
      g.stroke();
    }

    // the chord's shape
    if (this.chord.length >= 2) {
      const cr = R * 0.66;
      g.beginPath();
      this.chord.forEach((a, i) => {
        const [x, y] = at(a, cr);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.closePath();
      g.fillStyle = this.col(l, c, 0.1 + 0.08 * pulse);
      g.fill();
      g.strokeStyle = this.col(l, c, 0.75);
      g.lineWidth = 1.6;
      g.lineJoin = 'round';
      g.stroke();
      const [rx, ry] = at(this.chord[0], cr);
      g.fillStyle = this.col(l, c, 1);
      g.beginPath();
      g.arc(rx, ry, 4, 0, TAU);
      g.fill();
    }

    // the melody's trail: a step in pitch is a leap across the circle of fifths, so each one is drawn as a
    // curve bowing towards the centre, and a phrase weaves a kind of string art
    if (this.trail.length > 1) {
      g.lineWidth = 1.3;
      for (let i = 1; i < this.trail.length; i++) {
        const p0 = this.trail[i - 1];
        const p1 = this.trail[i];
        const [x0, y0] = at(p0.a, p0.r * R);
        const [x1, y1] = at(p1.a, p1.r * R);
        g.strokeStyle = this.col(0.92, 0.06, Math.max(0, 0.55 * (1 - p1.age / 6)), 20);
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(cx + ((x0 + x1) / 2 - cx) * 0.25, cx + ((y0 + y1) / 2 - cx) * 0.25, x1, y1);
        g.stroke();
      }
    }

    // sparks, added together so dense chords glow
    g.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const k = 1 - s.age / s.life;
      const a = s.alpha * k * k * (s.age < 0.03 ? s.age / 0.03 : 1);
      if (a <= 0.004) continue;
      const [x, y] = at(s.a, s.r * R);
      const rad = s.size * (0.6 + 0.4 * k) * (S / 300);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, this.col(0.97, 0.05, a, 25));
      grd.addColorStop(0.4, this.col(l, c, a * 0.6, 25));
      grd.addColorStop(1, this.col(l, c, 0, 25));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad, 0, TAU);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
}
